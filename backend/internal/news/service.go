package news

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// queryOverrides map our short ticker → NewsAPI search query. Without this
// "INFY" returns noise; "Infosys" returns real coverage.
var queryOverrides = map[string]string{
	"RELIANCE":  "Reliance Industries",
	"TCS":       "Tata Consultancy Services",
	"INFY":      "Infosys",
	"HDFCBANK":  "HDFC Bank",
	"ICICIBANK": "ICICI Bank",
	"SBIN":      "State Bank of India",
	"WIPRO":     "Wipro",
	"ITC":       "ITC Limited",
	"BTC":       "Bitcoin",
	"ETH":       "Ethereum",
}

// ErrDisabled is returned when no API key was configured.
var ErrDisabled = errors.New("news disabled: NEWSAPI_KEY not set")

// ErrTransient signals an upstream problem worth surfacing as 503. Caller
// can decide whether to serve stale cache or give up.
var ErrTransient = errors.New("news upstream unavailable")

type Service struct {
	apiKey string
	rdb    *redis.Client
	http   *http.Client
	ttl    time.Duration
}

func NewService(apiKey string, rdb *redis.Client) *Service {
	return &Service{
		apiKey: apiKey,
		rdb:    rdb,
		ttl:    30 * time.Minute,
		http: &http.Client{
			Timeout: 8 * time.Second,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{Timeout: 4 * time.Second}).DialContext,
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     60 * time.Second,
				TLSHandshakeTimeout: 4 * time.Second,
			},
		},
	}
}

// Enabled reports whether the service will fetch real data.
func (s *Service) Enabled() bool { return s.apiKey != "" }

func cacheKey(ticker string) string { return "news:" + ticker }

// ForTicker returns cached-or-fresh articles for the given ticker.
// Caches successful responses (including empty arrays) for s.ttl.
func (s *Service) ForTicker(ctx context.Context, ticker string) ([]Article, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return nil, errors.New("empty ticker")
	}
	if !s.Enabled() {
		return nil, ErrDisabled
	}

	// Cache hit path.
	if raw, err := s.rdb.Get(ctx, cacheKey(ticker)).Bytes(); err == nil {
		var cached []Article
		if err := json.Unmarshal(raw, &cached); err == nil {
			return cached, nil
		}
	}

	articles, err := s.fetch(ctx, ticker)
	if err != nil {
		return nil, err
	}

	// Best-effort cache write; don't fail the request if Redis hiccups.
	if b, err := json.Marshal(articles); err == nil {
		_ = s.rdb.Set(ctx, cacheKey(ticker), b, s.ttl).Err()
	}
	return articles, nil
}

// --- NewsAPI wire format -----------------------------------------------------

type newsAPIResponse struct {
	Status       string `json:"status"`
	Message      string `json:"message,omitempty"`
	Code         string `json:"code,omitempty"`
	TotalResults int    `json:"totalResults"`
	Articles     []struct {
		Source struct {
			Name string `json:"name"`
		} `json:"source"`
		Title       string    `json:"title"`
		Description string    `json:"description"`
		URL         string    `json:"url"`
		PublishedAt time.Time `json:"publishedAt"`
	} `json:"articles"`
}

func (s *Service) fetch(ctx context.Context, ticker string) ([]Article, error) {
	query, ok := queryOverrides[ticker]
	if !ok {
		query = ticker
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("language", "en")
	params.Set("sortBy", "publishedAt")
	params.Set("pageSize", "10")
	endpoint := "https://newsapi.org/v2/everything?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", s.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "stockapp/0.1")

	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTransient, err)
	}
	defer resp.Body.Close()

	var parsed newsAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", ErrTransient, err)
	}
	if parsed.Status != "ok" {
		// Distinguish client errors (bad key, limit reached) from transient.
		log.Warn().
			Str("code", parsed.Code).
			Str("msg", parsed.Message).
			Int("status", resp.StatusCode).
			Msg("newsapi error")
		if resp.StatusCode >= 500 || parsed.Code == "rateLimited" {
			return nil, ErrTransient
		}
		return nil, fmt.Errorf("newsapi: %s", parsed.Message)
	}

	out := make([]Article, 0, len(parsed.Articles))
	for _, a := range parsed.Articles {
		// Some NewsAPI rows are placeholders ("[Removed]"); skip them.
		if strings.EqualFold(a.Title, "[Removed]") || a.URL == "" {
			continue
		}
		sc, tag := score(a.Title + " " + a.Description)
		out = append(out, Article{
			Title:       a.Title,
			Description: a.Description,
			URL:         a.URL,
			Source:      a.Source.Name,
			PublishedAt: a.PublishedAt,
			Sentiment:   tag,
			Score:       sc,
		})
	}
	return out, nil
}
