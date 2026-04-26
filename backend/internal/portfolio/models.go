package portfolio

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Portfolio struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"userId"`
	Name      string    `json:"name"`
	BaseCCY   string    `json:"baseCcy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Holding struct {
	ID           uuid.UUID       `json:"id"`
	PortfolioID  uuid.UUID       `json:"portfolioId"`
	Ticker       string          `json:"ticker"`
	AssetType    string          `json:"assetType"`
	Quantity     decimal.Decimal `json:"quantity"`
	AvgBuyPrice  decimal.Decimal `json:"avgBuyPrice"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// HoldingView is the holdings listing enriched with live price + P&L.
type HoldingView struct {
	Holding
	CurrentPrice decimal.Decimal `json:"currentPrice"`
	CurrentValue decimal.Decimal `json:"currentValue"`
	Invested     decimal.Decimal `json:"invested"`
	PnL          decimal.Decimal `json:"pnl"`
	PnLPercent   decimal.Decimal `json:"pnlPercent"`
	DayChangePct decimal.Decimal `json:"dayChangePct"`
}
