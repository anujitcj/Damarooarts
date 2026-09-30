-- Damaroo Arts Storyboard Simulator backend
-- Cloudflare D1 / SQLite

CREATE TABLE IF NOT EXISTS storyboard_projects (
  project_id INTEGER PRIMARY KEY,
  world_state_json TEXT NOT NULL DEFAULT '{"room":{"width":20,"height":8,"depth":20},"godEntities":[],"objects":[]}',
  active_shot_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS storyboard_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  shot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(project_id, shot_id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_shots_project
  ON storyboard_shots(project_id, created_at);

CREATE TABLE IF NOT EXISTS storyboard_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  shot_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  file_key TEXT,
  file_name TEXT,
  metadata_json TEXT,
  requested_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboard_exports_shot
  ON storyboard_exports(project_id, shot_id, created_at DESC);
