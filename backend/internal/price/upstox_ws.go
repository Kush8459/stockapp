package price

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

const upstoxV3AuthorizeURL = "https://api.upstox.com/v3/feed/market-data-feed/authorize"

// authorizeResp shape from Upstox v3 /authorize.
type authorizeResp struct {
	Status string `json:"status"`
	Data   struct {
		AuthorizedRedirectURI string `json:"authorized_redirect_uri"`
	} `json:"data"`
	Errors []struct {
		ErrorCode string `json:"error_code"`
		Message   string `json:"message"`
	} `json:"errors"`
}

// authorizeWSURL exchanges the bearer token for a one-time signed wss:// URL.
// The token is embedded in the URL itself, so the upgrade request doesn't
// need an Authorization header (browsers couldn't send one anyway).
func authorizeWSURL(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstoxV3AuthorizeURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Api-Version", "2.0")

	client := newHTTPClient()
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return "", errors.New("upstox-ws: 401 — token expired? re-run cmd/upstox-login")
	}

	var parsed authorizeResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode authorize: %w", err)
	}
	if len(parsed.Errors) > 0 {
		e := parsed.Errors[0]
		return "", fmt.Errorf("upstox authorize: %s — %s", e.ErrorCode, e.Message)
	}
	if parsed.Data.AuthorizedRedirectURI == "" {
		return "", fmt.Errorf("upstox authorize: empty URI (status %s)", resp.Status)
	}
	return parsed.Data.AuthorizedRedirectURI, nil
}

// subscribeMessage is the JSON body Upstox expects to begin streaming.
type subscribeMessage struct {
	GUID   string             `json:"guid"`
	Method string             `json:"method"` // "sub" | "unsub" | "change_mode"
	Data   subscribeMessageIn `json:"data"`
}

type subscribeMessageIn struct {
	Mode           string   `json:"mode"`           // "ltpc" — last + close, smallest payload
	InstrumentKeys []string `json:"instrumentKeys"` // e.g. "NSE_EQ|INE002A01018"
}

// RunUpstoxWSFeed connects to the Upstox v3 WebSocket market-data feed and
// streams LTPC ticks for whatever set of tickers `tickersFn` returns at any
// given moment. Reconnects with exponential backoff on disconnect; refreshes
// its subscription set every 60 s by re-calling `tickersFn` and sending
// incremental sub/unsub messages — so a newly-bought stock starts streaming
// within a minute, no worker restart needed.
//
// Returns when ctx is cancelled.
func RunUpstoxWSFeed(
	ctx context.Context,
	cache *Cache,
	token string,
	tickersFn func() []string,
) error {
	if token == "" {
		return errors.New("upstox-ws: access token is empty")
	}
	log.Info().Msg("upstox-ws feed starting")

	// Snapshot only once per worker startup, but defer it to inside the
	// first connection — by then any background CSV/index loaders have
	// finished, so the snapshot covers the full wider universe (~500
	// instead of just whatever was hardcoded at process start).
	var snapshotOnce sync.Once

	backoff := time.Second
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := runOneUpstoxWS(ctx, cache, token, tickersFn, &snapshotOnce)
		if errors.Is(err, context.Canceled) {
			return err
		}
		if err == nil {
			return nil
		}
		log.Warn().Err(err).Dur("retry_in", backoff).Msg("upstox-ws disconnected, retrying")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
}

// resolveKeys turns a ticker list into (keys, keyToTicker), silently
// dropping any ticker without an Upstox instrument key.
func resolveKeys(tickers []string) ([]string, map[string]string) {
	keys := make([]string, 0, len(tickers))
	keyToTicker := make(map[string]string, len(tickers))
	for _, t := range tickers {
		k, ok := LookupUpstoxKey(t)
		if !ok {
			continue
		}
		keys = append(keys, k)
		keyToTicker[k] = t
	}
	return keys, keyToTicker
}

