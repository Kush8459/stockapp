package wallet

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/metrics"
)

// SeedAmount is what every user gets when their wallet is first created
// (signup, plus an upfront backfill on existing accounts via migration).
// Paper-trading platform — this is play money, not a deposit.
var SeedAmount = decimal.RequireFromString("100000.00")

var (
	ErrWalletNotFound       = errors.New("wallet not found")
	ErrInsufficientBalance  = errors.New("insufficient wallet balance")
	ErrInvalidAmount        = errors.New("amount must be positive")
	ErrUnsupportedMethod    = errors.New("unsupported deposit/withdraw method")
	ErrWithdrawTooLarge     = errors.New("withdraw amount exceeds balance")
)

type Wallet struct {
	ID        uuid.UUID       `json:"id"`
	UserID    uuid.UUID       `json:"userId"`
	Balance   decimal.Decimal `json:"balance"`
	Currency  string          `json:"currency"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type Movement struct {
	ID            uuid.UUID       `json:"id"`
	WalletID      uuid.UUID       `json:"walletId"`
	UserID        uuid.UUID       `json:"userId"`
	Kind          string          `json:"kind"`   // deposit|withdraw|buy|sell|charge|refund
	Amount        decimal.Decimal `json:"amount"` // signed; +ve = credit, -ve = debit
	BalanceAfter  decimal.Decimal `json:"balanceAfter"`
	Method        *string         `json:"method,omitempty"`
	Reference     *string         `json:"reference,omitempty"`
	TransactionID *uuid.UUID      `json:"transactionId,omitempty"`
	Note          *string         `json:"note,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
}

