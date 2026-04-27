package price

import (
	"compress/gzip"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// upstoxInstrumentsURL is Upstox's official daily-refreshed dump of every
// instrument across NSE/BSE — equities, derivatives, indices. ~25 MB
// compressed, ~120 MB uncompressed.
const upstoxInstrumentsURL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz"

// dynamic instrument keys discovered from the CSV at runtime. The hardcoded
// `UpstoxInstrumentKeys` map takes priority — those entries are curated for
// a specific exchange and ISIN (some symbols exist on multiple exchanges).
var (
	dynamicMu             sync.RWMutex
	dynamicInstrumentKeys = map[string]string{}
	dynamicLoadedAt       time.Time
)

// Instrument is a row from the Upstox CSV, narrowed to the fields the
// search index cares about.
type Instrument struct {
	Symbol   string // tradingsymbol, e.g. "RELIANCE"
	Name     string // human-readable, e.g. "RELIANCE INDUSTRIES LTD"
	Key      string // Upstox instrument key, e.g. "NSE_EQ|INE002A01018"
	Exchange string // "NSE" / "BSE"
	Type     string // "EQ"
}

var (
	instrumentsMu sync.RWMutex
	instruments   []Instrument            // every NSE EQ row from the latest CSV
	bySymbol      map[string]Instrument   // O(1) symbol → instrument
)

// SearchInstruments returns up to `limit` results matching `q`, in priority
// order: exact symbol match → symbol prefix → name contains. Case-
// insensitive. Returns nil if the CSV hasn't loaded yet or no rows match —
// callers should fall back to Yahoo in that case.
func SearchInstruments(q string, limit int) []Instrument {
	out, _ := SearchInstrumentsPaged(q, limit, 0)
	return out
}

// SearchInstrumentsPaged is the paginating version of SearchInstruments.
// `offset` skips that many matched results before collecting; useful for
// the stocks browse page's infinite scroll. Returns the collected slice
// and the total number of matches across the whole instrument index.
//
// The internal capping behaviour of SearchInstruments (`limit*4` work
// budget) is dropped here because pagination requires us to know the
// true total — we walk the full instrument list. ~9000 NSE EQ rows is
// fast enough that this is fine for an interactive endpoint.
func SearchInstrumentsPaged(q string, limit, offset int) ([]Instrument, int) {
	q = strings.ToUpper(strings.TrimSpace(q))
	if q == "" {
		return nil, 0
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	instrumentsMu.RLock()
	defer instrumentsMu.RUnlock()
	if len(instruments) == 0 {
		return nil, 0
	}

	var exact, prefix, fuzzy []Instrument
	for i := range instruments {
		ins := instruments[i]
		symU := strings.ToUpper(ins.Symbol)
		nameU := strings.ToUpper(ins.Name)
		switch {
		case symU == q:
			exact = append(exact, ins)
		case strings.HasPrefix(symU, q):
			prefix = append(prefix, ins)
		case strings.Contains(nameU, q):
			fuzzy = append(fuzzy, ins)
		}
	}
	full := append(exact, prefix...)
	full = append(full, fuzzy...)
	total := len(full)
	if offset >= total {
		return nil, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	// Defensive copy — we hold a read-locked slice into our internal
	// state and don't want callers to retain a reference to it.
	out := make([]Instrument, end-offset)
	copy(out, full[offset:end])
	return out, total
}

// LookupUpstoxKey returns the v2 instrument key for a ticker. Tries the
// hardcoded map first, then the CSV-loaded map. Returns "", false if
// neither has it (caller should fall back to Yahoo or skip the ticker).
func LookupUpstoxKey(ticker string) (string, bool) {
	if k, ok := UpstoxInstrumentKeys[ticker]; ok {
		return k, true
	}
	dynamicMu.RLock()
	k, ok := dynamicInstrumentKeys[ticker]
	dynamicMu.RUnlock()
	return k, ok
}

// DynamicInstrumentsLoaded reports whether the CSV has been parsed at least
// once. Useful for log lines / status pages.
func DynamicInstrumentsLoaded() (bool, int, time.Time) {
	dynamicMu.RLock()
	defer dynamicMu.RUnlock()
	return !dynamicLoadedAt.IsZero(), len(dynamicInstrumentKeys), dynamicLoadedAt
}

// LookupInstrument returns the full Instrument record for `ticker` (NSE
// tradingsymbol, e.g. "RELIANCE"). Returns (zero, false) before the
// Upstox CSV has loaded or for unknown symbols — the UI then shows the
// bare ticker without a name, which is the right fallback for a
// transient warm-up state (better than displaying stale curated data).
func LookupInstrument(ticker string) (Instrument, bool) {
	instrumentsMu.RLock()
	defer instrumentsMu.RUnlock()
	if bySymbol == nil {
		return Instrument{}, false
	}
	ins, ok := bySymbol[ticker]
	return ins, ok
}

// LoadUpstoxInstruments downloads + parses the Upstox CSV and populates the
// dynamic key map. Safe to call multiple times — each successful parse
// replaces the previous map atomically.
//
// Failure modes (network down, CSV moved, format change) are non-fatal:
// the function logs + returns, and the hardcoded map keeps serving.
func LoadUpstoxInstruments(ctx context.Context) error {
	log.Info().Str("url", upstoxInstrumentsURL).Msg("upstox: downloading instruments CSV (~25 MB)")
	start := time.Now()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstoxInstrumentsURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstox CSV: %s", resp.Status)
	}

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("gunzip: %w", err)
	}
	defer gz.Close()

	r := csv.NewReader(gz)
	r.FieldsPerRecord = -1 // some rows may have empty trailing cells

	header, err := r.Read()
	if err != nil {
		return fmt.Errorf("read header: %w", err)
	}
	col := func(name string) int {
		for i, h := range header {
			if strings.EqualFold(strings.TrimSpace(h), name) {
				return i
			}
		}
		return -1
	}
	keyCol := col("instrument_key")
	symCol := col("tradingsymbol")
	typeCol := col("instrument_type")
	exchCol := col("exchange")
	nameCol := col("name")

	if keyCol < 0 || symCol < 0 {
		return errors.New("upstox CSV missing instrument_key / tradingsymbol columns")
	}

	nextMap := make(map[string]string, 4096)
	nextList := make([]Instrument, 0, 4096)
	rows := 0
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			// Malformed row — skip rather than fail the whole load.
			continue
		}
		rows++
		if !idxOK(rec, symCol) || !idxOK(rec, keyCol) {
			continue
		}
		sym := strings.TrimSpace(rec[symCol])
		key := strings.TrimSpace(rec[keyCol])
		if sym == "" || key == "" {
			continue
		}
		// We only want NSE equities. Use the instrument_key prefix as the
		// source of truth — across Upstox CSV versions the `exchange`
		// column has been "NSE", "NSE_EQ", or sometimes blank, but the
		// instrument key is always "NSE_EQ|<ISIN>" for NSE stocks. This
		// also naturally excludes indices (NSE_INDEX|), derivatives
		// (NSE_FO|), and BSE rows.
		if !strings.HasPrefix(key, "NSE_EQ|") {
			continue
		}
		var instType string
		if typeCol >= 0 && idxOK(rec, typeCol) {
			instType = strings.ToUpper(strings.TrimSpace(rec[typeCol]))
		}
		var exch string
		if exchCol >= 0 && idxOK(rec, exchCol) {
			exch = strings.ToUpper(strings.TrimSpace(rec[exchCol]))
		}
		var name string
		if nameCol >= 0 && idxOK(rec, nameCol) {
			name = strings.TrimSpace(rec[nameCol])
		}
		nextMap[sym] = key
		nextList = append(nextList, Instrument{
			Symbol:   sym,
			Name:     name,
			Key:      key,
			Exchange: exch,
			Type:     instType,
		})
	}

	dynamicMu.Lock()
	dynamicInstrumentKeys = nextMap
	dynamicLoadedAt = time.Now()
	dynamicMu.Unlock()

	nextBySymbol := make(map[string]Instrument, len(nextList))
	for _, ins := range nextList {
		nextBySymbol[ins.Symbol] = ins
	}

	instrumentsMu.Lock()
	instruments = nextList
	bySymbol = nextBySymbol
	instrumentsMu.Unlock()

	log.Info().
		Int("rows", rows).
		Int("accepted", len(nextMap)).
		Dur("took", time.Since(start)).
		Msg("upstox: instruments loaded")
	return nil
}

// idxOK guards against malformed rows that have fewer columns than the
// header promised.
func idxOK(rec []string, i int) bool {
	return i >= 0 && i < len(rec)
}
