package mf

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/price"
)

// Handler exposes the catalog + per-fund detail endpoints. NAVs are read
// from the live price.Cache when available (the worker keeps held/SIP'd
// MFs warm) and fall back to a Redis-cached mfapi /latest hit otherwise.
type Handler struct {
	svc   *Service
	cache *price.Cache
	rdb   *redis.Client

	// in-flight de-duplication for mfapi /latest hits — if 50 concurrent
	// requests page through the catalog, we only make one upstream call
	// per scheme code and share the result.
	inflight sync.Map // map[int]*navFetch
}

type navFetch struct {
	done chan struct{}
	nav  Nav
	err  error
}

// Nav is what the catalog endpoint embeds per fund. Decimal as string
// so the frontend can keep arbitrary precision (matching how /quotes works).
type Nav struct {
	Value     string    `json:"value"`
	ChangePct string    `json:"changePct,omitempty"`
	AsOf      time.Time `json:"asOf"`
	Stale     bool      `json:"stale"`
}

func NewHandler(svc *Service, cache *price.Cache, rdb *redis.Client) *Handler {
	return &Handler{svc: svc, cache: cache, rdb: rdb}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/mf/categories", h.categories)
	r.Get("/mf/catalog", h.catalog)
	r.Get("/mf/funds/{ticker}", h.fund)
	r.Get("/mf/funds/{ticker}/returns", h.returns)
	r.Get("/mf/funds/{ticker}/metrics", h.metrics)
}

func (h *Handler) returns(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "ticker")))
	f, ok := h.svc.Find(ticker)
	if !ok {
		httpx.Error(w, r, httpx.ErrNotFound)
		return
	}
	out, err := h.returnsFor(r.Context(), f)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) categories(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": h.svc.Categories(),
	})
}

// catalogRow is one fund row in the catalog response, enriched with the
// latest NAV and 1Y / 3Y / 5Y returns derived from cached NAV history.
type catalogRow struct {
	Fund
	Nav       *Nav     `json:"nav,omitempty"`
	OneYear   *float64 `json:"oneYear,omitempty"`
	ThreeYear *float64 `json:"threeYear,omitempty"`
	FiveYear  *float64 `json:"fiveYear,omitempty"`
}

// catalog returns funds optionally filtered by category and free-text q,
// each enriched with the latest NAV plus 1Y / 3Y / 5Y returns. Returns are
// computed from cached full NAV history (24h Redis TTL) so steady-state
// requests are fast — the cold path fans out to mfapi in parallel.
//
// Sort options (?sort=...): oneYear-desc, oneYear-asc, threeYear-desc,
// threeYear-asc, fiveYear-desc, fiveYear-asc. When sort is set we fetch
// the entire filtered set before paginating; otherwise we paginate first
// and only enrich the visible page.
//
// Pagination is offset-based — the in-memory catalog has stable ordering
// (refreshed once per day) so successive page fetches don't shuffle
// rows under the user.
func (h *Handler) catalog(w http.ResponseWriter, r *http.Request) {
	limit := 24
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	offset := 0
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	sortKey := r.URL.Query().Get("sort")
	category := r.URL.Query().Get("category")
	query := r.URL.Query().Get("q")

	var rows []catalogRow
	var total int

	if sortKey != "" {
		// Sort path: enrich every matched fund, sort, then paginate.
		// Cost is dominated by uncached history fetches; subsequent calls
		// hit Redis and are cheap.
		all := h.svc.FilterAll(category, query)
		total = len(all)
		rows = make([]catalogRow, len(all))
		var wg sync.WaitGroup
		for i := range all {
			wg.Add(1)
			go func(idx int, f Fund) {
				defer wg.Done()
				rows[idx] = h.buildCatalogRow(r.Context(), f)
			}(i, all[i])
		}
		wg.Wait()
		sortCatalogRows(rows, sortKey)
		end := offset + limit
		if offset > len(rows) {
			rows = []catalogRow{}
		} else {
			if end > len(rows) {
				end = len(rows)
			}
			rows = rows[offset:end]
		}
	} else {
		// No sort: paginate first, only enrich the visible page.
		funds, t := h.svc.Filter(category, query, limit, offset)
		total = t
		rows = make([]catalogRow, len(funds))
		var wg sync.WaitGroup
		for i := range funds {
			wg.Add(1)
			go func(idx int, f Fund) {
				defer wg.Done()
				rows[idx] = h.buildCatalogRow(r.Context(), f)
			}(i, funds[i])
		}
		wg.Wait()
	}

	hasMore := offset+len(rows) < total
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items":   rows,
		"total":   total,
		"offset":  offset,
		"hasMore": hasMore,
	})
}

