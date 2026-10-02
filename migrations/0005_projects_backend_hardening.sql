-- Projects backend hardening.
-- Safe to run against the existing D1 database.
-- No existing data is deleted or rewritten.

CREATE TABLE IF NOT EXISTS comment_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_slug
  ON projects(slug);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

CREATE INDEX IF NOT EXISTS idx_script_versions_project_version
  ON script_versions(project_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_comments_project_version_created
  ON comments(project_id, script_version_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_comments_version_resolved
  ON comments(script_version_id, resolved, created_at, id);

CREATE INDEX IF NOT EXISTS idx_comment_replies_comment_created
  ON comment_replies(comment_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_update_logs_project_created
  ON update_logs(project_id, created_at DESC, id DESC);
