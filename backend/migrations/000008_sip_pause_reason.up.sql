-- Why a SIP is paused. NULL = paused by user (or never paused). Set by the
-- scheduler when it auto-pauses a plan, e.g. due to an empty wallet.
ALTER TABLE sip_plans
  ADD COLUMN pause_reason VARCHAR(40);
