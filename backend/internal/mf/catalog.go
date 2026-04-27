// Package mf surfaces a browseable mutual-fund catalog backed entirely by
// mfapi.in (the public mirror of the AMFI NAV file). No fund list is
// hardcoded — the directory is loaded once at startup and refreshed
// daily, with NAVs fetched lazily per visible page.
//
// Categorization is a name-based heuristic. AMFI scheme names follow a
// fairly consistent shape (e.g., "Axis Bluechip Fund - Direct Plan -
// Growth") so keyword matching gets us a useful bucketing without any
// manual curation. Funds that don't match any keyword fall into "Other".
package mf

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

const (
	directoryURL  = "https://api.mfapi.in/mf"
	directoryTTL  = 24 * time.Hour
	directoryKey  = "mf:directory:v2"
	userAgent     = "stockapp/1.0 (mfapi-catalog)"
	httpTimeout   = 30 * time.Second
)

// Fund is one row in the catalog.
type Fund struct {
	// Ticker is the canonical "MF<schemeCode>" form used by transactions
	// and SIP plans. The frontend stores this verbatim.
	Ticker     string `json:"ticker"`
	SchemeCode int    `json:"schemeCode"`
	Name       string `json:"name"`
	AMC        string `json:"amc"`
	Category   string `json:"category"`
	PlanType   string `json:"planType"` // "Direct" or "Regular"
	Option     string `json:"option"`   // "Growth" or "Dividend"
}

// directoryRow is the schema returned by https://api.mfapi.in/mf
type directoryRow struct {
	SchemeCode int    `json:"schemeCode"`
	SchemeName string `json:"schemeName"`
}

// Service holds the parsed in-memory directory and is responsible for
// refreshing it from mfapi.in.
type Service struct {
	rdb    *redis.Client
	client *http.Client

	mu       sync.RWMutex
	funds    []Fund
	loadedAt time.Time
}

func NewService(rdb *redis.Client) *Service {
	return &Service{
		rdb:    rdb,
		client: &http.Client{Timeout: httpTimeout},
	}
}

// Start blocks once on the initial load (so the first /mf/catalog call has
// data to return) then refreshes daily in the background.
func (s *Service) Start(ctx context.Context) error {
	if err := s.loadOnce(ctx); err != nil {
		return fmt.Errorf("mf catalog initial load: %w", err)
	}
	go func() {
		t := time.NewTicker(directoryTTL)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := s.loadOnce(ctx); err != nil {
					log.Warn().Err(err).Msg("mf catalog refresh failed")
				}
			}
		}
	}()
	return nil
}

// loadOnce fetches the mfapi directory (or hits Redis if cached) and
// parses it into the in-memory `funds` slice. Direct + Growth rows only.
func (s *Service) loadOnce(ctx context.Context) error {
	rows, err := s.fetchDirectory(ctx)
	if err != nil {
		return err
	}
	out := make([]Fund, 0, len(rows)/4)
	for _, r := range rows {
		f, ok := classify(r)
		if !ok {
			continue
		}
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].Name < out[j].Name
	})
	s.mu.Lock()
	s.funds = out
	s.loadedAt = time.Now().UTC()
	s.mu.Unlock()
	log.Info().
		Int("total_directory", len(rows)).
		Int("catalog", len(out)).
		Msg("mf catalog loaded")
	return nil
}

func (s *Service) fetchDirectory(ctx context.Context) ([]directoryRow, error) {
	if s.rdb != nil {
		if raw, err := s.rdb.Get(ctx, directoryKey).Bytes(); err == nil {
			var cached []directoryRow
			if err := json.Unmarshal(raw, &cached); err == nil && len(cached) > 0 {
				return cached, nil
			}
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, directoryURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mfapi directory: %s", resp.Status)
	}
	var rows []directoryRow
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, err
	}
	if s.rdb != nil {
		if b, err := json.Marshal(rows); err == nil {
			_ = s.rdb.Set(ctx, directoryKey, b, directoryTTL).Err()
		}
	}
	return rows, nil
}

// All returns the catalog (cheap read-locked copy of the slice header).
func (s *Service) All() []Fund {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.funds
}

// Filter returns funds matching the optional category and free-text query
// (case-insensitive substring on name or AMC). Pass empty strings to skip
// a filter. `offset` skips that many matches before collecting; combined
// with `limit` this gives stable cursor-style pagination because the
// in-memory `funds` slice has a fixed deterministic order (category,
// then name) refreshed once per day.
//
// Returns the matched slice plus a `total` count of all matches across
// the whole filter — useful for the UI to show "showing N of M".
func (s *Service) Filter(category, query string, limit, offset int) (funds []Fund, total int) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	cat := strings.TrimSpace(category)
	q := strings.ToLower(strings.TrimSpace(query))
	out := make([]Fund, 0, limit)
	s.mu.RLock()
	defer s.mu.RUnlock()
	matched := 0
	for _, f := range s.funds {
		if cat != "" && !strings.EqualFold(f.Category, cat) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(f.Name), q) && !strings.Contains(strings.ToLower(f.AMC), q) {
			continue
		}
		matched++
		if matched <= offset {
			continue
		}
		if len(out) < limit {
			out = append(out, f)
		}
	}
	return out, matched
}

// Categories returns each category and the number of funds in it. The order
// is the conventional retail-app order (equity → tax → hybrid → debt →
// index/other) rather than alphabetical.
func (s *Service) Categories() []CategoryCount {
	counts := make(map[string]int, len(categoryOrder))
	s.mu.RLock()
	for _, f := range s.funds {
		counts[f.Category]++
	}
	s.mu.RUnlock()

	out := make([]CategoryCount, 0, len(counts))
	for _, c := range categoryOrder {
		if n, ok := counts[c]; ok && n > 0 {
			out = append(out, CategoryCount{Category: c, Count: n})
		}
	}
	// Append any unknown categories at the end (defensive — categoryOrder
	// should cover everything classify() emits).
	for c, n := range counts {
		if !slicesContains(categoryOrder, c) {
			out = append(out, CategoryCount{Category: c, Count: n})
		}
	}
	return out
}

// Find returns a single fund by ticker, or (zero, false) if not in the
// catalog (e.g., bad scheme code or a Regular plan we filter out).
func (s *Service) Find(ticker string) (Fund, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, f := range s.funds {
		if f.Ticker == ticker {
			return f, true
		}
	}
	return Fund{}, false
}

// CategoryCount is what /mf/categories returns per row.
type CategoryCount struct {
	Category string `json:"category"`
	Count    int    `json:"count"`
}

func slicesContains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
