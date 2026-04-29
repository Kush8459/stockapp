package portfolio

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

var (
	ErrNotFound      = errors.New("portfolio not found")
	ErrNameTaken     = errors.New("portfolio name already in use")
	ErrPortfolioBusy = errors.New("portfolio still has holdings or transactions")
)

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

// Rename updates a portfolio's display name. The (user_id, name) UNIQUE
// constraint on the table maps a duplicate-name violation to ErrNameTaken.
func (r *Repo) Rename(ctx context.Context, userID, id uuid.UUID, name string) (*Portfolio, error) {
	const q = `
		UPDATE portfolios SET name = $1
		WHERE id = $2 AND user_id = $3
		RETURNING id, user_id, name, base_ccy, created_at, updated_at`
	p := &Portfolio{}
	err := r.db.QueryRow(ctx, q, name, id, userID).Scan(
		&p.ID, &p.UserID, &p.Name, &p.BaseCCY, &p.CreatedAt, &p.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		// Postgres unique-violation code → friendly error.
		if isUniqueViolation(err) {
			return nil, ErrNameTaken
		}
		return nil, err
	}
	return p, nil
}

// Delete removes a portfolio. Refuses if any transactions reference it —
// transactions are an immutable audit trail and shouldn't disappear with
// a portfolio rename. Holdings cascade automatically via FK.
func (r *Repo) Delete(ctx context.Context, userID, id uuid.UUID) error {
	// Fail fast if there are transactions; cascade would drop them silently.
	var txCount int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE portfolio_id = $1`, id,
	).Scan(&txCount); err != nil {
		return err
	}
	if txCount > 0 {
		return ErrPortfolioBusy
	}
	cmd, err := r.db.Exec(ctx,
		`DELETE FROM portfolios WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CountByUser returns how many portfolios the user owns. Used to refuse
// deleting their last one (every user must have at least one).
func (r *Repo) CountByUser(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM portfolios WHERE user_id = $1`, userID,
	).Scan(&n)
	return n, err
}

// isUniqueViolation tests whether err is a Postgres 23505 (unique violation).
// Imported lazily here so the rest of the package doesn't depend on pgconn.
func isUniqueViolation(err error) bool {
	type pgErr interface {
		SQLState() string
	}
	var pge pgErr
	if errors.As(err, &pge) {
		return pge.SQLState() == "23505"
	}
	return false
}

// TxnRow is the minimal slice of a transaction needed to replay portfolio
// holdings day-by-day. Avoids importing the heavier transaction.Transaction.
type TxnRow struct {
	Ticker     string
	AssetType  string
	Side       string
	Quantity   decimal.Decimal
	Price      decimal.Decimal
	ExecutedAt time.Time
}

// ListTxnsForReplay returns every transaction belonging to the portfolio
// ordered oldest-first. The time-series builder walks this in order to
// reconstruct holdings on any past date.
func (r *Repo) ListTxnsForReplay(ctx context.Context, portfolioID uuid.UUID) ([]TxnRow, error) {
	const q = `
		SELECT ticker, asset_type, side, quantity, price, executed_at
		FROM transactions
		WHERE portfolio_id = $1
		ORDER BY executed_at ASC, id ASC`
	rows, err := r.db.Query(ctx, q, portfolioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TxnRow{}
	for rows.Next() {
		var t TxnRow
		if err := rows.Scan(&t.Ticker, &t.AssetType, &t.Side, &t.Quantity, &t.Price, &t.ExecutedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
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
