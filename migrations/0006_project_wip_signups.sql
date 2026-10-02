-- Projects WIP sign-up support.
-- Safe to run against the existing D1 database.
-- Existing projects, users, screenplay files and comments are preserved.

CREATE TABLE IF NOT EXISTS project_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_project_signups_project_created
  ON project_signups(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_project_signups_user_created
  ON project_signups(user_id, created_at);

-- To list everyone who signed up for WIP projects:
-- SELECT p.name AS project, u.name, u.email, u.role, ps.created_at
-- FROM project_signups ps
-- JOIN projects p ON p.id = ps.project_id
-- JOIN users u ON u.id = ps.user_id
-- ORDER BY ps.created_at ASC;
