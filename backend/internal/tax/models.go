package tax

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Term distinguishes short-term from long-term for capital-gains tax.
type Term string

const (
	TermShort Term = "short"
	TermLong  Term = "long"
)

// Category keys the tax rate that applies. India post-Jul-2024:
//   - stcg_equity: 20% on short-term equity/equity-MF gains
//   - ltcg_equity: 12.5% on long-term equity/equity-MF gains above ₹1.25L/year exemption
type Category string

const (
	CategorySTCGEquity Category = "stcg_equity"
	CategoryLTCGEquity Category = "ltcg_equity"
)

// Realization is a single FIFO-matched sell slice: some quantity of a
// position sold at a price, matched against the buy it originally came from.
// A single sell transaction can produce multiple realizations if it drains
// more than one buy lot.
type Realization struct {
	Ticker             string          `json:"ticker"`
	AssetType          string          `json:"assetType"`
	Quantity           decimal.Decimal `json:"quantity"`
	BuyDate            time.Time       `json:"buyDate"`
	BuyPrice           decimal.Decimal `json:"buyPrice"`
	SellDate           time.Time       `json:"sellDate"`
	SellPrice          decimal.Decimal `json:"sellPrice"`
	HoldingDays        int             `json:"holdingDays"`
	Proceeds           decimal.Decimal `json:"proceeds"`    // sellPrice * qty
	CostBasis          decimal.Decimal `json:"costBasis"`   // buyPrice * qty
	Gain               decimal.Decimal `json:"gain"`        // proceeds - costBasis (can be negative)
	Term               Term            `json:"term"`
	Category           Category        `json:"category"`
	SellTransactionID  uuid.UUID       `json:"sellTransactionId"`
}

// YearSummary aggregates all realizations inside an Indian financial year
// (Apr 1 – Mar 31) and precomputes the tax buckets.
type YearSummary struct {
	FinancialYear string    `json:"financialYear"` // "FY2024-25"
	StartDate     time.Time `json:"startDate"`
	EndDate       time.Time `json:"endDate"`

	// Equity STCG (held < 12 months): 20%
	STCGEquityGain decimal.Decimal `json:"stcgEquityGain"`
	STCGEquityTax  decimal.Decimal `json:"stcgEquityTax"`

	// Equity LTCG (held >= 12 months): 12.5% on gains above ₹1.25L exemption
	LTCGEquityGain    decimal.Decimal `json:"ltcgEquityGain"`
	LTCGExemptionUsed decimal.Decimal `json:"ltcgExemptionUsed"`
	LTCGTaxableGain   decimal.Decimal `json:"ltcgTaxableGain"`
	LTCGEquityTax     decimal.Decimal `json:"ltcgEquityTax"`

	TotalGain decimal.Decimal `json:"totalGain"`
	TotalTax      decimal.Decimal `json:"totalTax"`
	EffectiveRate decimal.Decimal `json:"effectiveRate"` // percent

	Realizations []Realization `json:"realizations"`
}

// Report is the top-level response.
type Report struct {
	GeneratedAt time.Time     `json:"generatedAt"`
	Currency    string        `json:"currency"`
	Years       []YearSummary `json:"years"`
	// Unrealized is a forward-looking view: if the user sold every open
	// position right now at the cached live price, what would the gain
	// + tax bucket look like? (Handy "should I trim LTCG this FY?" signal.)
	Unrealized Unrealized `json:"unrealized"`
	// Rates echoes the rate table we applied so the UI can caption them.
	Rates Rates `json:"rates"`
}

// Unrealized is the hypothetical "sell-everything-now" snapshot.
type Unrealized struct {
	STCGEquityGain decimal.Decimal `json:"stcgEquityGain"`
	LTCGEquityGain decimal.Decimal `json:"ltcgEquityGain"`
	TotalGain      decimal.Decimal `json:"totalGain"`
}

// Rates captures the constants we applied — makes UI captions trivially
// consistent with the computation.
type Rates struct {
	STCGEquityPct decimal.Decimal `json:"stcgEquityPct"` // e.g. 20
	LTCGEquityPct decimal.Decimal `json:"ltcgEquityPct"` // e.g. 12.5
	LTCGExemption decimal.Decimal `json:"ltcgExemption"` // e.g. 125000
	// LongTermHoldingDays is the cutoff used — 365 for equity/MF.
	LongTermHoldingDays int `json:"longTermHoldingDays"`
}
