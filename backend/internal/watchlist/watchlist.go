// Package watchlist exposes user watchlists — named, ordered groups of
// tickers a user is tracking but doesn't (necessarily) own. A user can
// have many lists; the star button on stock-detail puts a ticker into
// any subset of them.
package watchlist

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/stockapp/backend/internal/auth"
	"github.com/stockapp/backend/internal/httpx"
	"github.com/stockapp/backend/internal/price"
)

// Watchlist is one named list (e.g. "My Watchlist", "Tech Bets").
type Watchlist struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	SortOrder int64     `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	ItemCount int       `json:"itemCount"`
}

// Item is one ticker within a watchlist.
type Item struct {
	ID          uuid.UUID    `json:"id"`
	WatchlistID uuid.UUID    `json:"watchlistId"`
	Ticker      string       `json:"ticker"`
	AssetType   string       `json:"assetType"`
	SortOrder   int64        `json:"sortOrder"`
	CreatedAt   time.Time    `json:"createdAt"`
	Quote       *price.Quote `json:"quote,omitempty"`
}

const defaultListName = "My Watchlist"

type Repo struct {
	db *pgxpool.Pool
}

func NewRepo(db *pgxpool.Pool) *Repo { return &Repo{db: db} }

// ── lists ────────────────────────────────────────────────────────────────

// EnsureDefaultList returns the user's first watchlist by sort_order,
// creating "My Watchlist" if they have none yet. Called by AddItem when
// the caller doesn't specify a list.
func (r *Repo) EnsureDefaultList(ctx context.Context, userID uuid.UUID) (Watchlist, error) {
	var wl Watchlist
	err := r.db.QueryRow(ctx, `
		SELECT id, name, sort_order, created_at, updated_at
		FROM watchlists
		WHERE user_id = $1
		ORDER BY sort_order ASC, created_at ASC
		LIMIT 1`, userID,
	).Scan(&wl.ID, &wl.Name, &wl.SortOrder, &wl.CreatedAt, &wl.UpdatedAt)
	if err == nil {
		return wl, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Watchlist{}, err
	}
	return r.CreateList(ctx, userID, defaultListName)
}

// CreateList inserts a new watchlist. Returns the row.
func (r *Repo) CreateList(ctx context.Context, userID uuid.UUID, name string) (Watchlist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Watchlist{}, errors.New("name required")
	}
	if len(name) > 100 {
		name = name[:100]
	}
	var wl Watchlist
	err := r.db.QueryRow(ctx, `
		INSERT INTO watchlists (user_id, name)
		VALUES ($1, $2)
		RETURNING id, name, sort_order, created_at, updated_at`,
		userID, name,
	).Scan(&wl.ID, &wl.Name, &wl.SortOrder, &wl.CreatedAt, &wl.UpdatedAt)
	return wl, err
}

// ListLists returns every watchlist for a user, sorted by sort_order, with
// item counts populated.
func (r *Repo) ListLists(ctx context.Context, userID uuid.UUID) ([]Watchlist, error) {
	rows, err := r.db.Query(ctx, `
		SELECT wl.id, wl.name, wl.sort_order, wl.created_at, wl.updated_at,
		       COUNT(w.id) AS item_count
		FROM watchlists wl
		LEFT JOIN watchlist w ON w.watchlist_id = wl.id
		WHERE wl.user_id = $1
		GROUP BY wl.id, wl.name, wl.sort_order, wl.created_at, wl.updated_at
		ORDER BY wl.sort_order ASC, wl.created_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Watchlist{}
	for rows.Next() {
		var wl Watchlist
		if err := rows.Scan(
			&wl.ID, &wl.Name, &wl.SortOrder, &wl.CreatedAt, &wl.UpdatedAt, &wl.ItemCount,
		); err != nil {
			return nil, err
		}
		out = append(out, wl)
	}
	return out, rows.Err()
}

// RenameList updates name on a list owned by the user. Errors on conflict.
func (r *Repo) RenameList(ctx context.Context, userID, listID uuid.UUID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("name required")
	}
	tag, err := r.db.Exec(ctx, `
		UPDATE watchlists SET name = $1
		WHERE id = $2 AND user_id = $3`,
		name, listID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	return nil
}

