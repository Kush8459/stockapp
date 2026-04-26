package price

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// SearchResult is what the UI's autocomplete renders.
type SearchResult struct {
	Symbol    string `json:"symbol"`
	Name      string `json:"name"`
	Exchange  string `json:"exchange"`
	Type      string `json:"type"`      // EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY, INDEX
	ShortName string `json:"shortName,omitempty"`
}

type yahooSearchResponse struct {
	Quotes []struct {
		Symbol              string `json:"symbol"`
		Shortname           string `json:"shortname"`
		Longname            string `json:"longname"`
		Exchange            string `json:"exchange"`
		QuoteType           string `json:"quoteType"`
		ExchangeDisplayName string `json:"exchDisp"`
	} `json:"quotes"`
}

// Search returns autocomplete results for the dashboard's search bar.
// Tries the Upstox CSV-backed local index first (Indian-only, fast, exact
// to what the rest of the app trades), then falls back to Yahoo's
// unofficial endpoint when the CSV hasn't loaded yet or no rows match.
func Search(ctx context.Context, rdb *redis.Client, q string, limit int) ([]SearchResult, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return []SearchResult{}, nil
	}
	if limit <= 0 || limit > 25 {
		limit = 10
	}

	// 1) Local index — preferred. Returns nil during the first ~10 s of
	// worker startup before the CSV finishes parsing.
	if matches := SearchInstruments(q, limit); len(matches) > 0 {
		out := make([]SearchResult, 0, len(matches))
		for _, m := range matches {
			out = append(out, SearchResult{
				Symbol:    m.Symbol,
				Name:      m.Name,
				Exchange:  m.Exchange,
				Type:      mapInstrumentType(m.Type),
				ShortName: m.Symbol,
			})
		}
		return out, nil
	}

	// 2) Yahoo fallback — used during CSV-load gap or on local zero-hits.
	return searchYahoo(ctx, rdb, q, limit)
}

// mapInstrumentType maps Upstox's terse code to the enum the frontend's
// colorForType expects ("EQUITY" → cyan stock, etc.).
func mapInstrumentType(t string) string {
	switch strings.ToUpper(t) {
	case "EQ":
		return "EQUITY"
	case "MF":
		return "MUTUALFUND"
	default:
		return strings.ToUpper(t)
	}
}

// searchYahoo is the original Yahoo-backed search, kept as a fallback for
// the CSV-load window and zero-hit edge cases.
func searchYahoo(ctx context.Context, rdb *redis.Client, q string, limit int) ([]SearchResult, error) {
	key := fmt.Sprintf("search:%d:%s", limit, strings.ToLower(q))

	if raw, err := rdb.Get(ctx, key).Bytes(); err == nil {
		var cached []SearchResult
		if err := json.Unmarshal(raw, &cached); err == nil {
			return cached, nil
		}
	}

	params := url.Values{}
	params.Set("q", q)
	params.Set("quotesCount", fmt.Sprintf("%d", limit))
	params.Set("newsCount", "0")
	endpoint := "https://query2.finance.yahoo.com/v1/finance/search?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	client := newHTTPClient()
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo search: %s", resp.Status)
	}
	var parsed yahooSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}

	out := make([]SearchResult, 0, len(parsed.Quotes))
	for _, q := range parsed.Quotes {
		name := q.Longname
		if name == "" {
			name = q.Shortname
		}
		if name == "" || q.Symbol == "" {
			continue
		}
		// Indian-market focus: filter out crypto and FX from search results.
		// Indices ("^NSEI", "^BSESN" etc.) belong in the top market bar, not
		// the per-stock detail page — exclude them too.
		if q.QuoteType == "CRYPTOCURRENCY" || q.QuoteType == "CURRENCY" || q.QuoteType == "INDEX" {
			continue
		}
		out = append(out, SearchResult{
			Symbol:    q.Symbol,
			Name:      name,
			Exchange:  firstNonEmpty(q.ExchangeDisplayName, q.Exchange),
			Type:      q.QuoteType,
			ShortName: q.Shortname,
		})
	}

	if b, err := json.Marshal(out); err == nil {
		_ = rdb.Set(ctx, key, b, 5*time.Minute).Err()
	}
	return out, nil
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
