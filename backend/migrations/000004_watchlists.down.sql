DROP INDEX IF EXISTS watchlist_watchlist_idx;
ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_unique;
ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_watchlist_id_fkey;
ALTER TABLE watchlist DROP COLUMN IF EXISTS watchlist_id;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_user_id_ticker_asset_type_key
  UNIQUE (user_id, ticker, asset_type);
DROP TABLE IF EXISTS watchlists;
