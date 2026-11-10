-- Composite index for party movie lists ordered by creation date
CREATE INDEX IF NOT EXISTS idx_movies_party_created ON movies(party_id, created_at DESC);
