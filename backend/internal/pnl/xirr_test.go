package pnl

import (
	"math"
	"testing"
	"time"
)

func TestXIRR_KnownExamples(t *testing.T) {
	cases := []struct {
		name  string
		flows []CashFlow
		want  float64
	}{
		{
			// 100 in, 110 out one year later -> 10%.
			name: "10% over one year",
			flows: []CashFlow{
				{When: mustDate("2024-01-01"), Amount: -100},
				{When: mustDate("2025-01-01"), Amount: 110},
			},
			want: 0.10,
		},
		{
			// Two contributions with a terminal value. 1000 held ~1y and 500
			// held ~0.5y earn a combined 150 — roughly 12% time-weighted.
			name: "two contributions",
			flows: []CashFlow{
				{When: mustDate("2024-01-01"), Amount: -1000},
				{When: mustDate("2024-07-01"), Amount: -500},
				{When: mustDate("2025-01-01"), Amount: 1650},
			},
			want: 0.1202,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := XIRR(c.flows)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if math.Abs(got-c.want) > 0.01 {
				t.Fatalf("XIRR = %.4f, want ~%.4f", got, c.want)
			}
		})
	}
}

func TestXIRR_RejectsBadInput(t *testing.T) {
	_, err := XIRR([]CashFlow{{When: mustDate("2024-01-01"), Amount: -100}})
	if err == nil {
		t.Fatal("expected error for single cashflow")
	}

	_, err = XIRR([]CashFlow{
		{When: mustDate("2024-01-01"), Amount: -100},
		{When: mustDate("2025-01-01"), Amount: -200},
	})
	if err == nil {
		t.Fatal("expected error for flows with no positive amount")
	}
}

func mustDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}