// wsConnState bundles the WS connection and the dynamic subscription set so
// the pinger, refresher, and read loop can coordinate safely. Concurrent
// writes to a gorilla/websocket connection aren't safe — they go through
// writeMu.
type wsConnState struct {
	conn    *websocket.Conn
	cache   *Cache
	token   string // needed by refresh() to snapshot newly-subscribed tickers
	writeMu sync.Mutex

	mu          sync.RWMutex
	keyToTicker map[string]string
	subscribed  map[string]bool
}

func (s *wsConnState) sendPing() error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteControl(
		websocket.PingMessage, nil, time.Now().Add(5*time.Second),
	)
}

func (s *wsConnState) sendSubMessage(method string, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(subscribeMessage{
		GUID:   uuid.NewString(),
		Method: method,
		Data:   subscribeMessageIn{Mode: "ltpc", InstrumentKeys: keys},
	})
}

// refresh diffs the current subscription set against `wantTickers` and
// sends sub/unsub messages to align them. New tickers also get a snapshot
// in the background so the UI has a price immediately — stocks via Upstox
// REST batched (fast, accurate prev-close) and indices via Yahoo.
func (s *wsConnState) refresh(ctx context.Context, wantTickers []string) error {
	keys, keyToTicker := resolveKeys(wantTickers)
	wantSet := make(map[string]bool, len(keys))
	for _, k := range keys {
		wantSet[k] = true
	}

	s.mu.Lock()
	var toSub, toUnsub []string
	for k := range wantSet {
		if !s.subscribed[k] {
			toSub = append(toSub, k)
		}
	}
	for k := range s.subscribed {
		if !wantSet[k] {
			toUnsub = append(toUnsub, k)
		}
	}
	s.keyToTicker = keyToTicker
	s.subscribed = wantSet
	s.mu.Unlock()

	if len(toSub) == 0 && len(toUnsub) == 0 {
		return nil
	}

	if err := s.sendSubMessage("sub", toSub); err != nil {
		return fmt.Errorf("sub: %w", err)
	}
	if err := s.sendSubMessage("unsub", toUnsub); err != nil {
		return fmt.Errorf("unsub: %w", err)
	}

	log.Info().
		Int("added", len(toSub)).
		Int("removed", len(toUnsub)).
		Int("active", len(wantSet)).
		Msg("upstox-ws subscription refreshed")

	// Snapshot only the newly-subscribed keys, dispatched the same way as
	// initial snapshot: Upstox REST batched for stocks, Yahoo for indices.
	// Calling Yahoo for hundreds of stocks would 404 most of them and
	// rate-limit the rest.
	if len(toSub) > 0 {
		newSubmap := make(map[string]string, len(toSub))
		for _, k := range toSub {
			if t, ok := keyToTicker[k]; ok {
				newSubmap[k] = t
			}
		}
		go snapshotUpstoxAndYahoo(ctx, s.cache, s.token, toSub, newSubmap)
	}
	return nil
}

