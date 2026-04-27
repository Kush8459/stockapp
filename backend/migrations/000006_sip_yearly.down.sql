ALTER TABLE sip_plans DROP CONSTRAINT IF EXISTS sip_plans_frequency_check;
ALTER TABLE sip_plans ADD CONSTRAINT sip_plans_frequency_check
  CHECK (frequency IN ('daily','weekly','monthly'));
