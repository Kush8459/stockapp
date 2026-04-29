package transaction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/metrics"
	"github.com/stockapp/backend/internal/wallet"
)

type Side string

const (
	SideBuy  Side = "buy"
	SideSell Side = "sell"
)

// Source tags the origin of a transaction.
type Source string

const (
	SourceManual    Source = "manual"
	SourceSIP       Source = "sip"
	SourceAlert     Source = "alert"
	SourceRebalance Source = "rebalance"
)

var (
	ErrInsufficientQty     = errors.New("insufficient quantity")
	ErrHoldingNotFound     = errors.New("holding not found")
	ErrNotAllowed          = errors.New("not allowed")
	ErrInsufficientBalance = errors.New("insufficient wallet balance")
)

type Transaction struct {
	ID          uuid.UUID       `json:"id"`
	UserID      uuid.UUID       `json:"userId"`
	PortfolioID uuid.UUID       `json:"portfolioId"`
	Ticker      string          `json:"ticker"`
	AssetType   string          `json:"assetType"`
	Side        Side            `json:"side"`
	Quantity    decimal.Decimal `json:"quantity"`
	Price       decimal.Decimal `json:"price"`
	TotalAmount decimal.Decimal `json:"totalAmount"`
	Fees        decimal.Decimal `json:"fees"`
	// Charges breakdown — populated for new trades; zero for legacy rows.
	Brokerage decimal.Decimal `json:"brokerage"`
	Statutory decimal.Decimal `json:"statutory"`
	// NetAmount is what hit the wallet:
	//   buy:  qty*price + brokerage + statutory  (debit)
	//   sell: qty*price − brokerage − statutory  (credit)
	NetAmount  decimal.Decimal `json:"netAmount"`
	Note       *string         `json:"note,omitempty"`
	Source     Source          `json:"source"`
	SourceID   *uuid.UUID      `json:"sourceId,omitempty"`
	ExecutedAt time.Time       `json:"executedAt"`
}

// LedgerEntry is a single row of the double-entry ledger attached to a txn.
type LedgerEntry struct {
	ID        int64           `json:"id"`
	Account   string          `json:"account"`
	Direction string          `json:"direction"` // debit | credit
	Amount    decimal.Decimal `json:"amount"`
	Currency  string          `json:"currency"`
	CreatedAt time.Time       `json:"createdAt"`
}

