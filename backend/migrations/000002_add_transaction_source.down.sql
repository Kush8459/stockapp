DROP INDEX IF EXISTS transactions_source_idx;
ALTER TABLE transactions
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS source;
