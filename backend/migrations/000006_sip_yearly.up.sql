-- Allow 'yearly' as a SIP frequency. Additive change — daily/weekly stay
-- in the constraint so any pre-existing plans of those cadences keep
-- running. The UI no longer offers daily/weekly for new plans, but the
-- scheduler still advances them correctly.

ALTER TABLE sip_plans DROP CONSTRAINT IF EXISTS sip_plans_frequency_check;
ALTER TABLE sip_plans ADD CONSTRAINT sip_plans_frequency_check
  CHECK (frequency IN ('daily','weekly','monthly','yearly'));
