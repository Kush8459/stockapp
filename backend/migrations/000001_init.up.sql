-- === extensions =========================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- for gen_random_uuid()

-- === updated_at helper ===================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- === users ===============================================================
CREATE TABLE users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  display_name   VARCHAR(100),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === portfolios ==========================================================
CREATE TABLE portfolios (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  base_ccy    CHAR(3)      NOT NULL DEFAULT 'INR',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX portfolios_user_idx ON portfolios(user_id);
CREATE TRIGGER portfolios_set_updated_at BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === holdings ============================================================
-- current-state table. One row per (portfolio, ticker, asset_type).
CREATE TABLE holdings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID         NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker          VARCHAR(20)  NOT NULL,
  asset_type      VARCHAR(20)  NOT NULL CHECK (asset_type IN ('stock','mf','crypto')),
  quantity        NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  avg_buy_price   NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (avg_buy_price >= 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, ticker, asset_type)
);
CREATE INDEX holdings_portfolio_idx ON holdings(portfolio_id);
CREATE INDEX holdings_ticker_idx    ON holdings(ticker);
CREATE TRIGGER holdings_set_updated_at BEFORE UPDATE ON holdings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === transactions ========================================================
-- canonical record of every buy/sell.
CREATE TABLE transactions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id),
  portfolio_id  UUID         NOT NULL REFERENCES portfolios(id),
  ticker        VARCHAR(20)  NOT NULL,
  asset_type    VARCHAR(20)  NOT NULL CHECK (asset_type IN ('stock','mf','crypto')),
  side          VARCHAR(4)   NOT NULL CHECK (side IN ('buy','sell')),
  quantity      NUMERIC(24,8) NOT NULL CHECK (quantity > 0),
  price         NUMERIC(24,8) NOT NULL CHECK (price >= 0),
  total_amount  NUMERIC(24,8) NOT NULL CHECK (total_amount >= 0),
  fees          NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  note          TEXT,
  executed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX transactions_user_idx      ON transactions(user_id, executed_at DESC);
CREATE INDEX transactions_portfolio_idx ON transactions(portfolio_id, executed_at DESC);
CREATE INDEX transactions_ticker_idx    ON transactions(ticker, executed_at DESC);

-- === ledger_entries ======================================================
-- Double-entry view of each transaction. Every transaction writes >= 2 rows
-- here that must sum to zero in the base currency.
--
--   buy  RELIANCE x1 @2500 → debit "positions:RELIANCE" 2500, credit "cash" 2500
--   sell RELIANCE x1 @2600 → credit "positions:RELIANCE" 2600, debit  "cash" 2600
--
-- Keeps the positions book-balanced against cash and trivially auditable.
CREATE TABLE ledger_entries (
  id              BIGSERIAL    PRIMARY KEY,
  transaction_id  UUID         NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES users(id),
  portfolio_id    UUID         NOT NULL REFERENCES portfolios(id),
  account         VARCHAR(64)  NOT NULL,            -- e.g. "cash", "positions:RELIANCE"
  direction       VARCHAR(6)   NOT NULL CHECK (direction IN ('debit','credit')),
  amount          NUMERIC(24,8) NOT NULL CHECK (amount >= 0),
  currency        CHAR(3)      NOT NULL DEFAULT 'INR',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX ledger_user_idx          ON ledger_entries(user_id, created_at DESC);
CREATE INDEX ledger_txn_idx           ON ledger_entries(transaction_id);
CREATE INDEX ledger_account_idx       ON ledger_entries(account);

-- === audit_log ===========================================================
-- append-only. every state change writes here. never UPDATE/DELETE.
CREATE TABLE audit_log (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      UUID,
  action       VARCHAR(50) NOT NULL,                 -- e.g. 'transaction.create', 'sip.execute'
  entity_type  VARCHAR(50) NOT NULL,
  entity_id    UUID,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_user_idx   ON audit_log(user_id, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_log(entity_type, entity_id);

-- Best-effort immutability. A sufficiently privileged role can always bypass
-- triggers, so this is defence in depth, not a replacement for least-privilege.
CREATE OR REPLACE FUNCTION audit_log_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- === sip_plans ===========================================================
CREATE TABLE sip_plans (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id  UUID         NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker        VARCHAR(20)  NOT NULL,
  asset_type    VARCHAR(20)  NOT NULL CHECK (asset_type IN ('stock','mf','crypto')),
  amount        NUMERIC(24,8) NOT NULL CHECK (amount > 0),
  frequency     VARCHAR(20)  NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  next_run_at   TIMESTAMPTZ  NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','cancelled')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX sip_due_idx  ON sip_plans(next_run_at) WHERE status = 'active';
CREATE INDEX sip_user_idx ON sip_plans(user_id);
CREATE TRIGGER sip_plans_set_updated_at BEFORE UPDATE ON sip_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- === price_alerts ========================================================
CREATE TABLE price_alerts (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker        VARCHAR(20)  NOT NULL,
  target_price  NUMERIC(24,8) NOT NULL CHECK (target_price > 0),
  direction     VARCHAR(10)  NOT NULL CHECK (direction IN ('above','below')),
  triggered     BOOLEAN      NOT NULL DEFAULT FALSE,
  triggered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX alerts_ticker_active_idx ON price_alerts(ticker) WHERE NOT triggered;
CREATE INDEX alerts_user_idx          ON price_alerts(user_id);
