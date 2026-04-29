package sip

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

var ErrNotFound = errors.New("sip plan not found")

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

type CreateInput struct {
	UserID      uuid.UUID
	PortfolioID uuid.UUID
	Ticker      string
	AssetType   string
	Amount      decimal.Decimal
	Frequency   Frequency
	FirstRunAt  time.Time
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Plan, error) {
	const q = `
		INSERT INTO sip_plans (user_id, portfolio_id, ticker, asset_type, amount, frequency, next_run_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
		RETURNING id, user_id, portfolio_id, ticker, asset_type, amount, frequency, next_run_at, status, pause_reason, created_at, updated_at`
	p := &Plan{}
	err := r.db.QueryRow(ctx, q,
		in.UserID, in.PortfolioID, in.Ticker, in.AssetType, in.Amount, in.Frequency, in.FirstRunAt,
	).Scan(
		&p.ID, &p.UserID, &p.PortfolioID, &p.Ticker, &p.AssetType, &p.Amount,
		&p.Frequency, &p.NextRunAt, &p.Status, &p.PauseReason, &p.CreatedAt, &p.UpdatedAt,
	)
	return p, err
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Plan, error) {
	const q = `
		SELECT id, user_id, portfolio_id, ticker, asset_type, amount, frequency,
		       next_run_at, status, pause_reason, created_at, updated_at
		FROM sip_plans WHERE user_id = $1
		ORDER BY (status = 'active') DESC, next_run_at ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.UserID, &p.PortfolioID, &p.Ticker, &p.AssetType,
			&p.Amount, &p.Frequency, &p.NextRunAt, &p.Status, &p.PauseReason, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) SetStatus(ctx context.Context, userID, id uuid.UUID, status Status) error {
	// Resuming clears any auto-pause reason — the user has acknowledged
	// whatever caused the pause and we shouldn't keep displaying the badge.
	cmd, err := r.db.Exec(ctx, `
		UPDATE sip_plans
		SET status = $1,
		    pause_reason = CASE WHEN $1 = 'active' THEN NULL ELSE pause_reason END,
		    updated_at = NOW()
		WHERE id = $2 AND user_id = $3`,
		status, id, userID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateInput carries all the fields a user can edit on an existing SIP.
// Any nil pointer means "leave unchanged" — letting one PATCH touch any
// subset of fields without forcing the client to send the others.
type UpdateInput struct {
	Amount    *decimal.Decimal
	Frequency *Frequency
	NextRunAt *time.Time
}

// Update applies a partial edit to a SIP plan. Returns ErrNotFound if
// the plan doesn't exist or doesn't belong to the user. Uses COALESCE
// so the SQL stays single-statement regardless of which fields are set.
func (r *Repo) Update(ctx context.Context, userID, id uuid.UUID, in UpdateInput) error {
	const q = `
		UPDATE sip_plans
		SET amount      = COALESCE($1, amount),
		    frequency   = COALESCE($2, frequency),
		    next_run_at = COALESCE($3, next_run_at),
		    updated_at  = NOW()
		WHERE id = $4 AND user_id = $5`
	var amount any
	if in.Amount != nil {
		amount = *in.Amount
	}
	var freq any
	if in.Frequency != nil {
		freq = string(*in.Frequency)
	}
	var nextRun any
	if in.NextRunAt != nil {
		nextRun = *in.NextRunAt
	}
	cmd, err := r.db.Exec(ctx, q, amount, freq, nextRun, id, userID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ClaimDue returns up to `limit` SIPs that are due to run now. It uses
// SELECT ... FOR UPDATE SKIP LOCKED so multiple scheduler instances (or
// restarts mid-run) never double-execute the same plan.
func (r *Repo) ClaimDue(ctx context.Context, tx pgx.Tx, now time.Time, limit int) ([]Plan, error) {
	const q = `
		SELECT id, user_id, portfolio_id, ticker, asset_type, amount, frequency,
		       next_run_at, status, pause_reason, created_at, updated_at
		FROM sip_plans
		WHERE status = 'active' AND next_run_at <= $1
		ORDER BY next_run_at
		FOR UPDATE SKIP LOCKED
		LIMIT $2`
	rows, err := tx.Query(ctx, q, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.UserID, &p.PortfolioID, &p.Ticker, &p.AssetType,
			&p.Amount, &p.Frequency, &p.NextRunAt, &p.Status, &p.PauseReason, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) SetNextRun(ctx context.Context, tx pgx.Tx, id uuid.UUID, next time.Time) error {
	_, err := tx.Exec(ctx, `UPDATE sip_plans SET next_run_at = $1 WHERE id = $2`, next, id)
	return err
}

// PauseFromScheduler is the scheduler-side variant of SetStatus: no user
// guard (the system owns the action) and only ever flips active → paused.
// Used when a SIP run fails for a recoverable reason like an empty wallet,
// so the plan stops retrying every cycle until the user intervenes.
func (r *Repo) PauseFromScheduler(ctx context.Context, id uuid.UUID, reason string) error {
	cmd, err := r.db.Exec(ctx,
		`UPDATE sip_plans
		 SET status = 'paused', pause_reason = $2, updated_at = NOW()
		 WHERE id = $1 AND status = 'active'`, id, reason)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// BeginTx exposes the pool to the scheduler so it can share a pool with the
// rest of the app while still owning its own transaction lifecycle.
func (r *Repo) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.db.Begin(ctx)
}
