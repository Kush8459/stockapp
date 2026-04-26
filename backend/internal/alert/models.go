package alert

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Direction string

const (
	DirAbove Direction = "above"
	DirBelow Direction = "below"
)

type Alert struct {
	ID          uuid.UUID       `json:"id"`
	UserID      uuid.UUID       `json:"userId"`
	Ticker      string          `json:"ticker"`
	TargetPrice decimal.Decimal `json:"targetPrice"`
	Direction   Direction       `json:"direction"`
	Triggered   bool            `json:"triggered"`
	TriggeredAt *time.Time      `json:"triggeredAt,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// TriggeredEvent is the payload pushed over the WebSocket when an alert fires.
type TriggeredEvent struct {
	AlertID     uuid.UUID       `json:"alertId"`
	UserID      uuid.UUID       `json:"userId"`
	Ticker      string          `json:"ticker"`
	Direction   Direction       `json:"direction"`
	TargetPrice decimal.Decimal `json:"targetPrice"`
	Price       decimal.Decimal `json:"price"`
	TriggeredAt time.Time       `json:"triggeredAt"`
}
