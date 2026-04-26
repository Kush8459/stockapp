package insights

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

// ErrDisabled is returned when the service has no API key configured.
var ErrDisabled = errors.New("insights disabled: GEMINI_API_KEY not set")

// ErrUpstream is returned when Gemini itself errors or returns malformed data.
var ErrUpstream = errors.New("insights upstream error")

// geminiClient is a narrow wrapper around Gemini's REST API. We hit raw HTTP
// rather than pulling a full SDK — the request shape is stable, we only use
// one endpoint, and avoiding a transitive dep tree keeps the binary small.
type geminiClient struct {
	apiKey string
	model  string
	http   *http.Client
}

func newGeminiClient(apiKey, model string) *geminiClient {
	return &geminiClient{
		apiKey: apiKey,
		model:  model,
		http: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     60 * time.Second,
				TLSHandshakeTimeout: 5 * time.Second,
			},
		},
	}
}

// --- wire types -------------------------------------------------------------

type content struct {
	Role  string `json:"role,omitempty"`
	Parts []part `json:"parts"`
}

type part struct {
	Text string `json:"text"`
}

type generationConfig struct {
	Temperature      float64 `json:"temperature,omitempty"`
	ResponseMimeType string  `json:"responseMimeType,omitempty"`
	ResponseSchema   any     `json:"responseSchema,omitempty"`
	MaxOutputTokens  int     `json:"maxOutputTokens,omitempty"`
}

type generateRequest struct {
	Contents          []content        `json:"contents"`
	SystemInstruction *content         `json:"systemInstruction,omitempty"`
	GenerationConfig  generationConfig `json:"generationConfig"`
}

type generateResponse struct {
	Candidates []struct {
		Content      content `json:"content"`
		FinishReason string  `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback,omitempty"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

// generate sends a structured-output request with automatic retry on
// transient upstream failures (503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED,
// 500 INTERNAL). Gemini's UNAVAILABLE responses in particular are very
// common during peak hours and almost always clear within a few seconds.
func (c *geminiClient) generate(
	ctx context.Context,
	systemPrompt, userPrompt string,
	schema any,
) (string, error) {
	// The rich schema is nested; give the model more output room than the
	// old flat version needed.
	body := generateRequest{
		Contents: []content{
			{Role: "user", Parts: []part{{Text: userPrompt}}},
		},
		SystemInstruction: &content{Parts: []part{{Text: systemPrompt}}},
		GenerationConfig: generationConfig{
			Temperature:      0.4,
			ResponseMimeType: "application/json",
			ResponseSchema:   schema,
			MaxOutputTokens:  4096,
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	// Retry with jittered exponential backoff. 4 attempts over roughly
	// 0.5s → 1.5s → 3s → 6s window (total ~11s worst case).
	const attempts = 4
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			delay := time.Duration(1<<(attempt-1)) * 500 * time.Millisecond
			log.Debug().Int("attempt", attempt+1).Dur("backoff", delay).Msg("gemini: retrying")
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(delay):
			}
		}
		text, err := c.doRequest(ctx, raw)
		if err == nil {
			return text, nil
		}
		lastErr = err
		if !isRetryable(err) {
			return "", err
		}
	}
	return "", lastErr
}

// doRequest performs a single attempt. Returns a retryableError for transient
// upstream failures so generate() knows to back off and try again.
func (c *geminiClient) doRequest(ctx context.Context, raw []byte) (string, error) {
	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
		c.model, c.apiKey,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("model", c.model).Msg("gemini: network error")
		return "", retryable(fmt.Errorf("%w: %v", ErrUpstream, err))
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", retryable(fmt.Errorf("%w: read body: %v", ErrUpstream, err))
	}

	var parsed generateResponse
	if decodeErr := json.Unmarshal(bodyBytes, &parsed); decodeErr != nil {
		log.Warn().
			Int("status", resp.StatusCode).
			Str("body", truncate(string(bodyBytes), 1000)).
			Err(decodeErr).
			Msg("gemini: cannot decode response")
		return "", fmt.Errorf("%w: decode: %v", ErrUpstream, decodeErr)
	}
	if parsed.Error != nil {
		log.Warn().
			Int("code", parsed.Error.Code).
			Str("status", parsed.Error.Status).
			Str("message", parsed.Error.Message).
			Str("model", c.model).
			Msg("gemini: api error")
		wrapped := fmt.Errorf("%w: %s (%s)", ErrUpstream, parsed.Error.Message, parsed.Error.Status)
		if isTransientStatus(parsed.Error.Status) || isTransientHTTP(parsed.Error.Code) {
			return "", retryable(wrapped)
		}
		return "", wrapped
	}
	if resp.StatusCode != http.StatusOK {
		log.Warn().
			Int("status", resp.StatusCode).
			Str("body", truncate(string(bodyBytes), 1000)).
			Str("model", c.model).
			Msg("gemini: non-200 response")
		wrapped := fmt.Errorf("%w: http %s", ErrUpstream, resp.Status)
		if isTransientHTTP(resp.StatusCode) {
			return "", retryable(wrapped)
		}
		return "", wrapped
	}
	if parsed.PromptFeedback != nil && parsed.PromptFeedback.BlockReason != "" {
		log.Warn().Str("reason", parsed.PromptFeedback.BlockReason).Msg("gemini: response blocked")
		return "", fmt.Errorf("%w: blocked (%s)", ErrUpstream, parsed.PromptFeedback.BlockReason)
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		log.Warn().Str("body", truncate(string(bodyBytes), 500)).Msg("gemini: empty candidates")
		return "", fmt.Errorf("%w: empty response", ErrUpstream)
	}
	return parsed.Candidates[0].Content.Parts[0].Text, nil
}

// retryableError marks an error as worth retrying. Non-retryable errors (bad
// API key, schema validation, safety blocks) short-circuit the retry loop.
type retryableError struct{ err error }

func (r *retryableError) Error() string { return r.err.Error() }
func (r *retryableError) Unwrap() error { return r.err }

func retryable(err error) error { return &retryableError{err: err} }

func isRetryable(err error) bool {
	var re *retryableError
	return errors.As(err, &re)
}

// isTransientStatus covers Google-API canonical status names.
func isTransientStatus(status string) bool {
	switch status {
	case "UNAVAILABLE", "RESOURCE_EXHAUSTED", "INTERNAL", "DEADLINE_EXCEEDED", "ABORTED":
		return true
	}
	return false
}

// isTransientHTTP covers plain HTTP codes used by Gemini.
func isTransientHTTP(code int) bool {
	return code == 429 || code == 500 || code == 502 || code == 503 || code == 504
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
