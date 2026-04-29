package portfolio

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/price"
)

// Service owns portfolio business logic (as distinct from raw persistence).
type Service struct {
	repo   *Repo
	prices *price.Cache
	// rdb is the Redis client used by the time-series builder to fetch
	// historical candles for portfolio replay. Nil-tolerant: if not wired,
	// the time-series falls back to avg-buy prices for unknown tickers.
	rdb *redis.Client
}

func NewService(db *pgxpool.Pool, prices *price.Cache, rdb *redis.Client) *Service {
	return &Service{repo: NewRepo(db), prices: prices, rdb: rdb}
}

// CreateDefault satisfies user.portfolioCreator.
func (s *Service) CreateDefault(ctx context.Context, userID uuid.UUID, name string) error {
	_, err := s.repo.Create(ctx, userID, name, "INR")
	return err
}

// Create makes a new named portfolio for the user (called from the UI's
// "+ New portfolio" affordance). Currency is locked to INR for this build.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, name string) (*Portfolio, error) {
	return s.repo.Create(ctx, userID, name, "INR")
}

// Rename changes the portfolio's display name.
func (s *Service) Rename(ctx context.Context, userID, id uuid.UUID, name string) (*Portfolio, error) {
	return s.repo.Rename(ctx, userID, id, name)
}

// Delete removes a portfolio. Refuses if it would leave the user with zero
// portfolios (we always keep at least one) or if any transactions still
// point at it. SIPs and holdings cascade via FK.
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	count, err := s.repo.CountByUser(ctx, userID)
	if err != nil {
		return err
	}
	if count <= 1 {
		return ErrPortfolioBusy
	}
	return s.repo.Delete(ctx, userID, id)
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
