-- Multi-watchlist support: users can group watched tickers into named lists.
-- Existing flat-list rows get migrated into a per-user "My Watchlist" default.

CREATE TABLE watchlists (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  BIGINT       NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX watchlists_user_idx ON watchlists(user_id, sort_order);
CREATE TRIGGER watchlists_set_updated_at BEFORE UPDATE ON watchlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Default list per user with existing entries.
INSERT INTO watchlists (user_id, name)
  SELECT DISTINCT user_id, 'My Watchlist' FROM watchlist
ON CONFLICT (user_id, name) DO NOTHING;

-- Add watchlist_id, backfill, then make NOT NULL with FK.
ALTER TABLE watchlist ADD COLUMN watchlist_id UUID;

UPDATE watchlist w
  SET watchlist_id = wl.id
  FROM watchlists wl
  WHERE wl.user_id = w.user_id AND wl.name = 'My Watchlist';

ALTER TABLE watchlist ALTER COLUMN watchlist_id SET NOT NULL;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_watchlist_id_fkey
  FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE;

-- Replace flat (user, ticker) uniqueness with (list, ticker).
ALTER TABLE watchlist DROP CONSTRAINT watchlist_user_id_ticker_asset_type_key;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_unique
  UNIQUE (watchlist_id, ticker, asset_type);

CREATE INDEX watchlist_watchlist_idx ON watchlist(watchlist_id, sort_order);
