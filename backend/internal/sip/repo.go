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
		RETURNING id, user_id, portfolio_id, ticker, asset_type, amount, frequency, next_run_at, status, created_at, updated_at`
	p := &Plan{}
	err := r.db.QueryRow(ctx, q,
		in.UserID, in.PortfolioID, in.Ticker, in.AssetType, in.Amount, in.Frequency, in.FirstRunAt,
	).Scan(
		&p.ID, &p.UserID, &p.PortfolioID, &p.Ticker, &p.AssetType, &p.Amount,
		&p.Frequency, &p.NextRunAt, &p.Status, &p.CreatedAt, &p.UpdatedAt,
	)
	return p, err
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Plan, error) {
	const q = `
		SELECT id, user_id, portfolio_id, ticker, asset_type, amount, frequency,
		       next_run_at, status, created_at, updated_at
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
			&p.Amount, &p.Frequency, &p.NextRunAt, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) SetStatus(ctx context.Context, userID, id uuid.UUID, status Status) error {
	cmd, err := r.db.Exec(ctx,
		`UPDATE sip_plans SET status = $1 WHERE id = $2 AND user_id = $3`,
		status, id, userID)
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
		       next_run_at, status, created_at, updated_at
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
			&p.Amount, &p.Frequency, &p.NextRunAt, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
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

// BeginTx exposes the pool to the scheduler so it can share a pool with the
// rest of the app while still owning its own transaction lifecycle.
func (r *Repo) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.db.Begin(ctx)
}
