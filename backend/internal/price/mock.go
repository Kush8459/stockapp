package price

import (
	"context"
	"math/rand"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

// MockUniverse is the set of tickers the mock feed will produce quotes for.
// Prices roughly match Indian equities + mutual funds used in the demo seed,
// plus the major NSE/BSE indices for the market-context bar. Real providers
// override these at runtime.
var MockUniverse = map[string]decimal.Decimal{
	// Equities
	"RELIANCE":   decimal.NewFromInt(2480),
	"TCS":        decimal.NewFromInt(3900),
	"INFY":       decimal.NewFromInt(1580),
	"HDFCBANK":   decimal.NewFromInt(1680),
	"ICICIBANK":  decimal.NewFromInt(1120),
	"SBIN":       decimal.NewFromInt(760),
	"WIPRO":      decimal.NewFromInt(530),
	"ITC":        decimal.NewFromInt(440),
	"AXISBANK":   decimal.NewFromInt(1090),
	"KOTAKBANK":  decimal.NewFromInt(1750),
	"HCLTECH":    decimal.NewFromInt(1620),
	"TECHM":      decimal.NewFromInt(1540),
	"ONGC":       decimal.NewFromInt(245),
	"NTPC":       decimal.NewFromInt(345),
	"POWERGRID":  decimal.NewFromInt(310),
	"COALINDIA":  decimal.NewFromInt(420),
	"HINDUNILVR": decimal.NewFromInt(2380),
	"NESTLEIND":  decimal.NewFromInt(2450),
	"BRITANNIA":  decimal.NewFromInt(4800),
	"DABUR":      decimal.NewFromInt(530),
	"MARUTI":     decimal.NewFromInt(11200),
	"TATAMOTORS": decimal.NewFromInt(720),
	"M&M":        decimal.NewFromInt(2780),
	"BAJAJ-AUTO": decimal.NewFromInt(8900),
	"HEROMOTOCO": decimal.NewFromInt(4400),
	"SUNPHARMA":  decimal.NewFromInt(1740),
	"DRREDDY":    decimal.NewFromInt(1280),
	"CIPLA":      decimal.NewFromInt(1480),
	"DIVISLAB":   decimal.NewFromInt(5600),
	"TATASTEEL":  decimal.NewFromInt(140),
	"JSWSTEEL":   decimal.NewFromInt(940),
	"HINDALCO":   decimal.NewFromInt(680),
	"VEDL":       decimal.NewFromInt(440),

	// Mutual funds
	"AXISBLUE": decimal.NewFromInt(62),
	"PPFAS":    decimal.NewFromInt(88),
	"QUANTSM":  decimal.NewFromInt(278),
	"MIRAE":    decimal.NewFromInt(110),

	// Broad indices — not tradeable, just for the market-context strip.
	"NIFTY50":     decimal.NewFromInt(24000),
	"SENSEX":      decimal.NewFromInt(78000),
	"NIFTYNEXT50": decimal.NewFromInt(72000),
	"NIFTYMIDCAP": decimal.NewFromInt(57000),

	// Sectoral indices — for the right sidebar.
	"BANKNIFTY":    decimal.NewFromInt(52000),
	"NIFTYIT":      decimal.NewFromInt(38000),
	"NIFTYAUTO":    decimal.NewFromInt(24500),
	"NIFTYPHARMA":  decimal.NewFromInt(21500),
	"NIFTYFMCG":    decimal.NewFromInt(57000),
	"NIFTYMETAL":   decimal.NewFromInt(9400),
	"NIFTYREALTY":  decimal.NewFromInt(1080),
	"NIFTYENERGY":  decimal.NewFromInt(40000),
	"NIFTYMEDIA":   decimal.NewFromInt(1730),
	"NIFTYPSUBANK": decimal.NewFromInt(7100),
	"NIFTYFINSRV":  decimal.NewFromInt(23700),
}

// BroadIndexTickers is what the top market-context bar surfaces.
var BroadIndexTickers = []string{"NIFTY50", "SENSEX", "BANKNIFTY", "NIFTYIT"}

// SectoralIndexTickers is what the right sidebar surfaces — the order here
// is the display order in the UI.
var SectoralIndexTickers = []string{
	"BANKNIFTY", "NIFTYIT", "NIFTYAUTO", "NIFTYPHARMA", "NIFTYFMCG",
	"NIFTYMETAL", "NIFTYENERGY", "NIFTYREALTY", "NIFTYMEDIA",
	"NIFTYPSUBANK", "NIFTYFINSRV",
}

// RunMockFeed streams synthetic price ticks into the cache. It walks each
// ticker's price with a small mean-reverting random step, publishes updates
// on a per-ticker cadence, and updates the "previous close" once per day.
//
// This keeps the whole real-time pipeline demoable end-to-end without any
// third-party API keys.
func RunMockFeed(ctx context.Context, cache *Cache, tickFreq time.Duration) error {
	if tickFreq <= 0 {
		tickFreq = 2 * time.Second
	}
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))

	type state struct {
		price     decimal.Decimal
		prevClose decimal.Decimal
	}
	states := make(map[string]*state, len(MockUniverse))
	for t, p := range MockUniverse {
		states[t] = &state{price: p, prevClose: p}
	}

	// Seed Redis with an initial quote for every ticker so the UI has data
	// on first paint even before the first tick fires.
	now := time.Now().UTC()
	for t, st := range states {
		_ = cache.Set(ctx, Quote{
			Ticker:    t,
			Price:     st.price,
			PrevClose: st.prevClose,
			ChangePct: decimal.Zero,
			UpdatedAt: now,
		})
	}
	log.Info().Int("tickers", len(states)).Msg("mock price feed seeded")

	ticker := time.NewTicker(tickFreq)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case now := <-ticker.C:
			// Pick ~3 tickers per tick to update — mimics bursty real feeds.
			names := keysOf(states)
			rnd.Shuffle(len(names), func(i, j int) { names[i], names[j] = names[j], names[i] })
			budget := 3
			if budget > len(names) {
				budget = len(names)
			}
			for _, t := range names[:budget] {
				st := states[t]
				st.price = randomWalk(rnd, st.price, st.prevClose)
				changePct := decimal.Zero
				if !st.prevClose.IsZero() {
					changePct = st.price.Sub(st.prevClose).Div(st.prevClose).Mul(decimal.NewFromInt(100))
				}
				_ = cache.Set(ctx, Quote{
					Ticker:    t,
					Price:     st.price.Round(2),
					PrevClose: st.prevClose,
					ChangePct: changePct.Round(4),
					UpdatedAt: now.UTC(),
				})
			}
		}
	}
}

func keysOf[K comparable, V any](m map[K]V) []K {
	out := make([]K, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// randomWalk returns a new price sampled around cur, with a mild pull back
// towards anchor so values don't drift unboundedly over long runs.
func randomWalk(rnd *rand.Rand, cur, anchor decimal.Decimal) decimal.Decimal {
	// Step is in ±0.4% of current price, plus a 0.05% pull toward anchor.
	curF, _ := cur.Float64()
	anchorF, _ := anchor.Float64()
	step := (rnd.Float64()*2 - 1) * 0.004 * curF
	pull := (anchorF - curF) * 0.0005
	next := curF + step + pull
	if next < 0.01 {
		next = 0.01
	}
	return decimal.NewFromFloat(next)
}
