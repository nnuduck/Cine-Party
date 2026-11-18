CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'google')),
  provider_uid TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT DEFAULT NULL,
  handle TEXT DEFAULT NULL,
  display_name TEXT DEFAULT NULL,
  avatar_url TEXT DEFAULT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_user_provider
  ON user_identities(user_id, provider);

-- Backfill all existing Telegram accounts (Telegram IDs are < 1_000_000_000_000)
INSERT OR IGNORE INTO user_identities (provider, provider_uid, user_id, handle, display_name, avatar_url)
SELECT 'telegram', CAST(id AS TEXT), id, username, COALESCE(custom_name, first_name), avatar_url
FROM users
WHERE id > 0 AND id < 1000000000000;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'google')),
  mode TEXT NOT NULL CHECK (mode IN ('login', 'link')),
  link_user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
  pkce_verifier TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed', 'cancelled', 'error')),
  resolved_user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
  error_message TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);
