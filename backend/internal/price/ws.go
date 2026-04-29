package price

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/metrics"
)

// Hub multiplexes the in-process price stream to every connected browser
// client.
//
// Simplifying choices for Phase 1:
//   - One fan-out to *every* client (no per-user price subscription). Tickers
//     are small and symmetric across the demo, so per-user filtering isn't
//     worth the complexity yet.
//   - Clients authenticate over HTTP first (JWT in query string since the
//     browser WebSocket API can't send auth headers).
type Hub struct {
	cache *Cache

	mu         sync.RWMutex
	clients    map[*client]struct{}
	byUser     map[uuid.UUID]map[*client]struct{} // user-scoped event fan-out
}

type client struct {
	conn   *websocket.Conn
	send   chan []byte
	userID uuid.UUID
}

func NewHub(cache *Cache) *Hub {
	return &Hub{
		cache:   cache,
		clients: make(map[*client]struct{}),
		byUser:  make(map[uuid.UUID]map[*client]struct{}),
	}
}

// SendToUser pushes a raw pre-encoded event to every connection belonging to
// the given user. No-op if the user has no live sockets. Implements
// alert.EventSender.
func (h *Hub) SendToUser(userID uuid.UUID, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.byUser[userID] {
		select {
		case c.send <- payload:
		default:
			// slow client: drop; they'll reconcile on next page load.
		}
	}
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(_ *http.Request) bool {
		// CORS for WebSockets: we rely on the JWT in the URL to authenticate
		// so we don't need Origin to match. Tighten in prod.
		return true
	},
}

// Run starts consuming the Redis price stream and fanning it out to clients.
// Blocks until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) error {
	updates, close, err := h.cache.Subscribe(ctx)
	if err != nil {
		return err
	}
	defer close()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case q, ok := <-updates:
			if !ok {
				return nil
			}
			payload := encodeEvent("price", q)
			h.mu.RLock()
			sent := 0
			for c := range h.clients {
				select {
				case c.send <- payload:
					sent++
				default:
					// slow client: drop. They'll see the next tick.
				}
			}
			h.mu.RUnlock()
			if sent > 0 {
				metrics.WsMessagesSentTotal.Add(float64(sent))
			}
		}
	}
}

// Handler returns the http.HandlerFunc that upgrades connections.
func (h *Hub) Handler(signer *auth.Signer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			httpx.Error(w, r, httpx.ErrUnauthorized)
			return
		}
		claims, err := signer.Parse(tokenStr, auth.AccessToken)
		if err != nil {
			httpx.Error(w, r, httpx.ErrUnauthorized)
			return
		}
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Warn().Err(err).Msg("ws upgrade")
			return
		}
		c := &client{conn: conn, send: make(chan []byte, 256), userID: claims.UserID}
		h.add(c)
		go h.writePump(c)
		go h.readPump(c)
		// Replay every cached price so the client doesn't paint "—" while
		// waiting for the next live tick. Run as a separate goroutine so
		// the send loop can block on the writePump's drain — without that,
		// snapshots >256 quotes silently dropped the tail. Detached from
		// r.Context since the HTTP request returns once Upgrade succeeds.
		go func() {
			snapshotCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			quotes, err := h.cache.AllKnown(snapshotCtx)
			if err != nil {
				return
			}
			for _, q := range quotes {
				select {
				case c.send <- encodeEvent("price", q):
				case <-time.After(2 * time.Second):
					// Pump stuck — bail rather than block forever.
					return
				}
			}
		}()
	}
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	if h.byUser[c.userID] == nil {
		h.byUser[c.userID] = make(map[*client]struct{})
	}
	h.byUser[c.userID][c] = struct{}{}
	count := float64(len(h.clients))
	h.mu.Unlock()
	metrics.WsConnectionsActive.Set(count)
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		if set := h.byUser[c.userID]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.byUser, c.userID)
			}
		}
		close(c.send)
	}
	count := float64(len(h.clients))
	h.mu.Unlock()
	metrics.WsConnectionsActive.Set(count)
	_ = c.conn.Close()
}

func (h *Hub) writePump(c *client) {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		h.remove(c)
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) readPump(c *client) {
	defer h.remove(c)
	c.conn.SetReadLimit(1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		return nil
	})
	for {
		if _, _, err := c.conn.NextReader(); err != nil {
			return
		}
	}
}
