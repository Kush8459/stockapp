package price

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

// NSESymbols maps our bare tickers to Yahoo's NSE/BSE symbol form. Anything
// not here is assumed to already be a Yahoo symbol (useful for US stocks).
// Indices are included so the same code path covers the market-context bar.
var NSESymbols = map[string]string{
	// Equities
	"RELIANCE":   "RELIANCE.NS",
	"TCS":        "TCS.NS",
	"INFY":       "INFY.NS",
	"HDFCBANK":   "HDFCBANK.NS",
	"ICICIBANK":  "ICICIBANK.NS",
	"SBIN":       "SBIN.NS",
	"WIPRO":      "WIPRO.NS",
	"ITC":        "ITC.NS",
	"AXISBANK":   "AXISBANK.NS",
	"KOTAKBANK":  "KOTAKBANK.NS",
	"HCLTECH":    "HCLTECH.NS",
	"TECHM":      "TECHM.NS",
	"ONGC":       "ONGC.NS",
	"NTPC":       "NTPC.NS",
	"POWERGRID":  "POWERGRID.NS",
	"COALINDIA":  "COALINDIA.NS",
	"HINDUNILVR": "HINDUNILVR.NS",
	"NESTLEIND":  "NESTLEIND.NS",
	"BRITANNIA":  "BRITANNIA.NS",
	"DABUR":      "DABUR.NS",
	"MARUTI":     "MARUTI.NS",
	"TATAMOTORS": "TATAMOTORS.NS",
	"M&M":        "M%26M.NS",
	"BAJAJ-AUTO": "BAJAJ-AUTO.NS",
	"HEROMOTOCO": "HEROMOTOCO.NS",
	"SUNPHARMA":  "SUNPHARMA.NS",
	"DRREDDY":    "DRREDDY.NS",
	"CIPLA":      "CIPLA.NS",
	"DIVISLAB":   "DIVISLAB.NS",
	"TATASTEEL":  "TATASTEEL.NS",
	"JSWSTEEL":   "JSWSTEEL.NS",
	"HINDALCO":   "HINDALCO.NS",
	"VEDL":       "VEDL.NS",

	// Broad indices
	"NIFTY50":     "^NSEI",
	"SENSEX":      "^BSESN",
	"NIFTYNEXT50": "^NSMIDCP", // Yahoo doesn't expose ^NIFTYNEXT50 directly; this is a near substitute
	"NIFTYMIDCAP": "^NSEMDCP50",

	// Sectoral indices
	"BANKNIFTY":    "^NSEBANK",
	"NIFTYIT":      "^CNXIT",
	"NIFTYAUTO":    "^CNXAUTO",
	"NIFTYPHARMA":  "^CNXPHARMA",
	"NIFTYFMCG":    "^CNXFMCG",
	"NIFTYMETAL":   "^CNXMETAL",
	"NIFTYREALTY":  "^CNXREALTY",
	"NIFTYENERGY":  "^CNXENERGY",
	"NIFTYMEDIA":   "^CNXMEDIA",
	"NIFTYPSUBANK": "^CNXPSUBANK",
	"NIFTYFINSRV":  "NIFTY_FIN_SERVICE.NS",
}

