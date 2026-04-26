-- Tag every transaction with what caused it.
-- manual    → user clicked Buy/Sell in the UI
-- sip       → SIP scheduler auto-run (source_id = sip_plans.id)
-- alert     → future: alert-triggered action
-- rebalance → future: auto-rebalance job
ALTER TABLE transactions
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'sip', 'alert', 'rebalance')),
  ADD COLUMN source_id UUID;

CREATE INDEX transactions_source_idx ON transactions(source, source_id);

-- Backfill: rows whose note was written by the SIP scheduler get labelled.
-- Safe because the scheduler's note prefix is "SIP auto-execute".
UPDATE transactions
SET source = 'sip'
WHERE note ILIKE 'SIP auto-execute%';
