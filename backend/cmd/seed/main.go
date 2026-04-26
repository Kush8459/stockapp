// cmd/seed inserts a demo user + portfolio + holdings + backdated transactions.
// Run after migrations:
//
//   docker compose --profile tools run --rm migrate up
//   go run ./cmd/seed
//
// Login: demo@stockapp.dev / demo1234
//
// Idempotent: re-running is safe. Holdings upsert by (portfolio, ticker).
// Backing transactions are only inserted when the portfolio has no
// transactions yet, so we never duplicate them.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/config"
	"github.com/stockapp/backend/internal/postgres"
)

type seedHolding struct {
	Ticker    string
	AssetType string
	Qty       string
	AvgPrice  string
	// MonthsAgo is how long ago the demo "bought" this position — used to
	// backdate the synthetic transaction so XIRR has something meaningful
	// to compute over.
	MonthsAgo int
}

var demoHoldings = []seedHolding{
	{"RELIANCE", "stock", "10", "2450.00", 14},
	{"TCS", "stock", "5", "3850.00", 11},
	{"INFY", "stock", "20", "1560.00", 9},
	{"HDFCBANK", "stock", "12", "1650.00", 16},
	{"ICICIBANK", "stock", "15", "1100.00", 8},
	{"SBIN", "stock", "25", "740.00", 6},
	{"WIPRO", "stock", "30", "510.00", 4},
	// Mutual funds — scheme codes map to real AMFI schemes via mfapi.in.
	{"AXISBLUE", "mf", "100", "55.00", 24},
	{"PPFAS", "mf", "150", "72.00", 30},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := postgres.New(ctx, cfg.Postgres.DSN())
	if err != nil {
		return err
	}
	defer db.Close()

	hash, err := auth.HashPassword("demo1234")
	if err != nil {
		return err
	}

	userID, err := upsertUser(ctx, db, "demo@stockapp.dev", hash, "Demo Investor")
	if err != nil {
		return err
	}
	fmt.Println("user:", userID)

	portfolioID, err := upsertPortfolio(ctx, db, userID, "Long-Term Wealth")
	if err != nil {
		return err
	}
	fmt.Println("portfolio:", portfolioID)

	for _, h := range demoHoldings {
		q, err := decimal.NewFromString(h.Qty)
		if err != nil {
			return err
		}
		p, err := decimal.NewFromString(h.AvgPrice)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `
			INSERT INTO holdings (portfolio_id, ticker, asset_type, quantity, avg_buy_price)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (portfolio_id, ticker, asset_type) DO UPDATE
			  SET quantity = EXCLUDED.quantity, avg_buy_price = EXCLUDED.avg_buy_price`,
			portfolioID, h.Ticker, h.AssetType, q, p,
		); err != nil {
			return err
		}
	}
	fmt.Printf("inserted %d holdings\n", len(demoHoldings))

	// Backing transactions: only insert if this portfolio has nothing yet.
	// Keeps the seeder idempotent without burying the user's real history.
	var existingTxns int
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE portfolio_id = $1`,
		portfolioID,
	).Scan(&existingTxns); err != nil {
		return err
	}

	if existingTxns == 0 {
		n, err := seedTransactions(ctx, db, userID, portfolioID)
		if err != nil {
			return err
		}
		fmt.Printf("wrote %d backdated transactions (so XIRR has months of history)\n", n)
	} else {
		fmt.Printf("skipping transactions — portfolio already has %d\n", existingTxns)
	}

	fmt.Println("\n--- login ---\nemail:    demo@stockapp.dev\npassword: demo1234")
	return nil
}

// seedTransactions writes one backdated buy per demo holding, complete with
// double-entry ledger rows and an audit breadcrumb — mirroring what
// transaction.Service.Execute would have written at trade time.
func seedTransactions(ctx context.Context, db *pgxpool.Pool, userID, portfolioID uuid.UUID) (int, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	count := 0
	for _, h := range demoHoldings {
		qty, err := decimal.NewFromString(h.Qty)
		if err != nil {
			return 0, err
		}
		price, err := decimal.NewFromString(h.AvgPrice)
		if err != nil {
			return 0, err
		}
		total := price.Mul(qty)
		executedAt := time.Now().UTC().AddDate(0, -h.MonthsAgo, 0)

		txID := uuid.New()
		if _, err := tx.Exec(ctx, `
			INSERT INTO transactions
			  (id, user_id, portfolio_id, ticker, asset_type, side, quantity, price,
			   total_amount, fees, note, source, source_id, executed_at)
			VALUES ($1,$2,$3,$4,$5,'buy',$6,$7,$8,0,$9,'manual',NULL,$10)`,
			txID, userID, portfolioID, h.Ticker, h.AssetType,
			qty, price, total, "Initial position (seed)", executedAt,
		); err != nil {
			return 0, err
		}

		if err := writeLedger(ctx, tx, txID, userID, portfolioID, h.Ticker, total); err != nil {
			return 0, err
		}

		payload, _ := json.Marshal(map[string]any{
			"ticker":   h.Ticker,
			"side":     "buy",
			"quantity": qty.String(),
			"price":    price.String(),
			"total":    total.String(),
			"source":   "seed",
		})
		if _, err := tx.Exec(ctx, `
			INSERT INTO audit_log (user_id, action, entity_type, entity_id, payload)
			VALUES ($1, 'transaction.create', 'transaction', $2, $3)`,
			userID, txID, payload,
		); err != nil {
			return 0, err
		}
		count++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return count, nil
}

func writeLedger(
	ctx context.Context, tx pgx.Tx,
	txID, userID, portfolioID uuid.UUID,
	ticker string, amount decimal.Decimal,
) error {
	entries := [][]any{
		{txID, userID, portfolioID, "positions:" + ticker, "debit", amount},
		{txID, userID, portfolioID, "cash", "credit", amount},
	}
	for _, e := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_entries (transaction_id, user_id, portfolio_id, account, direction, amount)
			VALUES ($1,$2,$3,$4,$5,$6)`, e...,
		); err != nil {
			return err
		}
	}
	return nil
}

func upsertUser(ctx context.Context, db *pgxpool.Pool, email, hash, display string) (uuid.UUID, error) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
		RETURNING id`, email, hash, display,
	).Scan(&id)
	return id, err
}

func upsertPortfolio(ctx context.Context, db *pgxpool.Pool, userID uuid.UUID, name string) (uuid.UUID, error) {
	var id uuid.UUID
	err := db.QueryRow(ctx, `
		INSERT INTO portfolios (user_id, name, base_ccy)
		VALUES ($1, $2, 'INR')
		ON CONFLICT (user_id, name) DO UPDATE SET base_ccy = EXCLUDED.base_ccy
		RETURNING id`, userID, name,
	).Scan(&id)
	return id, err
}
