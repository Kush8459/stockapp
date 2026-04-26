-- watchlist: tickers a user is tracking but doesn't (necessarily) own.
-- One entry per (user, ticker, asset_type) — same uniqueness shape as
-- holdings, so a stock can be both held and watched without conflict.
--
-- sort_order lets the UI render in user-defined order (drag-and-drop).
-- Defaulting to created_at-derived monotonic value via NOW() epoch keeps
-- new entries at the bottom by default.

CREATE TABLE watchlist (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker      VARCHAR(20)  NOT NULL,
  asset_type  VARCHAR(20)  NOT NULL CHECK (asset_type IN ('stock','mf','crypto')),
  sort_order  BIGINT       NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  note        TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker, asset_type)
);

CREATE INDEX watchlist_user_idx       ON watchlist(user_id, sort_order);
CREATE INDEX watchlist_ticker_idx     ON watchlist(ticker);