// AuditRow is the audit_log entry recorded at transaction time.
type AuditRow struct {
	ID         int64           `json:"id"`
	Action     string          `json:"action"`
	EntityType string          `json:"entityType"`
	EntityID   *uuid.UUID      `json:"entityId,omitempty"`
	Payload    json.RawMessage `json:"payload"`
	IP         *string         `json:"ip,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// Detail bundles everything a UI needs to render a transaction fully —
// the canonical row, the double-entry pair(s), and the audit breadcrumb.
type Detail struct {
	Transaction   Transaction   `json:"transaction"`
	LedgerEntries []LedgerEntry `json:"ledgerEntries"`
	AuditEntries  []AuditRow    `json:"auditEntries"`
}

type ExecuteInput struct {
	UserID      uuid.UUID
	PortfolioID uuid.UUID
	Ticker      string
	AssetType   string
	Side        Side
	Quantity    decimal.Decimal
	Price       decimal.Decimal
	Fees        decimal.Decimal
	Note        *string
	IP          string
	// Source defaults to "manual" when empty. SourceID links back to the
	// originating entity (e.g. sip_plans.id) when applicable.
	Source   Source
	SourceID *uuid.UUID
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Execute atomically records a buy/sell and updates the holdings row.
//
// Safety model:
//   - The whole thing runs in a single transaction at SERIALIZABLE isolation.
//   - Before touching the holding we SELECT FOR UPDATE so concurrent sells of
//     the same position serialize.
//   - We insert into transactions, write the double-entry pair into
//     ledger_entries, update the holdings row, and append to audit_log — or
//     nothing, on error.
func (s *Service) Execute(ctx context.Context, in ExecuteInput) (txn *Transaction, err error) {
	// Observe end-to-end latency including the SERIALIZABLE outer transaction.
	start := time.Now()
	defer func() {
		metrics.TradeExecuteSeconds.
			WithLabelValues(string(in.Side), in.AssetType).
			Observe(time.Since(start).Seconds())
		if err != nil {
			metrics.TradeFailedTotal.WithLabelValues(reasonForError(err)).Inc()
		}
	}()

	if in.Quantity.Sign() <= 0 {
		return nil, fmt.Errorf("quantity must be > 0")
	}
	if in.Price.Sign() < 0 {
		return nil, fmt.Errorf("price must be >= 0")
	}
	if in.Side != SideBuy && in.Side != SideSell {
		return nil, fmt.Errorf("invalid side")
	}
	source := in.Source
	if source == "" {
		source = SourceManual
	}

	// Compute charges deterministically from the asset type / side / value.
	// The legacy `Fees` field (still on the input for backwards compat) is
	// folded into the charge bucket so callers can override if needed.
	charges := wallet.ComputeCharges(in.AssetType, string(in.Side), in.Quantity, in.Price)
	if in.Fees.Sign() > 0 {
		charges.Statutory = charges.Statutory.Add(in.Fees)
		charges.Total = charges.Total.Add(in.Fees)
	}

	gross := in.Price.Mul(in.Quantity)
	netAmount := wallet.NetAmount(string(in.Side), in.Quantity, in.Price, charges)

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck — rollback on any path except commit

	// Verify the portfolio belongs to the user before doing anything else.
	var owner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT user_id FROM portfolios WHERE id = $1`, in.PortfolioID).Scan(&owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotAllowed
		}
		return nil, err
	}
	if owner != in.UserID {
		return nil, ErrNotAllowed
	}

	// Lock the existing holding row (if any) to serialize concurrent writers.
	var (
		holdingID    uuid.UUID
		curQty       decimal.Decimal
		curAvg       decimal.Decimal
		holdingFound = true
	)
	err = tx.QueryRow(ctx, `
		SELECT id, quantity, avg_buy_price
		FROM holdings
		WHERE portfolio_id = $1 AND ticker = $2 AND asset_type = $3
		FOR UPDATE`,
		in.PortfolioID, in.Ticker, in.AssetType,
	).Scan(&holdingID, &curQty, &curAvg)
	if errors.Is(err, pgx.ErrNoRows) {
		holdingFound = false
	} else if err != nil {
		return nil, err
	}

	var newQty, newAvg decimal.Decimal
	switch in.Side {
	case SideBuy:
		if !holdingFound {
			newQty = in.Quantity
			newAvg = in.Price
		} else {
			// weighted-average cost basis
			curCost := curAvg.Mul(curQty)
			addCost := in.Price.Mul(in.Quantity)
			newQty = curQty.Add(in.Quantity)
			if newQty.IsZero() {
				newAvg = decimal.Zero
			} else {
				newAvg = curCost.Add(addCost).Div(newQty)
			}
		}

	case SideSell:
		if !holdingFound {
			return nil, ErrHoldingNotFound
		}
		if in.Quantity.Cmp(curQty) > 0 {
			return nil, ErrInsufficientQty
		}
		newQty = curQty.Sub(in.Quantity)
		newAvg = curAvg // selling doesn't change cost basis
	}

	// Upsert the holding row.
	if holdingFound {
		if _, err := tx.Exec(ctx, `
			UPDATE holdings SET quantity = $1, avg_buy_price = $2 WHERE id = $3`,
			newQty, newAvg, holdingID,
		); err != nil {
			return nil, err
		}
	} else {
		if err := tx.QueryRow(ctx, `
			INSERT INTO holdings (portfolio_id, ticker, asset_type, quantity, avg_buy_price)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			in.PortfolioID, in.Ticker, in.AssetType, newQty, newAvg,
		).Scan(&holdingID); err != nil {
			return nil, err
		}
	}

	// Insert the transaction.
	txID := uuid.New()
	executedAt := time.Now().UTC()
	// total_amount keeps the historical "gross + fees" semantics so older
	// reports/exports still tie out. New code reads brokerage / statutory /
	// net_amount directly.
	totalLegacy := gross.Add(in.Fees)
	if _, err := tx.Exec(ctx, `
		INSERT INTO transactions
		  (id, user_id, portfolio_id, ticker, asset_type, side, quantity, price,
		   total_amount, fees, brokerage, statutory_charges, net_amount,
		   note, source, source_id, executed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
		txID, in.UserID, in.PortfolioID, in.Ticker, in.AssetType, in.Side,
		in.Quantity, in.Price, totalLegacy, in.Fees,
		charges.Brokerage, charges.Statutory, netAmount,
		in.Note, source, in.SourceID, executedAt,
	); err != nil {
		return nil, err
	}

	// Move cash on the wallet within this same outer transaction so a
	// successful trade can never desynchronise from the wallet balance.
	signedAmount := netAmount
	walletKind := "sell"
	if in.Side == SideBuy {
		signedAmount = netAmount.Neg()
		walletKind = "buy"
	}
	walletNote := fmt.Sprintf("%s %s × %s @ %s", in.Side, in.Ticker,
		in.Quantity.String(), in.Price.String())
	if _, err := wallet.ApplyTradeInTx(
		ctx, tx, in.UserID, walletKind, signedAmount,
		nil, nil, &walletNote, &txID,
	); err != nil {
		if errors.Is(err, wallet.ErrInsufficientBalance) {
			return nil, ErrInsufficientBalance
		}
		return nil, err
	}

	// Double-entry: buy debits positions, credits cash. Sell is the mirror.
	cashDir, posDir := "credit", "debit"
	if in.Side == SideSell {
		cashDir, posDir = "debit", "credit"
	}
	positionAccount := "positions:" + in.Ticker
	entries := [][]any{
		{txID, in.UserID, in.PortfolioID, positionAccount, posDir, in.Price.Mul(in.Quantity)},
		{txID, in.UserID, in.PortfolioID, "cash", cashDir, in.Price.Mul(in.Quantity)},
	}
	if in.Fees.Sign() > 0 {
		entries = append(entries,
			[]any{txID, in.UserID, in.PortfolioID, "fees", "debit", in.Fees},
			[]any{txID, in.UserID, in.PortfolioID, "cash", "credit", in.Fees},
		)
	}
	for _, e := range entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_entries (transaction_id, user_id, portfolio_id, account, direction, amount)
			VALUES ($1,$2,$3,$4,$5,$6)`, e...,
		); err != nil {
			return nil, err
		}
	}

	// Audit.
	payload, _ := json.Marshal(map[string]any{
		"ticker":    in.Ticker,
		"side":      in.Side,
		"quantity":  in.Quantity.String(),
		"price":     in.Price.String(),
		"total":     totalLegacy.String(),
		"brokerage": charges.Brokerage.String(),
		"statutory": charges.Statutory.String(),
		"netAmount": netAmount.String(),
		"holdingId": holdingID,
		"source":    source,
		"sourceId":  in.SourceID,
	})
	// audit_log.ip is an INET column. Only hand pgx a value we know parses
	// cleanly; anything else becomes SQL NULL so one bad caller can't poison
	// the whole transaction.
	var ip any
	if in.IP != "" && net.ParseIP(in.IP) != nil {
		ip = in.IP
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (user_id, action, entity_type, entity_id, payload, ip)
		VALUES ($1, 'transaction.create', 'transaction', $2, $3, $4)`,
		in.UserID, txID, payload, ip,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	metrics.TradeTotal.
		WithLabelValues(string(in.Side), in.AssetType, string(source)).
		Inc()

	return &Transaction{
		ID:          txID,
		UserID:      in.UserID,
		PortfolioID: in.PortfolioID,
		Ticker:      in.Ticker,
		AssetType:   in.AssetType,
		Side:        in.Side,
		Quantity:    in.Quantity,
		Price:       in.Price,
		TotalAmount: totalLegacy,
		Fees:        in.Fees,
		Brokerage:   charges.Brokerage,
		Statutory:   charges.Statutory,
		NetAmount:   netAmount,
		Note:        in.Note,
		Source:      source,
		SourceID:    in.SourceID,
		ExecutedAt:  executedAt,
	}, nil
}

// Detail returns the transaction by id (user-scoped) together with its
// ledger entries and audit log row(s). Returns ErrNotAllowed for any txn
// that doesn't belong to the caller so we don't leak existence.
func (s *Service) Detail(ctx context.Context, userID, id uuid.UUID) (*Detail, error) {
	const txnQ = `
		SELECT id, user_id, portfolio_id, ticker, asset_type, side, quantity, price,
		       total_amount, fees, brokerage, statutory_charges, net_amount,
		       note, source, source_id, executed_at
		FROM transactions WHERE id = $1`
	var t Transaction
	if err := s.db.QueryRow(ctx, txnQ, id).Scan(
		&t.ID, &t.UserID, &t.PortfolioID, &t.Ticker, &t.AssetType, &t.Side,
		&t.Quantity, &t.Price, &t.TotalAmount, &t.Fees,
		&t.Brokerage, &t.Statutory, &t.NetAmount,
		&t.Note, &t.Source, &t.SourceID, &t.ExecutedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotAllowed
		}
		return nil, err
	}
	if t.UserID != userID {
		return nil, ErrNotAllowed
	}

	entries := []LedgerEntry{}
	rows, err := s.db.Query(ctx, `
		SELECT id, account, direction, amount, currency, created_at
		FROM ledger_entries WHERE transaction_id = $1
		ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.Account, &e.Direction, &e.Amount, &e.Currency, &e.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		entries = append(entries, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	audits := []AuditRow{}
	rows, err = s.db.Query(ctx, `
		SELECT id, action, entity_type, entity_id, payload, host(ip)::text, created_at
		FROM audit_log
		WHERE entity_type = 'transaction' AND entity_id = $1
		ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a AuditRow
		var ipStr *string
		if err := rows.Scan(&a.ID, &a.Action, &a.EntityType, &a.EntityID, &a.Payload, &ipStr, &a.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		a.IP = ipStr
		audits = append(audits, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &Detail{Transaction: t, LedgerEntries: entries, AuditEntries: audits}, nil
}

// reasonForError collapses an Execute error into one of the labels we
// track in `trade_failed_total`. Anything unexpected gets `internal`.
func reasonForError(err error) string {
	switch {
	case errors.Is(err, ErrInsufficientBalance):
		return "insufficient_balance"
	case errors.Is(err, ErrInsufficientQty):
		return "insufficient_qty"
	case errors.Is(err, ErrHoldingNotFound):
		return "no_position"
	case errors.Is(err, ErrNotAllowed):
		return "not_allowed"
	default:
		return "internal"
	}
}

func (s *Service) ListForUser(ctx context.Context, userID uuid.UUID, limit int) ([]Transaction, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	const q = `
		SELECT id, user_id, portfolio_id, ticker, asset_type, side, quantity, price,
		       total_amount, fees, brokerage, statutory_charges, net_amount,
		       note, source, source_id, executed_at
		FROM transactions
		WHERE user_id = $1
		ORDER BY executed_at DESC
		LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transaction{}
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.PortfolioID, &t.Ticker, &t.AssetType, &t.Side,
			&t.Quantity, &t.Price, &t.TotalAmount, &t.Fees,
			&t.Brokerage, &t.Statutory, &t.NetAmount,
			&t.Note, &t.Source, &t.SourceID, &t.ExecutedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
