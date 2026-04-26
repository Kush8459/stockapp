-- dividends: per-user log of dividend / interest receipts.
--
-- Captured manually for now (Indian dividend feeds aren't free or stable).
-- amount is gross, tds is the 10% withholding above ₹5K thresholds; the
-- generated net_amount column saves the UI from arithmetic everywhere.

CREATE TABLE dividends (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id  UUID          REFERENCES portfolios(id) ON DELETE SET NULL,
  ticker        VARCHAR(20)   NOT NULL,
  asset_type    VARCHAR(20)   NOT NULL DEFAULT 'stock' CHECK (asset_type IN ('stock','mf','crypto')),

  per_share     NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (per_share >= 0),
  shares        NUMERIC(24,8) NOT NULL CHECK (shares > 0),
  amount        NUMERIC(24,8) NOT NULL CHECK (amount >= 0),
  tds           NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (tds >= 0),
  net_amount    NUMERIC(24,8) GENERATED ALWAYS AS (amount - tds) STORED,

  payment_date  DATE          NOT NULL,
  ex_date       DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX dividends_user_idx      ON dividends(user_id, payment_date DESC);
CREATE INDEX dividends_ticker_idx    ON dividends(ticker, payment_date DESC);
CREATE INDEX dividends_portfolio_idx ON dividends(portfolio_id, payment_date DESC);
