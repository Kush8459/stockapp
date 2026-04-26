package pnl

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// maxReasonableRate caps XIRR at ±500%/yr. Above this, the rate is almost
// certainly an artefact of very-short-timespan cashflows (e.g. a brand-new
// SIP whose runs are minutes apart) rather than a useful return figure.
// The UI treats these the same as "not enough flows".
const maxReasonableRate = 5.0

// Service computes XIRR and other return metrics against the transactions
// table, reading current prices from the Redis cache for the terminal flow.
type Service struct {
	db     *pgxpool.Pool
	prices *price.Cache
}

func NewService(db *pgxpool.Pool, prices *price.Cache) *Service {
	return &Service{db: db, prices: prices}
}

// Result bundles an XIRR rate with the cashflows that produced it. The UI
// uses the flow count as a "is this rate actually meaningful?" sanity check.
type Result struct {
	Rate      float64 `json:"rate"`
	FlowCount int     `json:"flowCount"`
}

// PortfolioXIRR computes the XIRR across every buy/sell in a portfolio plus
// the current mark-to-market value of every open position as a terminal
// positive flow.
func (s *Service) PortfolioXIRR(ctx context.Context, portfolioID uuid.UUID) (*Result, error) {
	rows, err := s.db.Query(ctx, `
		SELECT ticker, side, quantity, price, total_amount, executed_at
		FROM transactions
		WHERE portfolio_id = $1
		ORDER BY executed_at`, portfolioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	flows := make([]CashFlow, 0, 32)
	// current position per ticker = net qty we still need to value at the terminal flow
	openQty := map[string]decimal.Decimal{}

	for rows.Next() {
		var ticker, side string
		var qty, pr, total decimal.Decimal
		var when time.Time
		if err := rows.Scan(&ticker, &side, &qty, &pr, &total, &when); err != nil {
			return nil, err
		}
		totalF, _ := total.Float64()
		if side == "buy" {
			flows = append(flows, CashFlow{When: when, Amount: -totalF})
			openQty[ticker] = openQty[ticker].Add(qty)
		} else {
			flows = append(flows, CashFlow{When: when, Amount: totalF})
			openQty[ticker] = openQty[ticker].Sub(qty)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Terminal cashflow: value each open position at its live price as of now.
	var terminal decimal.Decimal
	tickers := make([]string, 0, len(openQty))
	for t, q := range openQty {
		if q.Sign() > 0 {
			tickers = append(tickers, t)
		}
	}
	if len(tickers) > 0 {
		quotes, _ := s.prices.GetMany(ctx, tickers)
		for _, t := range tickers {
			q, ok := quotes[t]
			if !ok {
				continue
			}
			terminal = terminal.Add(q.Price.Mul(openQty[t]))
		}
	}
	if terminal.Sign() > 0 {
		v, _ := terminal.Float64()
		flows = append(flows, CashFlow{When: time.Now().UTC(), Amount: v})
	}

	rate, err := XIRR(flows)
	if err != nil {
		return &Result{Rate: 0, FlowCount: len(flows)}, errInsufficient(err)
	}
	if math.Abs(rate) > maxReasonableRate {
		return &Result{Rate: 0, FlowCount: len(flows)}, ErrInsufficientFlows
	}
	return &Result{Rate: rate, FlowCount: len(flows)}, nil
}

// HoldingXIRR is the same as PortfolioXIRR but scoped to a single ticker.
func (s *Service) HoldingXIRR(ctx context.Context, portfolioID uuid.UUID, ticker string) (*Result, error) {
	rows, err := s.db.Query(ctx, `
		SELECT side, quantity, price, total_amount, executed_at
		FROM transactions
		WHERE portfolio_id = $1 AND ticker = $2
		ORDER BY executed_at`, portfolioID, ticker)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	flows := make([]CashFlow, 0, 8)
	var openQty decimal.Decimal
	for rows.Next() {
		var side string
		var qty, pr, total decimal.Decimal
		var when time.Time
		if err := rows.Scan(&side, &qty, &pr, &total, &when); err != nil {
			return nil, err
		}
		totalF, _ := total.Float64()
		if side == "buy" {
			flows = append(flows, CashFlow{When: when, Amount: -totalF})
			openQty = openQty.Add(qty)
		} else {
			flows = append(flows, CashFlow{When: when, Amount: totalF})
			openQty = openQty.Sub(qty)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if openQty.Sign() > 0 {
		q, err := s.prices.Get(ctx, ticker)
		if err == nil && q != nil {
			v, _ := q.Price.Mul(openQty).Float64()
			flows = append(flows, CashFlow{When: time.Now().UTC(), Amount: v})
		}
	}

	rate, err := XIRR(flows)
	if err != nil {
		return &Result{Rate: 0, FlowCount: len(flows)}, errInsufficient(err)
	}
	if math.Abs(rate) > maxReasonableRate {
		return &Result{Rate: 0, FlowCount: len(flows)}, ErrInsufficientFlows
	}
	return &Result{Rate: rate, FlowCount: len(flows)}, nil
}

// ErrInsufficientFlows signals the caller that XIRR cannot be computed with
// the given transaction history — typically for holdings that were seeded
// directly without backing buy transactions.
var ErrInsufficientFlows = errors.New("insufficient cashflows for xirr")

func errInsufficient(wrapped error) error {
	return errors.Join(ErrInsufficientFlows, wrapped)
}
