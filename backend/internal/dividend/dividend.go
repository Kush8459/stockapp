// Package dividend tracks dividend / interest receipts. Indian retail
// investors care a lot about dividend income (high-yield names like ITC,
// ONGC, Coal India). Without logging them, total returns are understated.
//
// Entries are user-supplied for now — Indian dividend feeds aren't free
// or stable. The UI prefills shares from the user's holding at the
// payment date; users just need to type in the amount + date.
package dividend

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/price"
)

// Dividend is one logged receipt.
type Dividend struct {
	ID           uuid.UUID        `json:"id"`
	PortfolioID  *uuid.UUID       `json:"portfolioId,omitempty"`
	Ticker       string           `json:"ticker"`
	AssetType    string           `json:"assetType"`
	PerShare     decimal.Decimal  `json:"perShare"`
	Shares       decimal.Decimal  `json:"shares"`
	Amount       decimal.Decimal  `json:"amount"`
	TDS          decimal.Decimal  `json:"tds"`
	NetAmount    decimal.Decimal  `json:"netAmount"`
	PaymentDate  time.Time        `json:"paymentDate"`
	ExDate       *time.Time       `json:"exDate,omitempty"`
	Note         *string          `json:"note,omitempty"`
	CreatedAt    time.Time        `json:"createdAt"`
}

// Summary is the dashboard's aggregate view.
type Summary struct {
	YearToDate     decimal.Decimal `json:"yearToDate"`     // since Jan 1 calendar year
	FinancialYear  decimal.Decimal `json:"financialYear"`  // since Apr 1 IST
	AllTime        decimal.Decimal `json:"allTime"`
	Count          int             `json:"count"`
	ByTicker       []TickerTotal   `json:"byTicker"`
	FYLabel        string          `json:"fyLabel"` // e.g. "FY2026-27"
}

type TickerTotal struct {
	Ticker    string          `json:"ticker"`
	Total     decimal.Decimal `json:"total"`
	NetTotal  decimal.Decimal `json:"netTotal"`
	Count     int             `json:"count"`
	LastPaid  time.Time       `json:"lastPaid"`
}

type Repo struct{ db *pgxpool.Pool }

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

