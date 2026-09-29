CREATE TABLE IF NOT EXISTS beta_registrations (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  beta_consent INTEGER NOT NULL CHECK (beta_consent = 1),
  research_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (research_opt_in IN (0, 1)),
  verification_token_hash TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  token_used_at TEXT,
  unsubscribe_token_hash TEXT NOT NULL,
  unsubscribe_token_expires_at TEXT NOT NULL,
  unsubscribe_used_at TEXT,
  verified_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_beta_registrations_verified ON beta_registrations (verified_at, unsubscribed_at);

CREATE TABLE IF NOT EXISTS beta_registration_rate_limits (
  client_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);