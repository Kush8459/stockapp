package goal

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Goal is a saved target — name + amount + deadline + linked portfolio.
type Goal struct {
	ID           uuid.UUID       `json:"id"`
	UserID       uuid.UUID       `json:"userId"`
	PortfolioID  uuid.UUID       `json:"portfolioId"`
	Name         string          `json:"name"`
	TargetAmount decimal.Decimal `json:"targetAmount"`
	TargetDate   time.Time       `json:"targetDate"`
	Bucket       *string         `json:"bucket,omitempty"`
	Note         *string         `json:"note,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}
