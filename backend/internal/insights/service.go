package insights

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/pnl"
	"github.com/stockapp/backend/internal/portfolio"
)

// Service is the entry point other packages call — it knows how to gather a
// user's portfolio snapshot and turn it into an AI-generated review.
//
// Failover model: the primary model is tried first with its own retry loop;
// if it still fails transiently (503 / 429 / 5xx), the service falls back to
// the fallback model before surfacing an error. This matters because
// gemini-2.5-flash is frequently rate-limited or overloaded on free tier,
// while gemini-2.0-flash has dramatically better free-tier availability.
type Service struct {
	db       *pgxpool.Pool
	rdb      *redis.Client
	primary  *geminiClient
	fallback *geminiClient // may be nil if same-as-primary or unset
	portSvc  *portfolio.Service
	pnlSvc   *pnl.Service
	ttl      time.Duration
}

func NewService(
	apiKey, model, fallbackModel string,
	db *pgxpool.Pool,
	rdb *redis.Client,
	portSvc *portfolio.Service,
	pnlSvc *pnl.Service,
) *Service {
	if model == "" {
		model = "gemini-2.5-flash"
	}
	svc := &Service{
		db:      db,
		rdb:     rdb,
		portSvc: portSvc,
		pnlSvc:  pnlSvc,
		ttl:     30 * time.Minute,
	}
	if apiKey != "" {
		svc.primary = newGeminiClient(apiKey, model)
		if fallbackModel != "" && fallbackModel != model {
			svc.fallback = newGeminiClient(apiKey, fallbackModel)
		}
	}
	return svc
}

// Enabled reports whether the service will actually call the model.
func (s *Service) Enabled() bool { return s.primary != nil }

func cacheKey(userID uuid.UUID) string { return "insights:" + userID.String() }

// Get returns the cached insight for the user, or generates one if missing
// / forceFresh is true. The bool indicates cache hit.
func (s *Service) Get(ctx context.Context, userID uuid.UUID, forceFresh bool) (*Insight, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}

	if !forceFresh {
		if raw, err := s.rdb.Get(ctx, cacheKey(userID)).Bytes(); err == nil {
			var cached Insight
			if err := json.Unmarshal(raw, &cached); err == nil {
				cached.Cached = true
				return &cached, nil
			}
		}
	}

	snap, err := s.buildSnapshot(ctx, userID)
	if err != nil {
		return nil, err
	}
	snapJSON, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return nil, err
	}

	userPrompt := "Here is the user's current portfolio:\n\n" + string(snapJSON)

	// Try the primary model first. If it fails with a transient/upstream
	// error (503, 429, 5xx) and a fallback is configured, retry the whole
	// request against the fallback. Non-transient errors (schema, auth,
	// safety block) short-circuit to the caller.
	raw, usedModel, err := s.generateWithFallback(ctx, userPrompt)
	if err != nil {
		return nil, err
	}

	var out Insight
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		log.Warn().Str("raw", raw).Err(err).Msg("insights: decode gemini json")
		return nil, fmt.Errorf("%w: decode json: %v", ErrUpstream, err)
	}
	out.GeneratedAt = time.Now().UTC()
	out.Model = usedModel
	out.Cached = false
	out.Input = InputSummary{
		Holdings:     len(snap.Holdings),
		Transactions: len(snap.RecentTransactions),
		SIPs:         len(snap.ActiveSIPs),
	}

	if b, err := json.Marshal(out); err == nil {
		_ = s.rdb.Set(ctx, cacheKey(userID), b, s.ttl).Err()
	}
	return &out, nil
}

