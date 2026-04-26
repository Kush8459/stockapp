package price

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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
type Cache struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewCache(rdb *redis.Client) *Cache {
	// Long TTL so off-hours snapshots stick across WS reconnects + the
	// trading-day gap. During market hours the WS overwrites with each tick.
	return &Cache{rdb: rdb, ttl: 24 * time.Hour}
}

func quoteKey(ticker string) string   { return "price:" + ticker }
func historyKey(ticker string) string { return "price:hist:" + ticker }

const (
	PubSubChannel = "prices:stream"
	// HistoryLen is the ring-buffer size per ticker. At a 2s worker cadence
	// this is ~8 minutes of recent ticks — enough for a live sparkline.
	HistoryLen = 240
)

// Set writes the latest quote, appends it to the per-ticker ring buffer, and
// publishes it for any WebSocket subscribers.
func (c *Cache) Set(ctx context.Context, q Quote) error {
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
	return nil
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
