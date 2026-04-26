package portfolio

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

var ErrNotFound = errors.New("portfolio not found")

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

func (r *Repo) Create(ctx context.Context, userID uuid.UUID, name, ccy string) (*Portfolio, error) {
	const q = `
		INSERT INTO portfolios (user_id, name, base_ccy)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, name, base_ccy, created_at, updated_at`
	p := &Portfolio{}
	if err := r.db.QueryRow(ctx, q, userID, name, ccy).Scan(
		&p.ID, &p.UserID, &p.Name, &p.BaseCCY, &p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return p, nil
}

func (r *Repo) ListByUser(ctx context.Context, userID uuid.UUID) ([]Portfolio, error) {
	const q = `
		SELECT id, user_id, name, base_ccy, created_at, updated_at
		FROM portfolios WHERE user_id = $1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Portfolio{}
	for rows.Next() {
		var p Portfolio
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &p.BaseCCY, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repo) ByID(ctx context.Context, id uuid.UUID) (*Portfolio, error) {
	const q = `
		SELECT id, user_id, name, base_ccy, created_at, updated_at
		FROM portfolios WHERE id = $1`
	p := &Portfolio{}
	err := r.db.QueryRow(ctx, q, id).Scan(&p.ID, &p.UserID, &p.Name, &p.BaseCCY, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repo) ListHoldings(ctx context.Context, portfolioID uuid.UUID) ([]Holding, error) {
	const q = `
		SELECT id, portfolio_id, ticker, asset_type, quantity, avg_buy_price, updated_at
		FROM holdings
		WHERE portfolio_id = $1 AND quantity > 0
		ORDER BY ticker`
	rows, err := r.db.Query(ctx, q, portfolioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Holding{}
	for rows.Next() {
		var h Holding
		var qty, avg decimal.Decimal
		if err := rows.Scan(&h.ID, &h.PortfolioID, &h.Ticker, &h.AssetType, &qty, &avg, &h.UpdatedAt); err != nil {
			return nil, err
		}
		h.Quantity = qty
		h.AvgBuyPrice = avg
		out = append(out, h)
	}
	return out, rows.Err()
}

// DistinctTickers returns every ticker currently held across all users.
// Used by the price worker to know what to subscribe to.
func (r *Repo) DistinctTickers(ctx context.Context) ([]string, error) {
	const q = `SELECT DISTINCT ticker FROM holdings WHERE quantity > 0 ORDER BY ticker`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
