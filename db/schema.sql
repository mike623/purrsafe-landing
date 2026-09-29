CREATE TABLE IF NOT EXISTS beta_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS beta_registration_rate_limits (
  client_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);
