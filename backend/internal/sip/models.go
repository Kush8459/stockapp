package sip

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Frequency string

const (
	FreqDaily   Frequency = "daily"
	FreqWeekly  Frequency = "weekly"
	FreqMonthly Frequency = "monthly"
)

type Status string

const (
	StatusActive    Status = "active"
	StatusPaused    Status = "paused"
	StatusCancelled Status = "cancelled"
)

type Plan struct {
	ID          uuid.UUID       `json:"id"`
	UserID      uuid.UUID       `json:"userId"`
	PortfolioID uuid.UUID       `json:"portfolioId"`
	Ticker      string          `json:"ticker"`
	AssetType   string          `json:"assetType"`
	Amount      decimal.Decimal `json:"amount"`
	Frequency   Frequency       `json:"frequency"`
	NextRunAt   time.Time       `json:"nextRunAt"`
	Status      Status          `json:"status"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// Advance returns the next run time after one period of the given frequency.
func Advance(t time.Time, f Frequency) time.Time {
	switch f {
	case FreqDaily:
		return t.AddDate(0, 0, 1)
	case FreqWeekly:
		return t.AddDate(0, 0, 7)
	case FreqMonthly:
		return t.AddDate(0, 1, 0)
	}
	return t
}
