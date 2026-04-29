package goal

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

var ErrNotFound = errors.New("goal not found")

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

type CreateInput struct {
	UserID       uuid.UUID
	PortfolioID  uuid.UUID
	Name         string
	TargetAmount decimal.Decimal
	TargetDate   time.Time
	Bucket       string
	Note         string
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Goal, error) {
	const q = `
		INSERT INTO goals (user_id, portfolio_id, name, target_amount, target_date, bucket, note)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''))
		RETURNING id, user_id, portfolio_id, name, target_amount, target_date, bucket, note, created_at, updated_at`
	g := &Goal{}
	err := r.db.QueryRow(ctx, q,
		in.UserID, in.PortfolioID, in.Name, in.TargetAmount, in.TargetDate, in.Bucket, in.Note,
	).Scan(
		&g.ID, &g.UserID, &g.PortfolioID, &g.Name, &g.TargetAmount, &g.TargetDate,
		&g.Bucket, &g.Note, &g.CreatedAt, &g.UpdatedAt,
	)
	return g, err
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Goal, error) {
	const q = `
		SELECT id, user_id, portfolio_id, name, target_amount, target_date,
		       bucket, note, created_at, updated_at
		FROM goals
		WHERE user_id = $1
		ORDER BY target_date ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Goal{}
	for rows.Next() {
		var g Goal
		if err := rows.Scan(
			&g.ID, &g.UserID, &g.PortfolioID, &g.Name, &g.TargetAmount, &g.TargetDate,
			&g.Bucket, &g.Note, &g.CreatedAt, &g.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

type UpdateInput struct {
	Name         *string
	TargetAmount *decimal.Decimal
	TargetDate   *time.Time
	Bucket       *string
	Note         *string
}

func (r *Repo) Update(ctx context.Context, userID, id uuid.UUID, in UpdateInput) (*Goal, error) {
	// COALESCE keeps the SQL single-statement; nil pointers leave fields alone.
	const q = `
		UPDATE goals
		SET name          = COALESCE($1, name),
		    target_amount = COALESCE($2, target_amount),
		    target_date   = COALESCE($3, target_date),
		    bucket        = COALESCE($4, bucket),
		    note          = COALESCE($5, note),
		    updated_at    = NOW()
		WHERE id = $6 AND user_id = $7
		RETURNING id, user_id, portfolio_id, name, target_amount, target_date,
		          bucket, note, created_at, updated_at`
	g := &Goal{}
	err := r.db.QueryRow(ctx, q,
		in.Name, in.TargetAmount, in.TargetDate, in.Bucket, in.Note, id, userID,
	).Scan(
		&g.ID, &g.UserID, &g.PortfolioID, &g.Name, &g.TargetAmount, &g.TargetDate,
		&g.Bucket, &g.Note, &g.CreatedAt, &g.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return g, err
}

func (r *Repo) Delete(ctx context.Context, userID, id uuid.UUID) error {
	cmd, err := r.db.Exec(ctx, `DELETE FROM goals WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
