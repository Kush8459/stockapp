package price

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

// UpstoxInstrumentKeys maps our bare tickers to Upstox v2 instrument keys.
// Key formats:
//   - NSE stocks: "NSE_EQ|<ISIN>" — ISINs are stable across renames.
//   - NSE indices: "NSE_INDEX|<Display Name>" with a literal space.
//   - BSE indices: "BSE_INDEX|<Display Name>".
//
// To extend stocks, look up the ISIN in the official Upstox CSV
// https://assets.upstox.com/market-quote/instruments/exchange/complete.csv.gz
// or on bseindia.com / nseindia.com.
var UpstoxInstrumentKeys = map[string]string{
	// ── Equities — indexable for heatmaps + holdings + search ──
	"RELIANCE":   "NSE_EQ|INE002A01018",
	"TCS":        "NSE_EQ|INE467B01029",
	"INFY":       "NSE_EQ|INE009A01021",
	"HDFCBANK":   "NSE_EQ|INE040A01034",
	"ICICIBANK":  "NSE_EQ|INE090A01021",
	"SBIN":       "NSE_EQ|INE062A01020",
	"WIPRO":      "NSE_EQ|INE075A01022",
	"ITC":        "NSE_EQ|INE154A01025",
	"AXISBANK":   "NSE_EQ|INE238A01034",
	"KOTAKBANK":  "NSE_EQ|INE237A01028",
	"HCLTECH":    "NSE_EQ|INE860A01027",
	"TECHM":      "NSE_EQ|INE669C01036",
	"ONGC":       "NSE_EQ|INE213A01029",
	"NTPC":       "NSE_EQ|INE733E01010",
	"POWERGRID":  "NSE_EQ|INE752E01010",
	"COALINDIA":  "NSE_EQ|INE522F01014",
	"HINDUNILVR": "NSE_EQ|INE030A01027",
	"NESTLEIND":  "NSE_EQ|INE239A01024",
	"BRITANNIA":  "NSE_EQ|INE216A01030",
	"DABUR":      "NSE_EQ|INE016A01026",
	"MARUTI":     "NSE_EQ|INE585B01010",
	"TATAMOTORS": "NSE_EQ|INE155A01022",
	"M&M":        "NSE_EQ|INE101A01026",
	"BAJAJ-AUTO": "NSE_EQ|INE917I01010",
	"HEROMOTOCO": "NSE_EQ|INE158A01026",
	"SUNPHARMA":  "NSE_EQ|INE044A01036",
	"DRREDDY":    "NSE_EQ|INE089A01023",
	"CIPLA":      "NSE_EQ|INE059A01026",
	"DIVISLAB":   "NSE_EQ|INE361B01024",
	"TATASTEEL":  "NSE_EQ|INE081A01020",
	"JSWSTEEL":   "NSE_EQ|INE019A01038",
	"HINDALCO":   "NSE_EQ|INE038A01020",
	"VEDL":       "NSE_EQ|INE205A01025",

	// ── Broad indices ──
	"NIFTY50":      "NSE_INDEX|Nifty 50",
	"SENSEX":       "BSE_INDEX|SENSEX",
	"NIFTYNEXT50":  "NSE_INDEX|Nifty Next 50",
	"NIFTYMIDCAP":  "NSE_INDEX|Nifty Midcap 100",

	// ── Sectoral indices ──
	"BANKNIFTY":    "NSE_INDEX|Nifty Bank",
	"NIFTYIT":      "NSE_INDEX|Nifty IT",
	"NIFTYAUTO":    "NSE_INDEX|Nifty Auto",
	"NIFTYPHARMA":  "NSE_INDEX|Nifty Pharma",
	"NIFTYFMCG":    "NSE_INDEX|Nifty FMCG",
	"NIFTYMETAL":   "NSE_INDEX|Nifty Metal",
	"NIFTYREALTY":  "NSE_INDEX|Nifty Realty",
	"NIFTYENERGY":  "NSE_INDEX|Nifty Energy",
	"NIFTYMEDIA":   "NSE_INDEX|Nifty Media",
	"NIFTYPSUBANK": "NSE_INDEX|Nifty PSU Bank",
	"NIFTYFINSRV":  "NSE_INDEX|Nifty Financial Services",
}

type upstoxQuoteResp struct {
	Status string                      `json:"status"`
	Data   map[string]upstoxQuoteEntry `json:"data"`
	Errors []struct {
		ErrorCode string `json:"error_code"`
		Message   string `json:"message"`
	} `json:"errors"`
}

type upstoxQuoteEntry struct {
	InstrumentToken string  `json:"instrument_token"`
	Symbol          string  `json:"symbol"`
	LastPrice       float64 `json:"last_price"`
	OHLC            struct {
		Open  float64 `json:"open"`
		High  float64 `json:"high"`
		Low   float64 `json:"low"`
		Close float64 `json:"close"`
	} `json:"ohlc"`
	NetChange float64 `json:"net_change"`
}

