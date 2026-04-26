package portfolio

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// Service owns portfolio business logic (as distinct from raw persistence).
type Service struct {
	repo   *Repo
	prices *price.Cache
}

func NewService(db *pgxpool.Pool, prices *price.Cache) *Service {
	return &Service{repo: NewRepo(db), prices: prices}
}

// CreateDefault satisfies user.portfolioCreator.
func (s *Service) CreateDefault(ctx context.Context, userID uuid.UUID, name string) error {
	_, err := s.repo.Create(ctx, userID, name, "INR")
	return err
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Portfolio, error) {
	return s.repo.ListByUser(ctx, userID)
}

// EnrichedHoldings returns the portfolio's holdings joined with live prices
// from Redis and computed P&L.
func (s *Service) EnrichedHoldings(ctx context.Context, portfolioID uuid.UUID) ([]HoldingView, error) {
	holdings, err := s.repo.ListHoldings(ctx, portfolioID)
	if err != nil {
		return nil, err
	}
	if len(holdings) == 0 {
		return []HoldingView{}, nil
	}

	tickers := make([]string, 0, len(holdings))
	for _, h := range holdings {
		tickers = append(tickers, h.Ticker)
	}
	quotes, _ := s.prices.GetMany(ctx, tickers)

	out := make([]HoldingView, 0, len(holdings))
	for _, h := range holdings {
		q, ok := quotes[h.Ticker]
		cur := h.AvgBuyPrice
		var dayChange decimal.Decimal
		if ok {
			cur = q.Price
			dayChange = q.ChangePct
		}
		invested := h.AvgBuyPrice.Mul(h.Quantity)
		value := cur.Mul(h.Quantity)
		pnl := value.Sub(invested)
		pnlPct := decimal.Zero
		if !invested.IsZero() {
			pnlPct = pnl.Div(invested).Mul(decimal.NewFromInt(100))
		}
		out = append(out, HoldingView{
			Holding:      h,
			CurrentPrice: cur,
			CurrentValue: value,
			Invested:     invested,
			PnL:          pnl,
			PnLPercent:   pnlPct,
			DayChangePct: dayChange,
		})
	}
	return out, nil
}

// Summary aggregates holdings for the dashboard hero row.
type Summary struct {
	PortfolioID  uuid.UUID       `json:"portfolioId"`
	Invested     decimal.Decimal `json:"invested"`
	CurrentValue decimal.Decimal `json:"currentValue"`
	PnL          decimal.Decimal `json:"pnl"`
	PnLPercent   decimal.Decimal `json:"pnlPercent"`
	DayChange    decimal.Decimal `json:"dayChange"`
	HoldingCount int             `json:"holdingCount"`
}

func (s *Service) Summary(ctx context.Context, portfolioID uuid.UUID) (*Summary, error) {
	views, err := s.EnrichedHoldings(ctx, portfolioID)
	if err != nil {
		return nil, err
	}
	sum := &Summary{PortfolioID: portfolioID, HoldingCount: len(views)}
	for _, v := range views {
		sum.Invested = sum.Invested.Add(v.Invested)
		sum.CurrentValue = sum.CurrentValue.Add(v.CurrentValue)
		// weighted day change
		sum.DayChange = sum.DayChange.Add(v.CurrentValue.Mul(v.DayChangePct).Div(decimal.NewFromInt(100)))
	}
	sum.PnL = sum.CurrentValue.Sub(sum.Invested)
	if !sum.Invested.IsZero() {
		sum.PnLPercent = sum.PnL.Div(sum.Invested).Mul(decimal.NewFromInt(100))
	}
	return sum, nil
}
