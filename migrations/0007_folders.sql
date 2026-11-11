CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('together', 'personal')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#D71921',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_folders_name_scope
  ON folders(party_id, COALESCE(user_id, 0), kind, name);

ALTER TABLE movies ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movies_folder ON movies(folder_id);
