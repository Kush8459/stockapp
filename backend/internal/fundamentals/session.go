package fundamentals

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"sync"
	"time"
)

// Yahoo's quoteSummary endpoint started requiring a session cookie + crumb
// in late 2023. The dance:
//   1. GET https://fc.yahoo.com           → server sets `A1` (or A3) cookie
//   2. GET .../v1/test/getcrumb           → returns a short crumb string
//   3. include crumb=… in the query for protected endpoints
//
// We hold one session per process, refresh every 30 min on success.
// Failures are surfaced through the boolean — callers fall back to
// non-crumb requests where they can.

const (
	yahooFCURL          = "https://fc.yahoo.com"
	yahooGetCrumbURL    = "https://query1.finance.yahoo.com/v1/test/getcrumb"
	sessionRefreshAfter = 30 * time.Minute
)

type yahooSession struct {
	mu          sync.Mutex
	jar         http.CookieJar
	client      *http.Client
	crumb       string
	refreshedAt time.Time
}

var globalYahoo = func() *yahooSession {
	jar, _ := cookiejar.New(nil)
	return &yahooSession{
		jar: jar,
		client: &http.Client{
			Jar:     jar,
			Timeout: 12 * time.Second,
		},
	}
}()

// authenticatedClient returns an *http.Client that has Yahoo's cookies set
// and a crumb available via Crumb(). Refreshes the session if it's older
// than sessionRefreshAfter or never been initialised.
func (s *yahooSession) authenticatedClient(ctx context.Context) (*http.Client, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.crumb != "" && time.Since(s.refreshedAt) < sessionRefreshAfter {
		return s.client, s.crumb, nil
	}

	// Step 1: hit fc.yahoo.com so the jar gets the A1/A3 cookie.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, yahooFCURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", yahooUserAgent)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("session warm-up: %w", err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	// Step 2: getcrumb. The body is a plain text string (no quotes).
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, yahooGetCrumbURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", yahooUserAgent)
	req.Header.Set("Accept", "text/plain,*/*")
	resp, err = s.client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("getcrumb: %w", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("getcrumb: %s — %s", resp.Status, string(body))
	}
	crumb := strings.TrimSpace(string(body))
	if crumb == "" {
		return nil, "", errors.New("getcrumb: empty body")
	}
	s.crumb = crumb
	s.refreshedAt = time.Now()
	return s.client, s.crumb, nil
}

// invalidate clears the cached session. Called when a request 401s — the
// next caller will re-warm the cookies.
func (s *yahooSession) invalidate() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.crumb = ""
	s.refreshedAt = time.Time{}
}

// yahooUserAgent — Yahoo rejects requests without a "real" UA.
const yahooUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
