ALTER TABLE transactions
  DROP COLUMN IF EXISTS brokerage,
  DROP COLUMN IF EXISTS statutory_charges,
  DROP COLUMN IF EXISTS net_amount;

DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;