func runOneUpstoxWS(
	ctx context.Context,
	cache *Cache,
	token string,
	tickersFn func() []string,
	snapshotOnce *sync.Once,
) error {
	wsURL, err := authorizeWSURL(ctx, token)
	if err != nil {
		return fmt.Errorf("authorize: %w", err)
	}

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 15 * time.Second

	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	log.Info().Msg("upstox-ws connected")

	state := &wsConnState{conn: conn, cache: cache, token: token}

	// Initial subscribe with the current ticker set.
	keys, keyToTicker := resolveKeys(tickersFn())
	if len(keys) == 0 {
		return errors.New("no tickers resolve to instrument keys")
	}

	// One-time snapshot for the *current* wider ticker set, in parallel
	// with the rest of WS startup so users see data ASAP. Gated by
	// snapshotOnce so subsequent reconnects don't re-snapshot.
	snapshotOnce.Do(func() {
		log.Info().Int("tickers", len(keys)).Msg("upstox-ws: kicking off initial snapshot")
		go snapshotUpstoxAndYahoo(ctx, cache, token, keys, keyToTicker)
	})
	state.mu.Lock()
	state.keyToTicker = keyToTicker
	state.subscribed = make(map[string]bool, len(keys))
	for _, k := range keys {
		state.subscribed[k] = true
	}
	state.mu.Unlock()

	if err := state.sendSubMessage("sub", keys); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	log.Info().Int("instruments", len(keys)).Msg("upstox-ws subscribed (mode=ltpc)")

	// Read deadline — Upstox closes idle connections at ~30 s.
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Initial ping immediately so the server sees client traffic before its
	// 24 s idle timeout kicks in.
	_ = state.sendPing()

	stopAux := make(chan struct{})
	var wg sync.WaitGroup

	// Pinger every 10 s.
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stopAux:
				return
			case <-t.C:
				_ = state.sendPing()
			}
		}
	}()

	// Refresher every 60 s — picks up any new tickers from holdings/SIPs/
	// watchlist and adds them to the subscription on the fly.
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stopAux:
				return
			case <-t.C:
				if err := state.refresh(ctx, tickersFn()); err != nil {
					log.Warn().Err(err).Msg("upstox-ws refresh failed")
				}
			}
		}
	}()

	defer func() {
		close(stopAux)
		wg.Wait()
	}()

	loggedFirst := false

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
		if msgType != websocket.BinaryMessage {
			continue
		}
		if !loggedFirst {
			head := data
			if len(head) > 16 {
				head = head[:16]
			}
			log.Debug().Int("bytes", len(data)).Hex("head", head).Msg("upstox-ws first frame")
			loggedFirst = true
		}
		now := time.Now().UTC()
		_ = decodeFeedResponse(data, func(instrumentKey string, ltp, cp float64) {
			state.mu.RLock()
			ticker, ok := state.keyToTicker[instrumentKey]
			state.mu.RUnlock()
			if !ok || ltp <= 0 {
				return
			}
			price := decimal.NewFromFloat(ltp)
			prev := decimal.NewFromFloat(cp)
			if prev.Sign() <= 0 {
				prev = price
			}
			changePct := decimal.Zero
			if prev.Sign() > 0 {
				changePct = price.Sub(prev).Div(prev).Mul(decimal.NewFromInt(100))
			}
			if err := cache.Set(ctx, Quote{
				Ticker:    ticker,
				Price:     price.Round(2),
				PrevClose: prev.Round(2),
				ChangePct: changePct.Round(4),
				UpdatedAt: now,
			}); err != nil {
				log.Warn().Err(err).Str("ticker", ticker).Msg("upstox-ws cache set")
			}
		})
	}
}

// snapshotUpstoxAndYahoo fills the cache with last-close + day-change for
// every subscribed ticker. Two-pass strategy:
//
//  1. Upstox v2 REST batched — ~100 keys per call. Fast (5 calls for 500
//     stocks) and accurate when net_change is populated. Works for stocks
//     and most indices.
//  2. Yahoo chart endpoint — fallback for tickers Upstox returned empty
//     for. Common case: a few sectoral indices Yahoo handles better.
func snapshotUpstoxAndYahoo(
	ctx context.Context,
	cache *Cache,
	token string,
	keys []string,
	keyToTicker map[string]string,
) {
	if len(keys) == 0 {
		return
	}

	// Pass 1: try Upstox for everything.
	snapshotViaUpstoxBatched(ctx, cache, token, keys, keyToTicker)

	// Pass 2: anything Upstox didn't fill, hit Yahoo. We check the cache
	// rather than tracking Upstox's response, since some Upstox responses
	// silently omit instruments with no recent data.
	missing := make([]string, 0, 8)
	for _, k := range keys {
		ticker, ok := keyToTicker[k]
		if !ok {
			continue
		}
		q, _ := cache.Get(ctx, ticker)
		if q == nil || q.Price.Sign() <= 0 {
			missing = append(missing, ticker)
		}
	}
	if len(missing) > 0 {
		log.Info().Int("tickers", len(missing)).Msg("upstox-ws: yahoo gap-fill snapshot")
		yahooSnapshotForTickers(ctx, cache, missing)
	}
}

