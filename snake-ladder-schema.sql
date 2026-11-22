CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    model TEXT NOT NULL,
    score REAL NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    owner_digest TEXT,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS entries_rank ON entries(score DESC, created_at, id);