// List returns the user's dividends, optionally filtered by ticker.
// Most-recent first.
func (r *Repo) List(ctx context.Context, userID uuid.UUID, ticker string) ([]Dividend, error) {
	q := `SELECT id, portfolio_id, ticker, asset_type, per_share, shares,
	             amount, tds, net_amount, payment_date, ex_date, note, created_at
	      FROM dividends
	      WHERE user_id = $1`
	args := []any{userID}
	if ticker != "" {
		q += " AND ticker = $2"
		args = append(args, strings.ToUpper(strings.TrimSpace(ticker)))
	}
	q += " ORDER BY payment_date DESC, created_at DESC"

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dividend{}
	for rows.Next() {
		var d Dividend
		if err := rows.Scan(
			&d.ID, &d.PortfolioID, &d.Ticker, &d.AssetType,
			&d.PerShare, &d.Shares, &d.Amount, &d.TDS, &d.NetAmount,
			&d.PaymentDate, &d.ExDate, &d.Note, &d.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

type CreateInput struct {
	PortfolioID  *uuid.UUID
	Ticker       string
	AssetType    string
	PerShare     decimal.Decimal
	Shares       decimal.Decimal
	Amount       decimal.Decimal
	TDS          decimal.Decimal
	PaymentDate  time.Time
	ExDate       *time.Time
	Note         *string
}

// Create inserts a dividend. If amount is zero/missing it derives from
// per_share × shares; same in reverse for per_share. At least one of
// (amount, per_share) must be set, plus a valid shares.
func (r *Repo) Create(ctx context.Context, userID uuid.UUID, in CreateInput) (Dividend, error) {
	in.Ticker = strings.ToUpper(strings.TrimSpace(in.Ticker))
	if in.Ticker == "" {
		return Dividend{}, errors.New("ticker required")
	}
	if in.AssetType == "" {
		in.AssetType = "stock"
	}
	if in.Shares.Sign() <= 0 {
		return Dividend{}, errors.New("shares must be > 0")
	}
	if in.Amount.Sign() == 0 && in.PerShare.Sign() > 0 {
		in.Amount = in.PerShare.Mul(in.Shares)
	}
	if in.PerShare.Sign() == 0 && in.Amount.Sign() > 0 {
		in.PerShare = in.Amount.Div(in.Shares)
	}
	if in.Amount.Sign() <= 0 {
		return Dividend{}, errors.New("amount must be > 0")
	}
	if in.PaymentDate.IsZero() {
		in.PaymentDate = time.Now().UTC()
	}

	var d Dividend
	err := r.db.QueryRow(ctx, `
		INSERT INTO dividends
		  (user_id, portfolio_id, ticker, asset_type,
		   per_share, shares, amount, tds, payment_date, ex_date, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id, portfolio_id, ticker, asset_type, per_share, shares,
		          amount, tds, net_amount, payment_date, ex_date, note, created_at`,
		userID, in.PortfolioID, in.Ticker, in.AssetType,
		in.PerShare, in.Shares, in.Amount, in.TDS, in.PaymentDate, in.ExDate, in.Note,
	).Scan(
		&d.ID, &d.PortfolioID, &d.Ticker, &d.AssetType,
		&d.PerShare, &d.Shares, &d.Amount, &d.TDS, &d.NetAmount,
		&d.PaymentDate, &d.ExDate, &d.Note, &d.CreatedAt,
	)
	return d, err
}

// sharesOnDate returns net shares (buys − sells) the user held for a
// ticker as of `at`. Used to compute dividend amounts for auto-suggestions.
func (r *Repo) sharesOnDate(ctx context.Context, userID uuid.UUID, ticker string, at time.Time) (decimal.Decimal, error) {
	var qty decimal.Decimal
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(
		  SUM(CASE WHEN side = 'buy'  THEN quantity ELSE 0 END) -
		  SUM(CASE WHEN side = 'sell' THEN quantity ELSE 0 END),
		  0)
		FROM transactions
		WHERE user_id = $1 AND ticker = $2 AND executed_at <= $3`,
		userID, strings.ToUpper(strings.TrimSpace(ticker)), at,
	).Scan(&qty)
	return qty, err
}

// hasNearbyDividend checks for an existing dividend log within ±7 days of
// the given ex-date. Used to mark Yahoo-sourced suggestions that the user
// has already manually entered.
func (r *Repo) hasNearbyDividend(ctx context.Context, userID uuid.UUID, ticker string, exDate time.Time) (bool, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM dividends
		WHERE user_id = $1 AND ticker = $2
		  AND payment_date BETWEEN ($3::date - INTERVAL '7 days')
		                       AND ($3::date + INTERVAL '14 days')`,
		userID, strings.ToUpper(strings.TrimSpace(ticker)), exDate,
	).Scan(&count)
	return count > 0, err
}

func (r *Repo) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM dividends WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	return nil
}

// Summary aggregates the user's dividends into the dashboard's "income"
// tile. Indian FY runs Apr 1 → Mar 31 IST.
func (r *Repo) Summary(ctx context.Context, userID uuid.UUID) (Summary, error) {
	now := time.Now().In(istLocation())
	fyStart := financialYearStart(now)
	fyLabel := financialYearLabel(now)
	calYearStart := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)

	var s Summary
	s.FYLabel = fyLabel

	// Aggregates in one round trip.
	if err := r.db.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(net_amount) FILTER (WHERE payment_date >= $2), 0) AS ytd,
		  COALESCE(SUM(net_amount) FILTER (WHERE payment_date >= $3), 0) AS fy,
		  COALESCE(SUM(net_amount), 0) AS all_time,
		  COUNT(*) AS count
		FROM dividends
		WHERE user_id = $1`,
		userID, calYearStart, fyStart,
	).Scan(&s.YearToDate, &s.FinancialYear, &s.AllTime, &s.Count); err != nil {
		return s, err
	}

	// By-ticker breakdown (top 10 by net total).
	rows, err := r.db.Query(ctx, `
		SELECT ticker,
		       SUM(amount)     AS total,
		       SUM(net_amount) AS net_total,
		       COUNT(*)        AS count,
		       MAX(payment_date) AS last_paid
		FROM dividends
		WHERE user_id = $1
		GROUP BY ticker
		ORDER BY net_total DESC
		LIMIT 25`, userID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var t TickerTotal
		if err := rows.Scan(&t.Ticker, &t.Total, &t.NetTotal, &t.Count, &t.LastPaid); err != nil {
			return s, err
		}
		s.ByTicker = append(s.ByTicker, t)
	}
	return s, rows.Err()
}

func istLocation() *time.Location {
	if loc, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return loc
	}
	return time.FixedZone("IST", 5*3600+30*60)
}

func financialYearStart(t time.Time) time.Time {
	t = t.In(istLocation())
	year := t.Year()
	if t.Month() < time.April {
		year--
	}
	return time.Date(year, time.April, 1, 0, 0, 0, 0, istLocation())
}

func financialYearLabel(t time.Time) string {
	y := t.In(istLocation()).Year()
	if t.In(istLocation()).Month() < time.April {
		y--
	}
	return time_FYLabel(y)
}

func time_FYLabel(y int) string {
	// "FY2026-27"
	return formatFY(y)
}

func formatFY(y int) string {
	return "FY" + intToStr(y) + "-" + zPad2(intToStr((y+1)%100))
}

// tiny helpers — avoid importing strconv.Itoa for one usage
func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func zPad2(s string) string {
	if len(s) >= 2 {
		return s
	}
	return "0" + s
}

// ── HTTP ─────────────────────────────────────────────────────────────────

type Handler struct{ repo *Repo }

func NewHandler(repo *Repo) *Handler { return &Handler{repo: repo} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/dividends", h.list)
	r.Post("/dividends", h.create)
	r.Delete("/dividends/{id}", h.delete)
	r.Get("/dividends/summary", h.summary)
	r.Get("/dividends/suggested", h.suggested)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	ticker := r.URL.Query().Get("ticker")
	out, err := h.repo.List(r.Context(), userID, ticker)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

type createReq struct {
	PortfolioID *uuid.UUID `json:"portfolioId,omitempty"`
	Ticker      string     `json:"ticker"`
	AssetType   string     `json:"assetType,omitempty"`
	PerShare    string     `json:"perShare,omitempty"`
	Shares      string     `json:"shares"`
	Amount      string     `json:"amount,omitempty"`
	TDS         string     `json:"tds,omitempty"`
	PaymentDate string     `json:"paymentDate"`
	ExDate      string     `json:"exDate,omitempty"`
	Note        *string    `json:"note,omitempty"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	var in createReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	per, _ := decimal.NewFromString(in.PerShare)
	shares, err := decimal.NewFromString(in.Shares)
	if err != nil {
		httpx.Error(w, r, errors.New("shares must be a number"))
		return
	}
	amount, _ := decimal.NewFromString(in.Amount)
	tds, _ := decimal.NewFromString(in.TDS)
	pay, err := time.Parse("2006-01-02", in.PaymentDate)
	if err != nil {
		httpx.Error(w, r, errors.New("paymentDate must be YYYY-MM-DD"))
		return
	}
	var ex *time.Time
	if in.ExDate != "" {
		if t, err := time.Parse("2006-01-02", in.ExDate); err == nil {
			ex = &t
		}
	}
	out, err := h.repo.Create(r.Context(), userID, CreateInput{
		PortfolioID: in.PortfolioID,
		Ticker:      in.Ticker,
		AssetType:   in.AssetType,
		PerShare:    per,
		Shares:      shares,
		Amount:      amount,
		TDS:         tds,
		PaymentDate: pay,
		ExDate:      ex,
		Note:        in.Note,
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, out)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	if err := h.repo.Delete(r.Context(), userID, id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	out, err := h.repo.Summary(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

// Suggestion is one auto-detected dividend the user could log.
type Suggestion struct {
	Ticker        string          `json:"ticker"`
	ExDate        time.Time       `json:"exDate"`
	PerShare      decimal.Decimal `json:"perShare"`
	SharesOnDate  decimal.Decimal `json:"sharesOnDate"`
	Amount        decimal.Decimal `json:"amount"`
	AlreadyLogged bool            `json:"alreadyLogged"`
}

// suggested returns Yahoo-sourced past dividends for a ticker, decorated
// with the shares the user owned on each ex-date and whether they've
// already logged that payment.
func (h *Handler) suggested(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	ticker := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("ticker")))
	if ticker == "" {
		httpx.Error(w, r, errors.New("ticker required"))
		return
	}

	events, err := price.DividendsYahoo(r.Context(), ticker, 5)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := []Suggestion{}
	for _, ev := range events {
		shares, err := h.repo.sharesOnDate(r.Context(), userID, ticker, ev.ExDate)
		if err != nil {
			continue
		}
		if shares.Sign() <= 0 {
			continue
		}
		per := decimal.NewFromFloat(ev.PerShare)
		amt := per.Mul(shares).Round(2)
		alreadyLogged, _ := h.repo.hasNearbyDividend(r.Context(), userID, ticker, ev.ExDate)
		out = append(out, Suggestion{
			Ticker:        ticker,
			ExDate:        ev.ExDate,
			PerShare:      per,
			SharesOnDate:  shares,
			Amount:        amt,
			AlreadyLogged: alreadyLogged,
		})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}