// snapshotViaUpstoxBatched calls Upstox's v2 quotes endpoint in chunks of
// ~100 keys at a time. v2 quotes URL has a length limit; chunking keeps
// us safely under it for any practical universe size.
func snapshotViaUpstoxBatched(
	ctx context.Context,
	cache *Cache,
	token string,
	stockKeys []string,
	keyToTicker map[string]string,
) {
	const chunkSize = 100
	client := newHTTPClient()
	calls, failed := 0, 0
	for i := 0; i < len(stockKeys); i += chunkSize {
		end := i + chunkSize
		if end > len(stockKeys) {
			end = len(stockKeys)
		}
		chunk := stockKeys[i:end]
		// Build a chunk-scoped key→ticker map so matchUpstoxTicker has
		// only the relevant entries to compare against.
		chunkMap := make(map[string]string, len(chunk))
		for _, k := range chunk {
			if t, ok := keyToTicker[k]; ok {
				chunkMap[k] = t
			}
		}
		calls++
		if err := upstoxFetch(ctx, client, cache, token, chunk, chunkMap); err != nil {
			failed++
			log.Warn().Err(err).Int("chunk_start", i).Msg("upstox snapshot chunk failed")
		}
		// Light stagger between chunks so we're a polite client.
		if end < len(stockKeys) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
		}
	}
	log.Info().
		Int("stocks", len(stockKeys)).
		Int("calls", calls).
		Int("failed", failed).
		Msg("upstox: batched REST snapshot complete")
}

// yahooSnapshotForTickers calls Yahoo's chart endpoint sequentially with a
// 200 ms stagger. Used both at worker startup and on dynamic-add to give
// new tickers an immediate price without waiting for the next WS tick.
func yahooSnapshotForTickers(ctx context.Context, cache *Cache, tickers []string) {
	if len(tickers) == 0 {
		return
	}
	client := newHTTPClient()
	failed := 0
	for i, t := range tickers {
		if i > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(200 * time.Millisecond):
			}
		}
		if err := fetchOne(ctx, client, cache, t); err != nil {
			failed++
			log.Warn().Err(err).Str("ticker", t).Msg("yahoo snapshot")
		}
	}
	log.Info().Int("tickers", len(tickers)).Int("failed", failed).Msg("yahoo snapshot complete")
}

// ──────────────────────────────────────────────────────────────────────────
// Hand-rolled protobuf wire decoder for FeedResponse → feeds[<key>] → LTPC.
//
// Schema (Upstox v3 MarketDataFeed):
//   FeedResponse { Type type=1; map<string,Feed> feeds=2; int64 ts=3 }
//   Feed         { LTPC ltpc=1; ... ; RequestMode requestMode=4 }
//   LTPC         { double ltp=1; int64 ltt=2; int64 ltq=3; double cp=4 }
//
// We only care about Feed.ltpc.{ltp,cp} when subscribed in "ltpc" mode.
// Other fields are skipped via skipField. Any decode error on a single
// frame is non-fatal: log + drop, keep reading.
// ──────────────────────────────────────────────────────────────────────────

const (
	wireVarint  = 0
	wireFixed64 = 1
	wireBytes   = 2
	wireFixed32 = 5
)

func decodeFeedResponse(b []byte, onTick func(key string, ltp, cp float64)) error {
	for len(b) > 0 {
		num, wt, n := readTag(b)
		if n < 0 {
			return errors.New("bad tag")
		}
		b = b[n:]
		if num == 2 && wt == wireBytes {
			entry, m := readBytes(b)
			if m < 0 {
				return errors.New("bad map entry")
			}
			b = b[m:]
			decodeFeedsMapEntry(entry, onTick)
			continue
		}
		m := skipField(b, wt)
		if m < 0 {
			return errors.New("skip failed")
		}
		b = b[m:]
	}
	return nil
}

