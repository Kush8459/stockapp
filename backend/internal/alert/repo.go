package alert

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

var ErrNotFound = errors.New("alert not found")

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

func (r *Repo) Create(ctx context.Context, userID uuid.UUID, ticker string, target decimal.Decimal, dir Direction) (*Alert, error) {
	const q = `
		INSERT INTO price_alerts (user_id, ticker, target_price, direction)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, ticker, target_price, direction, triggered, triggered_at, created_at`
	a := &Alert{}
	if err := r.db.QueryRow(ctx, q, userID, ticker, target, dir).Scan(
		&a.ID, &a.UserID, &a.Ticker, &a.TargetPrice, &a.Direction,
		&a.Triggered, &a.TriggeredAt, &a.CreatedAt,
	); err != nil {
		return nil, err
	}
	return a, nil
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Alert, error) {
	const q = `
		SELECT id, user_id, ticker, target_price, direction, triggered, triggered_at, created_at
		FROM price_alerts WHERE user_id = $1
		ORDER BY triggered ASC, created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.UserID, &a.Ticker, &a.TargetPrice, &a.Direction,
			&a.Triggered, &a.TriggeredAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repo) Delete(ctx context.Context, userID, id uuid.UUID) error {
	cmd, err := r.db.Exec(ctx,
		`DELETE FROM price_alerts WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ActiveByTicker returns active alerts that might fire on a price of `ticker`.
// Used by the trigger engine on every price tick.
func (r *Repo) ActiveByTicker(ctx context.Context, ticker string) ([]Alert, error) {
	const q = `
		SELECT id, user_id, ticker, target_price, direction, triggered, triggered_at, created_at
		FROM price_alerts
		WHERE ticker = $1 AND NOT triggered`
	rows, err := r.db.Query(ctx, q, ticker)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.UserID, &a.Ticker, &a.TargetPrice, &a.Direction,
			&a.Triggered, &a.TriggeredAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// MarkTriggered atomically flips triggered=true so only one price tick wins
// when many cross the threshold simultaneously. Returns (firedNow, error)
// — firedNow is false when another goroutine already flipped it.
func (r *Repo) MarkTriggered(ctx context.Context, id uuid.UUID) (bool, error) {
	cmd, err := r.db.Exec(ctx, `
		UPDATE price_alerts
		SET triggered = TRUE, triggered_at = NOW()
		WHERE id = $1 AND NOT triggered`, id)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() == 1, nil
}

// exists to keep pgx imported cleanly for errors.Is users of this package.
var _ = pgx.ErrNoRows
