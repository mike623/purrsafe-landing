CREATE TABLE IF NOT EXISTS beta_registration_rate_limits (
  client_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_beta_registration_rate_limits_window ON beta_registration_rate_limits (window_started_at);