// generateWithFallback tries the primary model first, then the fallback
// model if the primary error was transient/upstream. Returns the JSON text,
// the model ID that actually produced it, and any error.
func (s *Service) generateWithFallback(ctx context.Context, userPrompt string) (string, string, error) {
	text, err := s.primary.generate(ctx, systemPrompt, userPrompt, responseSchema)
	if err == nil {
		return text, s.primary.model, nil
	}
	// Only fall back on upstream-flavoured errors. Safety blocks, decode
	// errors, or bad-schema errors should fail immediately — retrying them
	// against a different model is just a waste of tokens and quota.
	if s.fallback == nil || !errors.Is(err, ErrUpstream) {
		return "", "", err
	}
	log.Warn().
		Err(err).
		Str("primary", s.primary.model).
		Str("fallback", s.fallback.model).
		Msg("insights: primary model failed, falling back")
	text, fbErr := s.fallback.generate(ctx, systemPrompt, userPrompt, responseSchema)
	if fbErr != nil {
		return "", "", fbErr
	}
	return text, s.fallback.model, nil
}

// --- portfolio snapshot -----------------------------------------------------

type holdingSnap struct {
	Ticker       string  `json:"ticker"`
	AssetType    string  `json:"assetType"`
	Quantity     string  `json:"quantity"`
	AvgBuyPrice  string  `json:"avgBuyPrice"`
	CurrentPrice string  `json:"currentPrice"`
	Invested     string  `json:"invested"`
	CurrentValue string  `json:"currentValue"`
	PnL          string  `json:"pnl"`
	PnLPercent   string  `json:"pnlPercent"`
	AllocPercent float64 `json:"allocPercent"`
}

type txnSnap struct {
	Ticker     string `json:"ticker"`
	Side       string `json:"side"`
	Quantity   string `json:"quantity"`
	Price      string `json:"price"`
	Total      string `json:"total"`
	Source     string `json:"source"`
	ExecutedAt string `json:"executedAt"`
}

type sipSnap struct {
	Ticker    string `json:"ticker"`
	AssetType string `json:"assetType"`
	Amount    string `json:"amount"`
	Frequency string `json:"frequency"`
	Status    string `json:"status"`
}

type portfolioSnap struct {
	AsOf             time.Time     `json:"asOf"`
	PortfolioName    string        `json:"portfolioName"`
	BaseCurrency     string        `json:"baseCurrency"`
	TotalInvested    string        `json:"totalInvested"`
	TotalValue       string        `json:"totalValue"`
	TotalPnL         string        `json:"totalPnL"`
	TotalPnLPercent  string        `json:"totalPnLPercent"`
	DayChangeValue   string        `json:"dayChangeValue"`
	HoldingsCount    int           `json:"holdingsCount"`
	XIRR             *float64      `json:"xirrAnnualized,omitempty"`
	AssetAllocation  map[string]string `json:"assetAllocationPercent"`
	Holdings         []holdingSnap `json:"holdings"`
	RecentTransactions []txnSnap   `json:"recentTransactions"`
	ActiveSIPs       []sipSnap     `json:"activeSips"`
}

