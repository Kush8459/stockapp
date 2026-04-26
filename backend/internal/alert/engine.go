package alert

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// EventSender is the narrow dependency the engine needs to push a triggered
// alert to a specific user's sockets. In the monolith the WS hub implements
// it directly; in a split deployment you'd swap in a Kafka producer.
type EventSender interface {
	SendToUser(userID uuid.UUID, payload []byte)
}

// Engine consumes the Redis price stream, checks each tick against all
// outstanding alerts for that ticker, and fires the ones whose threshold was
// crossed.
type Engine struct {
	repo  *Repo
	cache *price.Cache
	db    *pgxpool.Pool
	send  EventSender
}

func NewEngine(db *pgxpool.Pool, cache *price.Cache, sender EventSender) *Engine {
	return &Engine{repo: NewRepo(db), cache: cache, db: db, send: sender}
}

// Run blocks until ctx is cancelled. Subscribes to every price tick; for each
// tick, pulls the (usually empty) set of active alerts for that ticker and
// checks whether each one's threshold has been crossed.
//
// Trade-offs:
//   - Reading alerts from Postgres on every tick keeps the engine stateless
//     and always-correct when alerts are created/deleted. The query hits an
//     index and the tick rate is modest.
//   - A faster alternative is a Redis set of active tickers + an in-memory
//     cache of alerts refreshed on change. Worth the complexity only after
//     the alert table has >~10k active rows.
func (e *Engine) Run(ctx context.Context) error {
	updates, closeFn, err := e.cache.Subscribe(ctx)
	if err != nil {
		return err
	}
	defer closeFn()

	log.Info().Msg("alert engine started")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case q, ok := <-updates:
			if !ok {
				return nil
			}
			e.checkTick(ctx, q)
		}
	}
}

func (e *Engine) checkTick(ctx context.Context, q price.Quote) {
	alerts, err := e.repo.ActiveByTicker(ctx, q.Ticker)
	if err != nil {
		log.Warn().Err(err).Str("ticker", q.Ticker).Msg("alert lookup failed")
		return
	}
	if len(alerts) == 0 {
		return
	}
	for _, a := range alerts {
		if !crossed(q.Price, a.TargetPrice, a.Direction) {
			continue
		}
		firedNow, err := e.repo.MarkTriggered(ctx, a.ID)
		if err != nil {
			log.Warn().Err(err).Str("alert", a.ID.String()).Msg("mark triggered failed")
			continue
		}
		if !firedNow {
			// Another tick won the race; don't notify twice.
			continue
		}
		e.fire(ctx, a, q.Price)
	}
}

func crossed(price, target decimal.Decimal, dir Direction) bool {
	switch dir {
	case DirAbove:
		return price.Cmp(target) >= 0
	case DirBelow:
		return price.Cmp(target) <= 0
	}
	return false
}

func (e *Engine) fire(ctx context.Context, a Alert, livePrice decimal.Decimal) {
	now := time.Now().UTC()
	ev := TriggeredEvent{
		AlertID:     a.ID,
		UserID:      a.UserID,
		Ticker:      a.Ticker,
		Direction:   a.Direction,
		TargetPrice: a.TargetPrice,
		Price:       livePrice,
		TriggeredAt: now,
	}

	payload, err := json.Marshal(map[string]any{
		"type": "alert.triggered",
		"data": ev,
	})
	if err != nil {
		return
	}
	e.send.SendToUser(a.UserID, payload)

	// Audit.
	auditPayload, _ := json.Marshal(ev)
	if _, err := e.db.Exec(ctx, `
		INSERT INTO audit_log (user_id, action, entity_type, entity_id, payload)
		VALUES ($1, 'alert.triggered', 'alert', $2, $3)`,
		a.UserID, a.ID, auditPayload,
	); err != nil {
		log.Warn().Err(err).Msg("audit alert.triggered failed")
	}

	log.Info().
		Str("alert", a.ID.String()).
		Str("ticker", a.Ticker).
		Str("user", a.UserID.String()).
		Msg("alert fired")
}
