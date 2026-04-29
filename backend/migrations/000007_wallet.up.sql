-- Wallet: cash account per user. Funds in/out via deposits/withdrawals,
-- and trade-side debits/credits on buy/sell. Decoupled from `portfolios`
-- because real brokers run a single cash account across all portfolios.

CREATE TABLE wallets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency    CHAR(3)      NOT NULL DEFAULT 'INR',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER wallets_set_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per movement. Trade-side rows reference the originating
-- transaction so we can render charges/proceeds against an order in the UI.
CREATE TABLE wallet_transactions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID         NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id         UUID         NOT NULL REFERENCES users(id),
  kind            VARCHAR(20)  NOT NULL
                    CHECK (kind IN ('deposit','withdraw','buy','sell','charge','refund')),
  amount          NUMERIC(20,2) NOT NULL,        -- signed: positive = credit, negative = debit
  balance_after   NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
  method          VARCHAR(20),                   -- 'upi'/'bank'/'card' for deposits, NULL for trades
  reference       VARCHAR(120),                  -- bank/UPI ref or display label
  transaction_id  UUID REFERENCES transactions(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX wallet_txn_user_idx   ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX wallet_txn_wallet_idx ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX wallet_txn_link_idx   ON wallet_transactions(transaction_id);

-- Per-trade charges columns on transactions. Brokerage + statutory split so
-- the breakdown can be shown in the order detail. fees stays for legacy
-- callers; new code writes to brokerage + statutory_charges instead.
ALTER TABLE transactions
  ADD COLUMN brokerage         NUMERIC(20,2) NOT NULL DEFAULT 0
    CHECK (brokerage >= 0),
  ADD COLUMN statutory_charges NUMERIC(20,2) NOT NULL DEFAULT 0
    CHECK (statutory_charges >= 0),
  ADD COLUMN net_amount        NUMERIC(20,2) NOT NULL DEFAULT 0
    CHECK (net_amount >= 0);
-- net_amount is what hits the wallet:
--   buy:  -(price*qty + brokerage + statutory)
--   sell: +(price*qty - brokerage - statutory)

-- Seed every existing user with the starter balance so the app keeps working
-- after this migration. New users get the same amount via the signup hook.
INSERT INTO wallets (user_id, balance)
SELECT id, 100000.00 FROM users
ON CONFLICT (user_id) DO NOTHING;

-- Mirror that seed in wallet_transactions so the user can see where the
-- starter balance came from in their wallet history.
INSERT INTO wallet_transactions (wallet_id, user_id, kind, amount, balance_after, method, reference, note)
SELECT
  w.id,
  w.user_id,
  'deposit',
  100000.00,
  100000.00,
  'bonus',
  'Welcome bonus',
  'Starter balance for paper-trading mode'
FROM wallets w
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_transactions wt
  WHERE wt.wallet_id = w.id AND wt.kind = 'deposit' AND wt.method = 'bonus'
);
