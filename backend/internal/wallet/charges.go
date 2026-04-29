package wallet

import (
	"github.com/shopspring/decimal"
)

// Charges captures the breakdown of fees applied to a single trade. Real
// brokers itemise these on the contract note; we mirror that so users
// understand why net proceeds differ from the gross trade value.
type Charges struct {
	Brokerage decimal.Decimal `json:"brokerage"`
	Statutory decimal.Decimal `json:"statutory"`
	// Total = brokerage + statutory. Surfaced separately so the UI doesn't
	// have to add fields the backend already computed.
	Total decimal.Decimal `json:"total"`
}

// ComputeCharges returns the brokerage + statutory charges for a trade.
//
// Model approximates Zerodha/Groww direct equity (delivery) and Direct-Plan
// MFs. The numbers won't match any one broker rupee-for-rupee, but the
// shape is realistic — brokerage capped at ₹20, MFs free, statutory roughly
// proportional to turnover.
//
// For stocks (delivery):
//   - Brokerage:        min(0.1% × turnover, ₹20)  (per leg)
//   - Statutory bundle: 0.1%  on sell-side  (~STT-equivalent)
//                       0.015% on buy-side  (~stamp duty)
//                       + GST 18% on brokerage on both legs
// For mutual funds (Direct plans):
//   - Brokerage:  ₹0
//   - Statutory:  ₹0  (we don't model exit load — AMFI feed doesn't expose it)
func ComputeCharges(assetType string, side string, qty, price decimal.Decimal) Charges {
	turnover := qty.Mul(price)
	if turnover.Sign() <= 0 {
		return Charges{}
	}

	switch assetType {
	case "mf":
		return Charges{}
	default:
		// Brokerage: 0.1% of turnover, capped at ₹20.
		brokerage := turnover.Mul(decimal.NewFromFloat(0.001))
		if cap := decimal.NewFromInt(20); brokerage.Cmp(cap) > 0 {
			brokerage = cap
		}
		// GST 18% on brokerage.
		gst := brokerage.Mul(decimal.NewFromFloat(0.18))

		// Sell side carries STT-like charge (0.1%); buy side carries
		// stamp-duty-like charge (0.015%).
		var stat decimal.Decimal
		if side == "sell" {
			stat = turnover.Mul(decimal.NewFromFloat(0.001))
		} else {
			stat = turnover.Mul(decimal.NewFromFloat(0.00015))
		}

		statutory := stat.Add(gst).Round(2)
		brokerage = brokerage.Round(2)
		return Charges{
			Brokerage: brokerage,
			Statutory: statutory,
			Total:     brokerage.Add(statutory),
		}
	}
}

// NetAmount returns the cash that hits the wallet for this trade.
//
//	buy:  qty*price + brokerage + statutory   (debit)
//	sell: qty*price − brokerage − statutory   (credit)
func NetAmount(side string, qty, price decimal.Decimal, c Charges) decimal.Decimal {
	gross := qty.Mul(price)
	if side == "sell" {
		net := gross.Sub(c.Total)
		if net.Sign() < 0 {
			return decimal.Zero
		}
		return net.Round(2)
	}
	return gross.Add(c.Total).Round(2)
}