// YahooChartResponse captures just the fields we care about from the v8
// chart endpoint. Full schema is larger — we're deliberately narrow.
//
// Note on indicators: for some indices (^NSEI, ^NSEBANK) Yahoo returns
// regularMarketPrice = 0 on weekends, and the actual last close is only
// in indicators.quote[0].close[]. We fall back to the last non-zero
// element of that array.
type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				RegularMarketPrice float64 `json:"regularMarketPrice"`
				ChartPreviousClose float64 `json:"chartPreviousClose"`
				PreviousClose      float64 `json:"previousClose"`
				Currency           string  `json:"currency"`
				RegularMarketTime  int64   `json:"regularMarketTime"`
			} `json:"meta"`
			Indicators struct {
				Quote []struct {
					Close []float64 `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

// lastNonZeroClose pulls the most recent valid close out of the indicators
// array. Returns 0 if nothing usable. Yahoo sometimes pads the tail with
// zeros for the current bar before market data arrives.
func lastNonZeroClose(closes []float64) float64 {
	for i := len(closes) - 1; i >= 0; i-- {
		if closes[i] > 0 {
			return closes[i]
		}
	}
	return 0
}

// RunYahooFeed polls each ticker's Yahoo chart endpoint every `poll` and
// publishes quotes into the cache. Blocks until ctx is cancelled.
//
// Notes:
//   - Yahoo rate-limits aggressively. We stagger tickers across the window
//     instead of firing them all at once.
//   - Any per-ticker failure is logged and skipped — we don't want one bad
//     symbol to take down the feed.
//   - When a symbol isn't in NSESymbols we treat the bare ticker as the
//     Yahoo symbol (so e.g. "AAPL" would work for US stocks).
func RunYahooFeed(ctx context.Context, cache *Cache, tickers []string, poll time.Duration) error {
	if len(tickers) == 0 {
		<-ctx.Done()
		return ctx.Err()
	}
	if poll <= 0 {
		poll = 30 * time.Second
	}
	client := newHTTPClient()
	log.Info().Int("tickers", len(tickers)).Dur("poll", poll).Msg("yahoo feed starting")

	// Fire once immediately; then on a ticker.
	fetchAll(ctx, client, cache, tickers)

	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			fetchAll(ctx, client, cache, tickers)
		}
	}
}

func fetchAll(ctx context.Context, client *http.Client, cache *Cache, tickers []string) {
	// Stagger: the slot within the poll window each ticker takes.
	step := 250 * time.Millisecond
	for i, t := range tickers {
		if i > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(step):
			}
		}
		if err := fetchOne(ctx, client, cache, t); err != nil {
			log.Warn().Err(err).Str("ticker", t).Msg("yahoo fetch failed")
		}
	}
}

func fetchOne(ctx context.Context, client *http.Client, cache *Cache, ticker string) error {
	symbol, ok := NSESymbols[ticker]
	if !ok {
		// Default any unmapped ticker to its NSE form. Yahoo's chart
		// endpoint expects "RELIANCE.NS", not bare "RELIANCE", so without
		// this fallback every CSV-discovered NSE stock 404s. Tickers with
		// `.`, `-`, or `^` are assumed to already be Yahoo symbols
		// (BTC-USD, ^NSEI, M&M.NS).
		if strings.ContainsAny(ticker, ".-^") {
			symbol = ticker
		} else {
			symbol = ticker + ".NS"
		}
	}
	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1m&range=1d",
		symbol,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("yahoo %s: %s", symbol, resp.Status)
	}

	var parsed yahooChartResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return fmt.Errorf("decode yahoo response: %w", err)
	}
	if parsed.Chart.Error != nil {
		return fmt.Errorf("yahoo api error: %s", parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return fmt.Errorf("yahoo: no result for %s", symbol)
	}
	res := parsed.Chart.Result[0]
	meta := res.Meta

	priceVal := meta.RegularMarketPrice
	if priceVal <= 0 && len(res.Indicators.Quote) > 0 {
		// Fallback for indices whose meta lacks regularMarketPrice
		// (Yahoo's response shape varies by symbol).
		priceVal = lastNonZeroClose(res.Indicators.Quote[0].Close)
	}
	if priceVal <= 0 {
		return fmt.Errorf("yahoo: zero/negative price for %s", symbol)
	}

	prevClose := meta.ChartPreviousClose
	if prevClose == 0 {
		prevClose = meta.PreviousClose
	}

	price := decimal.NewFromFloat(priceVal)
	prev := decimal.NewFromFloat(prevClose)
	changePct := decimal.Zero
	if !prev.IsZero() {
		changePct = price.Sub(prev).Div(prev).Mul(decimal.NewFromInt(100))
	}

	ts := time.Now().UTC()
	if meta.RegularMarketTime > 0 {
		ts = time.Unix(meta.RegularMarketTime, 0).UTC()
	}

	return cache.Set(ctx, Quote{
		Ticker:    ticker,
		Price:     price.Round(2),
		PrevClose: prev.Round(2),
		ChangePct: changePct.Round(4),
		UpdatedAt: ts,
	})
}