func decodeFeedsMapEntry(b []byte, onTick func(key string, ltp, cp float64)) {
	var key string
	var feedBytes []byte
	for len(b) > 0 {
		num, wt, n := readTag(b)
		if n < 0 {
			return
		}
		b = b[n:]
		switch {
		case num == 1 && wt == wireBytes:
			v, m := readBytes(b)
			if m < 0 {
				return
			}
			b = b[m:]
			key = string(v)
		case num == 2 && wt == wireBytes:
			v, m := readBytes(b)
			if m < 0 {
				return
			}
			b = b[m:]
			feedBytes = v
		default:
			m := skipField(b, wt)
			if m < 0 {
				return
			}
			b = b[m:]
		}
	}
	if key == "" || len(feedBytes) == 0 {
		return
	}
	ltp, cp, ok := decodeFeedLTPC(feedBytes)
	if !ok {
		return
	}
	onTick(key, ltp, cp)
}

func decodeFeedLTPC(b []byte) (ltp, cp float64, ok bool) {
	for len(b) > 0 {
		num, wt, n := readTag(b)
		if n < 0 {
			return
		}
		b = b[n:]
		if num == 1 && wt == wireBytes {
			v, m := readBytes(b)
			if m < 0 {
				return
			}
			b = b[m:]
			ltp, cp = decodeLTPC(v)
			ok = true
			continue
		}
		m := skipField(b, wt)
		if m < 0 {
			return
		}
		b = b[m:]
	}
	return
}

func decodeLTPC(b []byte) (ltp, cp float64) {
	for len(b) > 0 {
		num, wt, n := readTag(b)
		if n < 0 {
			return
		}
		b = b[n:]
		switch {
		case num == 1 && wt == wireFixed64:
			bits, m := readFixed64(b)
			if m < 0 {
				return
			}
			b = b[m:]
			ltp = math.Float64frombits(bits)
		case num == 4 && wt == wireFixed64:
			bits, m := readFixed64(b)
			if m < 0 {
				return
			}
			b = b[m:]
			cp = math.Float64frombits(bits)
		default:
			m := skipField(b, wt)
			if m < 0 {
				return
			}
			b = b[m:]
		}
	}
	return
}

// ── primitive wire readers ─────────────────────────────────────────────────

func readVarint(b []byte) (uint64, int) {
	var v uint64
	var n int
	for shift := uint(0); shift < 64; shift += 7 {
		if n >= len(b) {
			return 0, -1
		}
		c := b[n]
		n++
		v |= uint64(c&0x7f) << shift
		if c&0x80 == 0 {
			return v, n
		}
	}
	return 0, -1
}

func readBytes(b []byte) ([]byte, int) {
	length, n := readVarint(b)
	if n < 0 {
		return nil, -1
	}
	end := n + int(length)
	if end > len(b) {
		return nil, -1
	}
	return b[n:end], end
}

func readFixed64(b []byte) (uint64, int) {
	if len(b) < 8 {
		return 0, -1
	}
	return binary.LittleEndian.Uint64(b), 8
}

func readTag(b []byte) (num, wt, n int) {
	v, n := readVarint(b)
	if n < 0 {
		return 0, 0, -1
	}
	return int(v >> 3), int(v & 0x7), n
}

func skipField(b []byte, wt int) int {
	switch wt {
	case wireVarint:
		_, n := readVarint(b)
		return n
	case wireFixed64:
		if len(b) < 8 {
			return -1
		}
		return 8
	case wireBytes:
		v, n := readVarint(b)
		if n < 0 {
			return -1
		}
		end := n + int(v)
		if end > len(b) {
			return -1
		}
		return end
	case wireFixed32:
		if len(b) < 4 {
			return -1
		}
		return 4
	default:
		return -1
	}
}