// RunUpstoxFeed polls the Upstox v2 market-quote/quotes endpoint every
// `poll` for the given NSE tickers and writes ticks into the cache. Blocks
// until ctx is cancelled.
//
// Notes:
//   - The bearer token expires daily at ~3:30 AM IST. After that, every
//     fetch returns 401; the feed keeps trying (so it recovers automatically
//     once the user pastes a fresh token and restarts), but the right move
//     is to re-run cmd/upstox-login.
//   - Tickers not in UpstoxInstrumentKeys are skipped with a warning. Add
//     them to the map if you want them streamed.
//   - REST polling, not the v3 WebSocket, deliberately: keeps the plumbing
//     identical to Yahoo and avoids the protobuf decode the WS feed needs.
func RunUpstoxFeed(
	ctx context.Context,
	cache *Cache,
	token string,
	tickers []string,
	poll time.Duration,
) error {
	if token == "" {
		return fmt.Errorf("upstox: access token is empty (set UPSTOX_ACCESS_TOKEN)")
	}
	if len(tickers) == 0 {
		<-ctx.Done()
		return ctx.Err()
	}
	if poll <= 0 {
		poll = 5 * time.Second
	}

	keys := make([]string, 0, len(tickers))
	keyToTicker := make(map[string]string, len(tickers))
	skipped := 0
	for _, t := range tickers {
		k, ok := LookupUpstoxKey(t)
		if !ok {
			log.Warn().Str("ticker", t).Msg("upstox: no instrument key, skipping")
			skipped++
			continue
		}
		keys = append(keys, k)
		keyToTicker[k] = t
	}
	if len(keys) == 0 {
		<-ctx.Done()
		return ctx.Err()
	}

	log.Info().
		Int("tickers", len(keys)).
		Int("skipped", skipped).
		Dur("poll", poll).
		Msg("upstox feed starting")

	client := newHTTPClient()
	if err := upstoxFetch(ctx, client, cache, token, keys, keyToTicker); err != nil {
		log.Warn().Err(err).Msg("upstox initial fetch failed")
	}

	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			if err := upstoxFetch(ctx, client, cache, token, keys, keyToTicker); err != nil {
				log.Warn().Err(err).Msg("upstox fetch failed")
			}
		}
	}
}

func upstoxFetch(
	ctx context.Context,
	client *http.Client,
	cache *Cache,
	token string,
	keys []string,
	keyToTicker map[string]string,
) error {
	q := url.Values{}
	q.Set("symbol", strings.Join(keys, ","))
	endpoint := "https://api.upstox.com/v2/market-quote/quotes?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Api-Version", "2.0")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("upstox: 401 unauthorized — token expired? re-run cmd/upstox-login and restart")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstox: %s", resp.Status)
	}

	var parsed upstoxQuoteResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return fmt.Errorf("decode upstox: %w", err)
	}
	if len(parsed.Errors) > 0 {
		first := parsed.Errors[0]
		return fmt.Errorf("upstox api error: %s — %s", first.ErrorCode, first.Message)
	}

	now := time.Now().UTC()
	for dataKey, e := range parsed.Data {
		ticker := matchUpstoxTicker(dataKey, e, keyToTicker)
		if ticker == "" || e.LastPrice <= 0 {
			continue
		}
		price := decimal.NewFromFloat(e.LastPrice)
		// Prev-close priority chain:
		//   1. last_price - net_change — trustworthy any time of day, since
		//      net_change is always "vs yesterday's regular close"
		//   2. ohlc.close — only useful when it differs from last_price
		//      (during market hours = previous-session close; off-hours it
		//      typically equals last_price and tells us nothing)
		//   3. last_price — final fallback, change collapses to 0
		var prev decimal.Decimal
		switch {
		case e.NetChange != 0:
			prev = decimal.NewFromFloat(e.LastPrice - e.NetChange)
		case e.OHLC.Close > 0 && e.OHLC.Close != e.LastPrice:
			prev = decimal.NewFromFloat(e.OHLC.Close)
		default:
			prev = price
		}
		changePct := decimal.Zero
		if prev.Sign() > 0 && !prev.Equal(price) {
			changePct = price.Sub(prev).Div(prev).Mul(decimal.NewFromInt(100))
		}
		if err := cache.Set(ctx, Quote{
			Ticker:    ticker,
			Price:     price.Round(2),
			PrevClose: prev.Round(2),
			ChangePct: changePct.Round(4),
			UpdatedAt: now,
		}); err != nil {
			log.Warn().Err(err).Str("ticker", ticker).Msg("upstox: cache set failed")
		}
	}
	return nil
}

// matchUpstoxTicker maps an Upstox response entry back to our bare ticker.
// Upstox's data map is keyed by "EXCHANGE:SYMBOL" (e.g. "NSE_EQ:RELIANCE"),
// while the instrument_token field uses "EXCHANGE|ISIN". Try both, since
// Upstox has historically been inconsistent across endpoint versions.
func matchUpstoxTicker(
	dataKey string,
	e upstoxQuoteEntry,
	keyToTicker map[string]string,
) string {
	if t, ok := keyToTicker[e.InstrumentToken]; ok {
		return t
	}
	// Fallback: map "NSE_EQ:RELIANCE" → "RELIANCE" if our symbol matches.
	if i := strings.IndexByte(dataKey, ':'); i > 0 {
		sym := dataKey[i+1:]
		if _, ok := UpstoxInstrumentKeys[sym]; ok {
			return sym
		}
	}
	if e.Symbol != "" {
		if _, ok := UpstoxInstrumentKeys[e.Symbol]; ok {
			return e.Symbol
		}
	}
	return ""
}