// buildCatalogRow assembles one catalog row: NAV (preferring the worker's
// real-time cache for held/SIP'd funds, falling back to cached history)
// plus 1Y / 3Y / 5Y returns. Safe to call concurrently — every read goes
// through cache or single-flight upstream fetch.
func (h *Handler) buildCatalogRow(ctx context.Context, f Fund) catalogRow {
	row := catalogRow{Fund: f}

	// Real-time NAV from price.Cache wins when the worker has it (only
	// true for held / SIP'd funds). Catalog browsers fall through to the
	// history-derived NAV below.
	if h.cache != nil {
		if q, err := h.cache.Get(ctx, f.Ticker); err == nil && q != nil && q.Price.Sign() > 0 {
			row.Nav = &Nav{
				Value:     q.Price.String(),
				ChangePct: q.ChangePct.String(),
				AsOf:      q.UpdatedAt,
				Stale:     time.Since(q.UpdatedAt) > 36*time.Hour,
			}
		}
	}

	hist, err := h.fetchFullHistory(ctx, f.SchemeCode)
	if err != nil || len(hist) == 0 {
		return row
	}
	last := hist[len(hist)-1]

	if row.Nav == nil {
		var changePct string
		if len(hist) >= 2 {
			prev := hist[len(hist)-2]
			if prev.NAV > 0 {
				delta := (last.NAV - prev.NAV) / prev.NAV * 100
				changePct = fmt.Sprintf("%.4f", delta)
			}
		}
		row.Nav = &Nav{
			Value:     formatNav(last.NAV),
			ChangePct: changePct,
			AsOf:      last.When,
			Stale:     time.Since(last.When) > 36*time.Hour,
		}
	}

	row.OneYear = pointToPoint(hist, last.When.AddDate(-1, 0, 0), last.NAV)
	row.ThreeYear = cagr(hist, last.When.AddDate(-3, 0, 0), last.NAV, 3)
	row.FiveYear = cagr(hist, last.When.AddDate(-5, 0, 0), last.NAV, 5)
	return row
}

// sortCatalogRows sorts in place by the requested return window. Rows
// missing the return data sink to the bottom regardless of direction.
func sortCatalogRows(rows []catalogRow, key string) {
	asc := strings.HasSuffix(key, "-asc")
	field := strings.TrimSuffix(strings.TrimSuffix(key, "-asc"), "-desc")
	pick := func(r catalogRow) *float64 {
		switch field {
		case "oneYear":
			return r.OneYear
		case "threeYear":
			return r.ThreeYear
		case "fiveYear":
			return r.FiveYear
		}
		return nil
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := pick(rows[i]), pick(rows[j])
		if a == nil && b == nil {
			return false
		}
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		if asc {
			return *a < *b
		}
		return *a > *b
	})
}

func (h *Handler) fund(w http.ResponseWriter, r *http.Request) {
	ticker := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "ticker")))
	f, ok := h.svc.Find(ticker)
	if !ok {
		httpx.Error(w, r, httpx.ErrNotFound)
		return
	}
	nav, err := h.navFor(r.Context(), f)
	type resp struct {
		Fund
		Nav *Nav `json:"nav,omitempty"`
	}
	out := resp{Fund: f}
	if err == nil {
		out.Nav = &nav
	}
	httpx.JSON(w, http.StatusOK, out)
}

