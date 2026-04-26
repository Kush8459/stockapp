package sip

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
	"github.com/stockapp/backend/internal/transaction"
)

// Scheduler polls for due SIP plans and executes them as buy transactions.
//
// Lock model: `ClaimDue` uses FOR UPDATE SKIP LOCKED inside a transaction, so
// if multiple schedulers somehow run in parallel (dev restart, k8s rolling
// update) each plan is executed by exactly one of them. The scheduler commits
// the next_run_at bump and the transaction write in the same DB transaction.
type Scheduler struct {
	repo   *Repo
	prices *price.Cache
	txn    *transaction.Service
	poll   time.Duration
}

func NewScheduler(repo *Repo, prices *price.Cache, txn *transaction.Service) *Scheduler {
	return &Scheduler{repo: repo, prices: prices, txn: txn, poll: time.Minute}
}

// Run blocks until ctx is cancelled. Ticks every minute and processes any
// due plans.
func (s *Scheduler) Run(ctx context.Context) error {
	log.Info().Dur("poll", s.poll).Msg("sip scheduler started")
	t := time.NewTicker(s.poll)
	defer t.Stop()

	// Do one pass immediately so a fresh restart doesn't wait a full minute
	// to catch up.
	s.runOnce(ctx, time.Now().UTC())

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case tick := <-t.C:
			s.runOnce(ctx, tick.UTC())
		}
	}
}

func (s *Scheduler) runOnce(ctx context.Context, now time.Time) {
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("sip tx begin failed")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	due, err := s.repo.ClaimDue(ctx, tx, now, 100)
	if err != nil {
		log.Warn().Err(err).Msg("sip claim due failed")
		return
	}
	if len(due) == 0 {
		return
	}

	// We commit the next_run_at bumps inside this tx, but each plan's
	// buy transaction runs in its own isolated DB transaction (owned by
	// transaction.Service). That means a failed buy doesn't block the
	// next_run_at advance — which is the right call, since otherwise a
	// stale quote or insufficient market data would lock the plan forever.
	for _, p := range due {
		next := Advance(p.NextRunAt, p.Frequency)
		if err := s.repo.SetNextRun(ctx, tx, p.ID, next); err != nil {
			log.Warn().Err(err).Str("plan", p.ID.String()).Msg("sip advance failed")
		}
	}
	if err := tx.Commit(ctx); err != nil {
		log.Warn().Err(err).Msg("sip tx commit failed")
		return
	}

	for _, p := range due {
		s.execute(ctx, p)
	}
}

// execute performs the buy transaction corresponding to one SIP run.
// Amount is split by the live quote to derive a fractional quantity.
func (s *Scheduler) execute(ctx context.Context, p Plan) {
	quote, err := s.prices.Get(ctx, p.Ticker)
	if err != nil || quote == nil || quote.Price.Sign() <= 0 {
		log.Warn().
			Str("ticker", p.Ticker).
			Str("plan", p.ID.String()).
			Msg("sip: skipping run, no live price")
		s.audit(ctx, p, "sip.skipped", map[string]any{"reason": "no_price"})
		return
	}
	qty := p.Amount.Div(quote.Price).Round(8)
	if qty.Sign() <= 0 {
		log.Warn().Str("plan", p.ID.String()).Msg("sip: skipping run, computed qty <= 0")
		return
	}
	note := fmt.Sprintf("SIP auto-execute (%s, ₹%s)", p.Frequency, p.Amount.String())
	planID := p.ID
	txn, err := s.txn.Execute(ctx, transaction.ExecuteInput{
		UserID:      p.UserID,
		PortfolioID: p.PortfolioID,
		Ticker:      p.Ticker,
		AssetType:   p.AssetType,
		Side:        transaction.SideBuy,
		Quantity:    qty,
		Price:       quote.Price,
		Fees:        decimal.Zero,
		Note:        &note,
		Source:      transaction.SourceSIP,
		SourceID:    &planID,
	})
	if err != nil {
		log.Warn().Err(err).Str("plan", p.ID.String()).Msg("sip execute failed")
		s.audit(ctx, p, "sip.failed", map[string]any{"error": err.Error()})
		return
	}
	log.Info().
		Str("plan", p.ID.String()).
		Str("ticker", p.Ticker).
		Str("txn", txn.ID.String()).
		Str("qty", qty.String()).
		Msg("sip executed")
	s.audit(ctx, p, "sip.executed", map[string]any{
		"transactionId": txn.ID,
		"quantity":      qty.String(),
		"price":         quote.Price.String(),
	})
}

func (s *Scheduler) audit(ctx context.Context, p Plan, action string, payload map[string]any) {
	payload["planId"] = p.ID
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if _, err := s.repo.db.Exec(ctx, `
		INSERT INTO audit_log (user_id, action, entity_type, entity_id, payload)
		VALUES ($1, $2, 'sip_plan', $3, $4)`, p.UserID, action, p.ID, b,
	); err != nil && !errors.Is(err, context.Canceled) {
		log.Warn().Err(err).Msg("sip audit failed")
	}
}