// validMethods are accepted on POST /wallet/deposit and /wallet/withdraw.
// "bonus" is reserved for the seed-on-signup credit (not user-callable).
var validMethods = map[string]struct{}{
	"upi":  {},
	"bank": {},
	"card": {},
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// EnsureForUser creates the user's wallet with the seed balance if it
// doesn't already exist. Idempotent — safe to call on every signup.
func (s *Service) EnsureForUser(ctx context.Context, userID uuid.UUID) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var walletID uuid.UUID
	var existed bool
	err = tx.QueryRow(ctx, `SELECT id FROM wallets WHERE user_id = $1`, userID).Scan(&walletID)
	if err == nil {
		existed = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	if !existed {
		if err := tx.QueryRow(ctx, `
			INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
			RETURNING id`,
			userID, SeedAmount,
		).Scan(&walletID); err != nil {
			return err
		}
		ref := "Welcome bonus"
		method := "bonus"
		note := "Starter balance for paper-trading mode"
		if _, err := tx.Exec(ctx, `
			INSERT INTO wallet_transactions
			  (wallet_id, user_id, kind, amount, balance_after, method, reference, note)
			VALUES ($1, $2, 'deposit', $3, $3, $4, $5, $6)`,
			walletID, userID, SeedAmount, method, ref, note,
		); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// Get returns the user's wallet, creating it (with the seed) if it doesn't
// exist. Means callers can always assume a wallet is available — useful
// for older accounts that pre-date the wallet feature.
func (s *Service) Get(ctx context.Context, userID uuid.UUID) (*Wallet, error) {
	w, err := s.fetch(ctx, s.db, userID)
	if errors.Is(err, ErrWalletNotFound) {
		if err := s.EnsureForUser(ctx, userID); err != nil {
			return nil, err
		}
		return s.fetch(ctx, s.db, userID)
	}
	return w, err
}

func (s *Service) fetch(ctx context.Context, q querier, userID uuid.UUID) (*Wallet, error) {
	var w Wallet
	err := q.QueryRow(ctx, `
		SELECT id, user_id, balance, currency, created_at, updated_at
		FROM wallets WHERE user_id = $1`,
		userID,
	).Scan(&w.ID, &w.UserID, &w.Balance, &w.Currency, &w.CreatedAt, &w.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWalletNotFound
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// querier is the small intersection between *pgxpool.Pool and pgx.Tx that
// lets fetch() work with either. Avoids duplicating the SQL.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Deposit credits the wallet with `amount`. Method must be one of
// upi/bank/card; "bonus" is reserved for the signup seed.
func (s *Service) Deposit(ctx context.Context, userID uuid.UUID, amount decimal.Decimal, method, reference, note string) (*Movement, error) {
	if amount.Sign() <= 0 {
		return nil, ErrInvalidAmount
	}
	method = strings.ToLower(strings.TrimSpace(method))
	if _, ok := validMethods[method]; !ok {
		return nil, ErrUnsupportedMethod
	}
	return s.applyMovement(ctx, userID, "deposit", amount, &method, ref(reference), strPtr(note), nil)
}

// Withdraw debits the wallet by `amount`. Fails if the balance can't cover it.
func (s *Service) Withdraw(ctx context.Context, userID uuid.UUID, amount decimal.Decimal, method, reference, note string) (*Movement, error) {
	if amount.Sign() <= 0 {
		return nil, ErrInvalidAmount
	}
	method = strings.ToLower(strings.TrimSpace(method))
	if _, ok := validMethods[method]; !ok {
		return nil, ErrUnsupportedMethod
	}
	return s.applyMovement(ctx, userID, "withdraw", amount.Neg(), &method, ref(reference), strPtr(note), nil)
}

// applyMovement runs a single user-driven deposit/withdraw in its own tx.
// Trade-side debits/credits go through ApplyTradeInTx so they share the
// outer transaction's atomicity guarantees.
func (s *Service) applyMovement(
	ctx context.Context,
	userID uuid.UUID,
	kind string,
	signedAmount decimal.Decimal,
	method, reference, note *string,
	txnID *uuid.UUID,
) (*Movement, error) {
	if err := s.EnsureForUser(ctx, userID); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	mv, err := ApplyTradeInTx(ctx, tx, userID, kind, signedAmount, method, reference, note, txnID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return mv, nil
}

// ApplyTradeInTx is the wallet-mutation entry point used inside the
// transaction service's outer SQL transaction. Locks the wallet row,
// validates the new balance, writes a wallet_transactions row, and
// updates wallets.balance — all within the caller's tx.
//
//	signedAmount > 0  → credit  (deposit, sell)
//	signedAmount < 0  → debit   (withdraw, buy, charge)
func ApplyTradeInTx(
	ctx context.Context,
	tx pgx.Tx,
	userID uuid.UUID,
	kind string,
	signedAmount decimal.Decimal,
	method, reference, note *string,
	txnID *uuid.UUID,
) (*Movement, error) {
	var (
		walletID uuid.UUID
		balance  decimal.Decimal
	)
	err := tx.QueryRow(ctx, `
		SELECT id, balance FROM wallets
		WHERE user_id = $1
		FOR UPDATE`, userID,
	).Scan(&walletID, &balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWalletNotFound
	}
	if err != nil {
		return nil, err
	}

	newBalance := balance.Add(signedAmount).Round(2)
	if newBalance.Sign() < 0 {
		if signedAmount.Sign() < 0 && (kind == "buy" || kind == "withdraw") {
			if kind == "withdraw" {
				return nil, ErrWithdrawTooLarge
			}
			return nil, ErrInsufficientBalance
		}
		return nil, fmt.Errorf("wallet balance would go negative")
	}

	if _, err := tx.Exec(ctx, `
		UPDATE wallets SET balance = $1 WHERE id = $2`,
		newBalance, walletID,
	); err != nil {
		return nil, err
	}

	id := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO wallet_transactions
		  (id, wallet_id, user_id, kind, amount, balance_after, method, reference, transaction_id, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		id, walletID, userID, kind, signedAmount.Round(2), newBalance, method, reference, txnID, note,
	); err != nil {
		return nil, err
	}
	metrics.WalletMovementTotal.WithLabelValues(kind).Inc()

	return &Movement{
		ID:            id,
		WalletID:      walletID,
		UserID:        userID,
		Kind:          kind,
		Amount:        signedAmount.Round(2),
		BalanceAfter:  newBalance,
		Method:        method,
		Reference:     reference,
		TransactionID: txnID,
		Note:          note,
		CreatedAt:     time.Now().UTC(),
	}, nil
}

// History returns the user's wallet movements newest-first.
func (s *Service) History(ctx context.Context, userID uuid.UUID, limit int) ([]Movement, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, wallet_id, user_id, kind, amount, balance_after, method, reference,
		       transaction_id, note, created_at
		FROM wallet_transactions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2`, userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Movement{}
	for rows.Next() {
		var m Movement
		if err := rows.Scan(
			&m.ID, &m.WalletID, &m.UserID, &m.Kind, &m.Amount, &m.BalanceAfter,
			&m.Method, &m.Reference, &m.TransactionID, &m.Note, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func ref(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func strPtr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}
