package price

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"
)

// Quote is a single live price snapshot.
type Quote struct {
	Ticker    string          `json:"ticker"`
	Price     decimal.Decimal `json:"price"`
	PrevClose decimal.Decimal `json:"prevClose"`
	ChangePct decimal.Decimal `json:"changePct"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// Cache wraps the Redis quote store and the price fan-out pub/sub channel.
//
// `lastWritten` is an in-process dedup map: skip Redis writes for ticks
// whose price hasn't moved since the last write. Each Cache.Set is 5
// Redis commands (SET + RPUSH + LTRIM + EXPIRE + PUBLISH); on a flat
// market that's a lot of pointless traffic for Upstash's command quota.
// Refresh the dedup entry every refreshInterval anyway so a stuck
// cached value can't outlive the cache TTL.
type Cache struct {
	rdb         *redis.Client
	ttl         time.Duration
	lastWritten sync.Map // ticker → lastWriteEntry
}

type lastWriteEntry struct {
	price     decimal.Decimal
	changePct decimal.Decimal
	at        time.Time
}

// refreshInterval bounds how long a deduplicated price may go without
// being re-written to Redis. Without this, a flat ticker would never
// refresh its TTL and would silently expire after 24 h. 1 h is short
// enough to prevent expiry but still saves >95 % of writes on flat names.
const refreshInterval = 1 * time.Hour

func NewCache(rdb *redis.Client) *Cache {
	// Long TTL so off-hours snapshots stick across WS reconnects + the
	// trading-day gap. During market hours the WS overwrites with each tick.
	return &Cache{rdb: rdb, ttl: 24 * time.Hour}
}

func quoteKey(ticker string) string   { return "price:" + ticker }
func historyKey(ticker string) string { return "price:hist:" + ticker }

// istLoc is the IST location used for the schedule check below. Cached
// once at package init so the worker hot-path doesn't re-parse the zone
// string every poll.
var istLoc = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		// Fallback: fixed +05:30 offset. Only the OS-tzdata-less builds
		// ever take this path (e.g. the distroless production image
		// pulls in tzdata, so this is mostly defensive).
		return time.FixedZone("IST", 5*60*60+30*60)
	}
	return loc
}()

// IsMarketActive reports whether the Indian equity market is currently
// in pre-open or open session. Workers gate their poll loops on this so
// the worker isn't burning Redis writes re-caching the same EOD price
// 17.5 hours/day overnight.
//
// Window: Mon–Fri, 08:55–15:35 IST (5 min buffers around the official
// 09:00 pre-open and 15:30 close). Holidays are NOT consulted here to
// keep the price package import-graph clean — the ~15 NSE holidays/year
// are a 6 % waste, acceptable for now. If that becomes a problem, lift
// `market.CurrentStatus` into a leaf package both `price` and `market`
// can import.
func IsMarketActive() bool {
	now := time.Now().In(istLoc)
	wd := now.Weekday()
	if wd == time.Saturday || wd == time.Sunday {
		return false
	}
	mins := now.Hour()*60 + now.Minute()
	return mins >= 8*60+55 && mins <= 15*60+35
}

const (
	PubSubChannel = "prices:stream"
	// HistoryLen is the ring-buffer size per ticker. At a 2s worker cadence
	// this is ~8 minutes of recent ticks — enough for a live sparkline.
	HistoryLen = 240
)

// Set writes the latest quote, appends it to the per-ticker ring buffer, and
// publishes it for any WebSocket subscribers.
//
// Skips the entire write if the price + changePct are unchanged since the
// last write AND that write was within refreshInterval. This is the single
// biggest lever for keeping Upstash command count down — a flat ticker on
// a 30 s polling cadence costs ~14 400 cmds/day per ticker without dedup,
// near-zero with it.
func (c *Cache) Set(ctx context.Context, q Quote) error {
	if c.shouldSkip(q) {
		return nil
	}
	payload, err := json.Marshal(q)
	if err != nil {
		return err
	}
	if err := c.rdb.Set(ctx, quoteKey(q.Ticker), payload, c.ttl).Err(); err != nil {
		return err
	}
	// Ring-buffer: push, trim to HistoryLen. Using a pipeline keeps it to a
	// single round-trip.
	pipe := c.rdb.Pipeline()
	pipe.RPush(ctx, historyKey(q.Ticker), payload)
	pipe.LTrim(ctx, historyKey(q.Ticker), -int64(HistoryLen), -1)
	pipe.Expire(ctx, historyKey(q.Ticker), 24*time.Hour)
	_, _ = pipe.Exec(ctx)
	// pub/sub is best-effort; we don't want a subscriber failure to block
	// the hot ingest path.
	_ = c.rdb.Publish(ctx, PubSubChannel, payload).Err()
	c.lastWritten.Store(q.Ticker, lastWriteEntry{
		price:     q.Price,
		changePct: q.ChangePct,
		at:        time.Now(),
	})
	return nil
}

// shouldSkip returns true when the incoming quote is a no-op vs the last
// successful write, AND that write was recent enough that we don't risk
// the Redis TTL expiring before the next change.
func (c *Cache) shouldSkip(q Quote) bool {
	v, ok := c.lastWritten.Load(q.Ticker)
	if !ok {
		return false
	}
	prev := v.(lastWriteEntry)
	if time.Since(prev.at) >= refreshInterval {
		return false
	}
	return prev.price.Equal(q.Price) && prev.changePct.Equal(q.ChangePct)
}

// History returns the recent ticks for a ticker, oldest first. Returns an
// empty slice (not nil) if nothing has been recorded yet.
func (c *Cache) History(ctx context.Context, ticker string, limit int) ([]Quote, error) {
	if limit <= 0 || limit > HistoryLen {
		limit = HistoryLen
	}
	raw, err := c.rdb.LRange(ctx, historyKey(ticker), -int64(limit), -1).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Quote, 0, len(raw))
	for _, s := range raw {
		var q Quote
		if err := json.Unmarshal([]byte(s), &q); err == nil {
			out = append(out, q)
		}
	}
	return out, nil
}

func (c *Cache) Get(ctx context.Context, ticker string) (*Quote, error) {
	raw, err := c.rdb.Get(ctx, quoteKey(ticker)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	var q Quote
	if err := json.Unmarshal(raw, &q); err != nil {
		return nil, fmt.Errorf("decode quote: %w", err)
	}
	return &q, nil
}

// GetMany batches reads via MGET.
func (c *Cache) GetMany(ctx context.Context, tickers []string) (map[string]Quote, error) {
	if len(tickers) == 0 {
		return map[string]Quote{}, nil
	}
	keys := make([]string, len(tickers))
	for i, t := range tickers {
		keys[i] = quoteKey(t)
	}
	vals, err := c.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make(map[string]Quote, len(tickers))
	for i, v := range vals {
		if v == nil {
			continue
		}
		s, ok := v.(string)
		if !ok {
			continue
		}
		var q Quote
		if err := json.Unmarshal([]byte(s), &q); err == nil {
			out[tickers[i]] = q
		}
	}
	return out, nil
}

// AllKnown returns every quote currently in the cache. Used to seed new
// WebSocket clients with the latest tick we have for each ticker — without
// it, the dashboard shows "—" after a refresh whenever the next live tick
// is more than a few seconds away (e.g. outside market hours).
//
// Iterates with SCAN so it doesn't block Redis on large keyspaces, and
// skips the per-ticker ring-buffer keys (price:hist:*).
func (c *Cache) AllKnown(ctx context.Context) ([]Quote, error) {
	var cursor uint64
	keys := []string{}
	for {
		ks, next, err := c.rdb.Scan(ctx, cursor, "price:*", 200).Result()
		if err != nil {
			return nil, err
		}
		for _, k := range ks {
			if strings.HasPrefix(k, "price:hist:") {
				continue
			}
			keys = append(keys, k)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	if len(keys) == 0 {
		return nil, nil
	}
	vals, err := c.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Quote, 0, len(vals))
	for _, v := range vals {
		s, ok := v.(string)
		if !ok {
			continue
		}
		var q Quote
		if json.Unmarshal([]byte(s), &q) == nil {
			out = append(out, q)
		}
	}
	return out, nil
}

// Subscribe returns a channel of quote updates. The caller should read until
// the returned context is cancelled, then call Close on the subscription.
func (c *Cache) Subscribe(ctx context.Context) (<-chan Quote, func(), error) {
	ps := c.rdb.Subscribe(ctx, PubSubChannel)
	ch := make(chan Quote, 256)
	go func() {
		defer close(ch)
		for msg := range ps.Channel() {
			var q Quote
			if err := json.Unmarshal([]byte(msg.Payload), &q); err != nil {
				continue
			}
			select {
			case ch <- q:
			case <-ctx.Done():
				return
			}
		}
	}()
	return ch, func() { _ = ps.Close() }, nil
}
