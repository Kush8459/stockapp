-- Goals: a savings target with a deadline. Linked to a single portfolio so
-- progress is computed against the holdings that actually back the goal.

CREATE TABLE goals (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id  UUID         NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  target_amount NUMERIC(20,2) NOT NULL CHECK (target_amount > 0),
  target_date   DATE         NOT NULL,
  -- Bucket label drives the "Retirement / Tax saving / Emergency / Trading"
  -- icons in the UI. Free-form so users can tag a goal "House down payment"
  -- without us adding rows.
  bucket        VARCHAR(40),
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX goals_user_idx      ON goals(user_id, target_date);
CREATE INDEX goals_portfolio_idx ON goals(portfolio_id);
CREATE TRIGGER goals_set_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