// navFor returns the latest NAV for a fund. Resolution order:
//  1. price.Cache (the worker keeps held/SIP'd MFs warm here)
//  2. Redis cached mfapi /latest response (1h TTL)
//  3. Live mfapi /latest fetch, with sync.Map de-duplication so a thundering
//     herd of catalog page-loads doesn't translate to a herd of upstream calls
func (h *Handler) navFor(ctx context.Context, f Fund) (Nav, error) {
	if h.cache != nil {
		if q, err := h.cache.Get(ctx, f.Ticker); err == nil && q != nil && q.Price.Sign() > 0 {
			return Nav{
				Value:     q.Price.String(),
				ChangePct: q.ChangePct.String(),
				AsOf:      q.UpdatedAt,
				Stale:     time.Since(q.UpdatedAt) > 36*time.Hour,
			}, nil
		}
	}
	return h.fetchNAV(ctx, f.SchemeCode)
}

// v2: switched upstream URL from /latest to full history so we get the
// previous-day NAV and can compute changePct. v1 entries (no changePct)
// are bypassed by the version bump and expire naturally via TTL.
const navCacheKey = "mf:nav:v2:%d"
const navCacheTTL = 60 * time.Minute

func (h *Handler) fetchNAV(ctx context.Context, schemeCode int) (Nav, error) {
	key := fmt.Sprintf(navCacheKey, schemeCode)
	if h.rdb != nil {
		if raw, err := h.rdb.Get(ctx, key).Bytes(); err == nil {
			var n Nav
			if err := json.Unmarshal(raw, &n); err == nil {
				return n, nil
			}
		}
	}

	// in-flight de-dup
	pending := &navFetch{done: make(chan struct{})}
	if existing, loaded := h.inflight.LoadOrStore(schemeCode, pending); loaded {
		p := existing.(*navFetch)
		select {
		case <-p.done:
			return p.nav, p.err
		case <-ctx.Done():
			return Nav{}, ctx.Err()
		}
	}
	defer func() {
		close(pending.done)
		h.inflight.Delete(schemeCode)
	}()

	// Full history (not /latest) so we get yesterday's NAV too and can
	// compute the day's % change. mfapi returns Data sorted desc by date,
	// so Data[0] is today and Data[1] is the prior business day.
	url := fmt.Sprintf("https://api.mfapi.in/mf/%d", schemeCode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		pending.err = err
		return Nav{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := h.svc.client.Do(req)
	if err != nil {
		pending.err = err
		return Nav{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		pending.err = fmt.Errorf("mfapi /latest %d: %s", schemeCode, resp.Status)
		return Nav{}, pending.err
	}
	var parsed struct {
		Status string `json:"status"`
		Data   []struct {
			Date string `json:"date"`
			NAV  string `json:"nav"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		pending.err = err
		return Nav{}, err
	}
	if parsed.Status != "SUCCESS" || len(parsed.Data) == 0 {
		pending.err = fmt.Errorf("mfapi /latest %d: empty", schemeCode)
		return Nav{}, pending.err
	}
	nav, err := decimal.NewFromString(parsed.Data[0].NAV)
	if err != nil || nav.Sign() <= 0 {
		pending.err = fmt.Errorf("mfapi /latest %d: bad nav %q", schemeCode, parsed.Data[0].NAV)
		return Nav{}, pending.err
	}
	when, err := time.Parse("02-01-2006", parsed.Data[0].Date)
	if err != nil {
		when = time.Now().UTC()
	}
	var changePct string
	if len(parsed.Data) > 1 {
		if prev, err := decimal.NewFromString(parsed.Data[1].NAV); err == nil && prev.Sign() > 0 {
			delta := nav.Sub(prev).Div(prev).Mul(decimal.NewFromInt(100))
			changePct = delta.Round(4).String()
		}
	}
	out := Nav{
		Value:     nav.Round(4).String(),
		ChangePct: changePct,
		AsOf:      when.UTC(),
		Stale:     time.Since(when) > 36*time.Hour,
	}
	pending.nav = out
	if h.rdb != nil {
		if b, err := json.Marshal(out); err == nil {
			_ = h.rdb.Set(ctx, key, b, navCacheTTL).Err()
		}
	}
	return out, nil
}
