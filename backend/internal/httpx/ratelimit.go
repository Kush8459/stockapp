package httpx

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimiter is a per-client-IP token bucket. Each IP gets its own bucket
// holding up to Burst tokens; one token is consumed per request and tokens
// refill at the rate of one per RefillEvery.
//
// Suitable for low-volume sensitive endpoints (auth) where in-process state
// is fine. For multi-replica deploys, swap to a Redis-backed implementation.
type RateLimiter struct {
	burst       int
	refillEvery time.Duration

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

// NewRateLimiter creates a limiter with a burst capacity and a refill cadence.
// Example: NewRateLimiter(5, time.Minute/5) → 5 burst, 5/min steady-state.
func NewRateLimiter(burst int, refillEvery time.Duration) *RateLimiter {
	return &RateLimiter{
		burst:       burst,
		refillEvery: refillEvery,
		buckets:     make(map[string]*bucket),
	}
}

func (rl *RateLimiter) allow(key string, now time.Time) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(rl.burst), lastSeen: now}
		rl.buckets[key] = b
	}
	elapsed := now.Sub(b.lastSeen)
	refill := float64(elapsed) / float64(rl.refillEvery)
	b.tokens = math.Min(float64(rl.burst), b.tokens+refill)
	b.lastSeen = now

	// Cheap idle-eviction: when the map gets large, drop entries last seen
	// over an hour ago. Keeps memory bounded without a background goroutine.
	if len(rl.buckets) > 1024 {
		for k, v := range rl.buckets {
			if now.Sub(v.lastSeen) > time.Hour {
				delete(rl.buckets, k)
			}
		}
	}

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Middleware enforces the limit per client IP. On exhaustion it responds 429
// with a Retry-After hint sized to one refill interval.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(ClientIP(r), time.Now()) {
			w.Header().Set("Retry-After", strconv.Itoa(int(rl.refillEvery.Seconds())))
			Error(w, r, NewError(http.StatusTooManyRequests, "rate_limited", "too many requests"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ClientIP returns the originating client IP, trusting the leftmost
// X-Forwarded-For entry when present (Caddy/Nginx put the real client there).
// Falls back to X-Real-Ip and finally RemoteAddr (with port stripped).
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first, _, _ := strings.Cut(xff, ",")
		return strings.TrimSpace(first)
	}
	if xri := r.Header.Get("X-Real-Ip"); xri != "" {
		return strings.TrimSpace(xri)
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
