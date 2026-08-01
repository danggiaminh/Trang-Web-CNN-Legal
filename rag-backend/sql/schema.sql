CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug  TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  section       TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_slug ON chunks(article_slug);

CREATE TABLE IF NOT EXISTS ingest_state (
  article_slug      TEXT PRIMARY KEY,
  source_updated_at TEXT NOT NULL,
  ingested_at       TEXT NOT NULL,
  chunk_count       INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
  chunk_id  INTEGER PRIMARY KEY,
  embedding FLOAT[1024] distance_metric=cosine
);
