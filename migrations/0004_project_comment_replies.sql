CREATE TABLE IF NOT EXISTS comment_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_comment_replies_comment ON comment_replies(comment_id, created_at);