// DeleteList removes the list and its items (CASCADE).
func (r *Repo) DeleteList(ctx context.Context, userID, listID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM watchlists WHERE id = $1 AND user_id = $2`,
		listID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	return nil
}

// ── items ────────────────────────────────────────────────────────────────

// ListItems returns items in a list, after verifying the list belongs to
// the user.
func (r *Repo) ListItems(ctx context.Context, userID, listID uuid.UUID) ([]Item, error) {
	rows, err := r.db.Query(ctx, `
		SELECT w.id, w.watchlist_id, w.ticker, w.asset_type, w.sort_order, w.created_at
		FROM watchlist w
		JOIN watchlists wl ON wl.id = w.watchlist_id
		WHERE w.watchlist_id = $1 AND wl.user_id = $2
		ORDER BY w.sort_order ASC, w.created_at ASC`, listID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		var it Item
		if err := rows.Scan(
			&it.ID, &it.WatchlistID, &it.Ticker, &it.AssetType, &it.SortOrder, &it.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// AddItem upserts a ticker into a list. Verifies list ownership.
func (r *Repo) AddItem(ctx context.Context, userID, listID uuid.UUID, ticker, assetType string) (Item, error) {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if ticker == "" {
		return Item{}, errors.New("ticker required")
	}
	if assetType == "" {
		assetType = "stock"
	}
	// Verify list ownership.
	var ownerID uuid.UUID
	if err := r.db.QueryRow(ctx,
		`SELECT user_id FROM watchlists WHERE id = $1`, listID,
	).Scan(&ownerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Item{}, httpx.ErrNotFound
		}
		return Item{}, err
	}
	if ownerID != userID {
		return Item{}, httpx.ErrNotFound
	}
	var it Item
	err := r.db.QueryRow(ctx, `
		INSERT INTO watchlist (user_id, watchlist_id, ticker, asset_type)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (watchlist_id, ticker, asset_type) DO UPDATE
		  SET sort_order = watchlist.sort_order
		RETURNING id, watchlist_id, ticker, asset_type, sort_order, created_at`,
		userID, listID, ticker, assetType,
	).Scan(&it.ID, &it.WatchlistID, &it.Ticker, &it.AssetType, &it.SortOrder, &it.CreatedAt)
	return it, err
}

// RemoveItem deletes a ticker from a specific list.
func (r *Repo) RemoveItem(ctx context.Context, userID, listID uuid.UUID, ticker, assetType string) error {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	if assetType == "" {
		assetType = "stock"
	}
	_, err := r.db.Exec(ctx, `
		DELETE FROM watchlist w
		USING watchlists wl
		WHERE w.watchlist_id = wl.id
		  AND wl.id = $1
		  AND wl.user_id = $2
		  AND w.ticker = $3
		  AND w.asset_type = $4`,
		listID, userID, ticker, assetType)
	return err
}

// MembershipsForTicker returns the IDs of every list the user has placed
// this ticker on. Powers the popover "checked"-state on the star button.
func (r *Repo) MembershipsForTicker(ctx context.Context, userID uuid.UUID, ticker, assetType string) ([]uuid.UUID, error) {
	if assetType == "" {
		assetType = "stock"
	}
	rows, err := r.db.Query(ctx, `
		SELECT wl.id
		FROM watchlist w
		JOIN watchlists wl ON wl.id = w.watchlist_id
		WHERE wl.user_id = $1 AND w.ticker = $2 AND w.asset_type = $3`,
		userID, strings.ToUpper(strings.TrimSpace(ticker)), assetType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out, rows.Err()
}

// ── worker helpers ───────────────────────────────────────────────────────

// DistinctTickers returns every ticker on any user's any list — the price
// worker uses this to know what to subscribe to.
func DistinctTickers(ctx context.Context, db *pgxpool.Pool) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT ticker FROM watchlist`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err == nil {
			out = append(out, t)
		}
	}
	return out, rows.Err()
}

// ─── HTTP layer ──────────────────────────────────────────────────────────

type Handler struct {
	repo  *Repo
	cache *price.Cache
}

func NewHandler(repo *Repo, cache *price.Cache) *Handler {
	return &Handler{repo: repo, cache: cache}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/watchlists", h.listLists)
	r.Post("/watchlists", h.createList)
	r.Patch("/watchlists/{id}", h.renameList)
	r.Delete("/watchlists/{id}", h.deleteList)
	r.Get("/watchlists/{id}", h.getList)
	r.Post("/watchlists/{id}/items", h.addItem)
	r.Delete("/watchlists/{id}/items/{ticker}", h.removeItem)
	// Helper for the star button — given a ticker, what lists is it on?
	r.Get("/watchlists/memberships/{ticker}", h.memberships)
}

func (h *Handler) listLists(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	// Side-effect: ensure the user has at least one list. Keeps the UI's
	// "Add to watchlist" star functional on a fresh account.
	if _, err := h.repo.EnsureDefaultList(r.Context(), userID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	out, err := h.repo.ListLists(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

type createListReq struct {
	Name string `json:"name"`
}

func (h *Handler) createList(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	var in createListReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	wl, err := h.repo.CreateList(r.Context(), userID, in.Name)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, wl)
}

func (h *Handler) renameList(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	listID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	var in createListReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.repo.RenameList(r.Context(), userID, listID, in.Name); err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deleteList(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	listID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	if err := h.repo.DeleteList(r.Context(), userID, listID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) getList(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	listID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	items, err := h.repo.ListItems(r.Context(), userID, listID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if len(items) > 0 {
		tickers := make([]string, 0, len(items))
		for _, it := range items {
			tickers = append(tickers, it.Ticker)
		}
		quotes, _ := h.cache.GetMany(r.Context(), tickers)
		for i := range items {
			if q, ok := quotes[items[i].Ticker]; ok {
				qq := q
				items[i].Quote = &qq
			}
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

type addItemReq struct {
	Ticker    string `json:"ticker"`
	AssetType string `json:"assetType"`
}

func (h *Handler) addItem(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	listID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	var in addItemReq
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	it, err := h.repo.AddItem(r.Context(), userID, listID, in.Ticker, in.AssetType)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, it)
}

func (h *Handler) removeItem(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	listID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, httpx.ErrBadRequest)
		return
	}
	ticker := chi.URLParam(r, "ticker")
	assetType := r.URL.Query().Get("assetType")
	if err := h.repo.RemoveItem(r.Context(), userID, listID, ticker, assetType); err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) memberships(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		httpx.Error(w, r, httpx.ErrUnauthorized)
		return
	}
	ticker := chi.URLParam(r, "ticker")
	assetType := r.URL.Query().Get("assetType")
	ids, err := h.repo.MembershipsForTicker(r.Context(), userID, ticker, assetType)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"watchlistIds": ids})
}