// buildSnapshot pulls everything the model needs into one JSON-friendly struct.
// Kept deliberately small — ~2KB of context is enough for a solid review and
// keeps latency + token cost down.
func (s *Service) buildSnapshot(ctx context.Context, userID uuid.UUID) (*portfolioSnap, error) {
	// First portfolio for this user (demo-world assumption: one per user).
	portfolios, err := s.portSvc.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(portfolios) == 0 {
		return &portfolioSnap{AsOf: time.Now().UTC(), Holdings: []holdingSnap{}}, nil
	}
	p := portfolios[0]

	views, err := s.portSvc.EnrichedHoldings(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	summary, err := s.portSvc.Summary(ctx, p.ID)
	if err != nil {
		return nil, err
	}

	snap := &portfolioSnap{
		AsOf:              time.Now().UTC(),
		PortfolioName:     p.Name,
		BaseCurrency:      p.BaseCCY,
		TotalInvested:     summary.Invested.StringFixed(2),
		TotalValue:        summary.CurrentValue.StringFixed(2),
		TotalPnL:          summary.PnL.StringFixed(2),
		TotalPnLPercent:   summary.PnLPercent.StringFixed(2),
		DayChangeValue:    summary.DayChange.StringFixed(2),
		HoldingsCount:     summary.HoldingCount,
		Holdings:          make([]holdingSnap, 0, len(views)),
		AssetAllocation:   map[string]string{},
		RecentTransactions: []txnSnap{},
		ActiveSIPs:        []sipSnap{},
	}

	// XIRR (may legitimately be absent for new portfolios).
	if res, err := s.pnlSvc.PortfolioXIRR(ctx, p.ID); err == nil {
		snap.XIRR = &res.Rate
	}

	totalValue, _ := summary.CurrentValue.Float64()
	byAsset := map[string]decimal.Decimal{}
	for _, v := range views {
		allocPct := 0.0
		if totalValue > 0 {
			valF, _ := v.CurrentValue.Float64()
			allocPct = valF / totalValue * 100
		}
		snap.Holdings = append(snap.Holdings, holdingSnap{
			Ticker:       v.Ticker,
			AssetType:    v.AssetType,
			Quantity:     v.Quantity.StringFixed(4),
			AvgBuyPrice:  v.AvgBuyPrice.StringFixed(2),
			CurrentPrice: v.CurrentPrice.StringFixed(2),
			Invested:     v.Invested.StringFixed(2),
			CurrentValue: v.CurrentValue.StringFixed(2),
			PnL:          v.PnL.StringFixed(2),
			PnLPercent:   v.PnLPercent.StringFixed(2),
			AllocPercent: round2(allocPct),
		})
		byAsset[v.AssetType] = byAsset[v.AssetType].Add(v.CurrentValue)
	}
	// Sort holdings by allocation desc for a readable prompt.
	sort.Slice(snap.Holdings, func(i, j int) bool {
		return snap.Holdings[i].AllocPercent > snap.Holdings[j].AllocPercent
	})

	if totalValue > 0 {
		for k, v := range byAsset {
			vF, _ := v.Float64()
			snap.AssetAllocation[k] = fmt.Sprintf("%.2f", vF/totalValue*100)
		}
	}

	// Recent transactions (up to 10 most recent).
	if err := s.fillRecentTransactions(ctx, p.ID, snap); err != nil {
		log.Warn().Err(err).Msg("insights: recent transactions load")
	}
	// Active SIPs.
	if err := s.fillActiveSIPs(ctx, userID, snap); err != nil {
		log.Warn().Err(err).Msg("insights: sip load")
	}

	return snap, nil
}

func (s *Service) fillRecentTransactions(ctx context.Context, portfolioID uuid.UUID, out *portfolioSnap) error {
	rows, err := s.db.Query(ctx, `
		SELECT ticker, side, quantity, price, total_amount, source, executed_at
		FROM transactions
		WHERE portfolio_id = $1
		ORDER BY executed_at DESC
		LIMIT 10`, portfolioID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var t txnSnap
		var qty, price, total decimal.Decimal
		var executedAt time.Time
		if err := rows.Scan(&t.Ticker, &t.Side, &qty, &price, &total, &t.Source, &executedAt); err != nil {
			return err
		}
		t.Quantity = qty.StringFixed(4)
		t.Price = price.StringFixed(2)
		t.Total = total.StringFixed(2)
		t.ExecutedAt = executedAt.UTC().Format(time.RFC3339)
		out.RecentTransactions = append(out.RecentTransactions, t)
	}
	return rows.Err()
}

func (s *Service) fillActiveSIPs(ctx context.Context, userID uuid.UUID, out *portfolioSnap) error {
	rows, err := s.db.Query(ctx, `
		SELECT ticker, asset_type, amount, frequency, status
		FROM sip_plans
		WHERE user_id = $1 AND status = 'active'
		ORDER BY created_at`, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var s sipSnap
		var amt decimal.Decimal
		if err := rows.Scan(&s.Ticker, &s.AssetType, &amt, &s.Frequency, &s.Status); err != nil {
			return err
		}
		s.Amount = amt.StringFixed(2)
		out.ActiveSIPs = append(out.ActiveSIPs, s)
	}
	return rows.Err()
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
