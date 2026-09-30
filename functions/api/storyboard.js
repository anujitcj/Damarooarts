const PROJECT_SLUG = "we-before-me";
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_GOD_ENTITIES = 5;
const FPS = 12;
const SEGMENT_DURATION = 1;
const MAX_ANCHORS = 300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getAccessEmail(request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return email ? email.trim().toLowerCase() : null;
}

async function getCurrentUser(request, env) {
  const email = getAccessEmail(request);
  if (!email) return null;

  return await env.DB.prepare(`
    SELECT id, email, name, role, active
    FROM users
    WHERE email = ?
    LIMIT 1
  `).bind(email).first();
}

async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return null;
  if (!user.active) throw json({ ok: false, error: "Account disabled" }, 403);
  return user;
}

function isEditor(user) {
  return user?.role === "admin" || user?.role === "script_editor";
}

async function requireEditor(request, env) {
  const user = await requireUser(request, env);
  if (!user) throw json({ ok: false, error: "Unauthorized" }, 401);
  if (!isEditor(user)) throw json({ ok: false, error: "Storyboard editor access required" }, 403);
  return user;
}

async function getProject(env) {
  return await env.DB.prepare(`
    SELECT id, slug, name
    FROM projects
    WHERE slug = ?
    LIMIT 1
  `).bind(PROJECT_SLUG).first();
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanString(value, fallback, max = 120) {
  if (typeof value !== "string") return fallback;
  const s = value.trim();
  return s ? s.slice(0, max) : fallback;
}

function validateWorld(world) {
  if (!world || typeof world !== "object") throw new Error("world must be an object");

  const godEntities = Array.isArray(world.godEntities) ? world.godEntities : [];
  if (godEntities.length > MAX_GOD_ENTITIES) throw new Error(`Maximum ${MAX_GOD_ENTITIES} God Entities allowed`);

  const objects = Array.isArray(world.objects) ? world.objects : [];
  const seenGod = new Set();

  for (const g of godEntities) {
    if (!g || typeof g !== "object") throw new Error("Invalid God Entity");
    if (!g.id) throw new Error("God Entity id is required");
    if (seenGod.has(String(g.id))) throw new Error("Duplicate God Entity id");
    seenGod.add(String(g.id));
    if ((!g.position || typeof g.position !== "object") && (!g.pos || typeof g.pos !== "object")) throw new Error("God Entity position is required");
  }

  for (const o of objects) {
    if (!o || typeof o !== "object") throw new Error("Invalid object");
    if (o.godId && !seenGod.has(String(o.godId))) throw new Error(`Object references missing God Entity: ${o.godId}`);
  }

  return {
    room: {
      width: clampNumber(world.room?.width ?? world.room?.w, 5, 100, 20),
      height: clampNumber(world.room?.height ?? world.room?.h, 3, 50, 8),
      depth: clampNumber(world.room?.depth ?? world.room?.d, 5, 100, 20),
    },
    godEntities,
    objects,
  };
}

function validateShot(input) {
  if (!input || typeof input !== "object") throw new Error("shot must be an object");

  const cameraPath = input.cameraPath || {};
  const anchors = Array.isArray(cameraPath.anchors) ? cameraPath.anchors : [];
  if (anchors.length > MAX_ANCHORS) throw new Error(`Maximum ${MAX_ANCHORS} camera anchors allowed`);

  for (const a of anchors) {
    if (!a || typeof a !== "object") throw new Error("Invalid camera anchor");
    if (!a.id) throw new Error("Camera anchor id is required");
    if ((!a.position || typeof a.position !== "object") && (!a.pos || typeof a.pos !== "object")) throw new Error("Camera anchor position is required");
  }

  const keyframes = input.objectKeyframes && typeof input.objectKeyframes === "object"
    ? input.objectKeyframes
    : {};

  const cameraFrames = Array.isArray(input.cameraFrames) ? input.cameraFrames : [];
  const timeline = input.timeline && typeof input.timeline === "object" ? input.timeline : {};

  return {
    shotId: cleanString(input.shotId, crypto.randomUUID(), 80),
    shotName: cleanString(input.shotName, "SHOT 001", 120),
    cameraPath: {
      anchors,
      segmentDuration: SEGMENT_DURATION,
      fps: FPS,
    },
    cameraFrames,
    objectKeyframes: keyframes,
    timeline: {
      currentFrame: Math.max(0, Math.floor(Number(timeline.currentFrame) || 0)),
      totalFrames: Math.max(0, Math.floor(Number(timeline.totalFrames) || Math.max(0, anchors.length - 1) * FPS)),
      fps: FPS,
      segmentDuration: SEGMENT_DURATION,
    },
  };
}

async function readJsonBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("Request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("Request body too large");
  try { return JSON.parse(text); } catch { throw new Error("Invalid JSON body"); }
}

async function ensureStoryboardProject(env, projectId, userId) {
  const existing = await env.DB.prepare(`
    SELECT project_id, world_state_json, active_shot_id, revision
    FROM storyboard_projects
    WHERE project_id = ?
    LIMIT 1
  `).bind(projectId).first();

  if (existing) return existing;

  const world = {
    room: { width: 20, height: 8, depth: 20 },
    godEntities: [],
    objects: [],
  };

  await env.DB.prepare(`
    INSERT INTO storyboard_projects
      (project_id, world_state_json, active_shot_id, revision, updated_by)
    VALUES (?, ?, NULL, 1, ?)
  `).bind(projectId, JSON.stringify(world), userId || null).run();

  return await env.DB.prepare(`
    SELECT project_id, world_state_json, active_shot_id, revision
    FROM storyboard_projects
    WHERE project_id = ?
    LIMIT 1
  `).bind(projectId).first();
}

async function getShot(env, projectId, shotId) {
  return await env.DB.prepare(`
    SELECT id, project_id, shot_id, name, state_json, created_at, updated_at
    FROM storyboard_shots
    WHERE project_id = ? AND shot_id = ?
    LIMIT 1
  `).bind(projectId, shotId).first();
}

async function writeAudit(env, projectId, userId, action, description, metadata = null) {
  try {
    await env.DB.prepare(`
      INSERT INTO update_logs (project_id, user_id, action, description, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).bind(projectId, userId, action, description, metadata ? JSON.stringify(metadata) : null).run();
  } catch (error) {
    console.error("storyboard audit log failed", error);
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = parts.join("/");
  const method = request.method;

  try {
    const user = await requireUser(request, env);
    if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

    const project = await getProject(env);
    if (!project) return json({ ok: false, error: "Project not found" }, 404);

    let base = await env.DB.prepare(`
      SELECT project_id, world_state_json, active_shot_id, revision
      FROM storyboard_projects
      WHERE project_id = ?
      LIMIT 1
    `).bind(project.id).first();

    if (!base && method !== "GET") {
      base = await ensureStoryboardProject(env, project.id, user.id);
    }

    if (path === "" && method === "GET") {
      if (!base) {
        return json({
          ok: true,
          project: {
            id: project.id,
            slug: project.slug,
            name: project.name,
            revision: 1,
            activeShotId: null,
          },
          world: {
            room: { width: 20, height: 8, depth: 20 },
            godEntities: [],
            objects: [],
          },
          shots: [],
        });
      }
      const shots = await env.DB.prepare(`
        SELECT id, shot_id, name, state_json, created_at, updated_at
        FROM storyboard_shots
        WHERE project_id = ?
        ORDER BY created_at ASC
      `).bind(project.id).all();

      return json({
        ok: true,
        project: {
          id: project.id,
          slug: project.slug,
          name: project.name,
          revision: Number(base.revision || 1),
          activeShotId: base.active_shot_id || null,
        },
        world: safeJsonParse(base.world_state_json, {
          room: { width: 20, height: 8, depth: 20 },
          godEntities: [],
          objects: [],
        }),
        shots: (shots.results || []).map(row => ({
          id: row.shot_id,
          name: row.name,
          state: safeJsonParse(row.state_json, null),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    }

    if (path === "" && method === "PUT") {
      const editor = await requireEditor(request, env);
      const body = await readJsonBody(request);
      const world = validateWorld(body.world);
      const shots = Array.isArray(body.shots) ? body.shots : [];
      const activeShotId = body.activeShotId ? String(body.activeShotId) : null;
      const expectedRevision = body.expectedRevision == null ? null : Number(body.expectedRevision);

      if (expectedRevision != null && expectedRevision !== Number(base.revision)) {
        return json({
          ok: false,
          error: "Storyboard revision conflict",
          conflict: true,
          currentRevision: Number(base.revision),
        }, 409);
      }

      const normalizedShots = shots.map(validateShot);
      const ids = new Set();
      for (const shot of normalizedShots) {
        if (ids.has(shot.shotId)) throw new Error(`Duplicate shot id: ${shot.shotId}`);
        ids.add(shot.shotId);
      }

      if (activeShotId && !ids.has(activeShotId)) throw new Error("activeShotId does not exist");

      const nextRevision = Number(base.revision || 1) + 1;
      await env.DB.prepare(`
        UPDATE storyboard_projects
        SET world_state_json = ?, active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ?
      `).bind(JSON.stringify(world), activeShotId, nextRevision, editor.id, project.id).run();

      const existing = await env.DB.prepare(`
        SELECT shot_id FROM storyboard_shots WHERE project_id = ?
      `).bind(project.id).all();
      const incomingIds = new Set(normalizedShots.map(s => s.shotId));

      for (const row of existing.results || []) {
        if (!incomingIds.has(row.shot_id)) {
          await env.DB.prepare(`DELETE FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`)
            .bind(project.id, row.shot_id).run();
        }
      }

      for (const shot of normalizedShots) {
        const exists = await getShot(env, project.id, shot.shotId);
        if (exists) {
          await env.DB.prepare(`
            UPDATE storyboard_shots
            SET name = ?, state_json = ?, updated_by = ?, updated_at = datetime('now')
            WHERE project_id = ? AND shot_id = ?
          `).bind(shot.shotName, JSON.stringify(shot), editor.id, project.id, shot.shotId).run();
        } else {
          await env.DB.prepare(`
            INSERT INTO storyboard_shots
              (project_id, shot_id, name, state_json, created_by, updated_by)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(project.id, shot.shotId, shot.shotName, JSON.stringify(shot), editor.id, editor.id).run();
        }
      }

      await writeAudit(env, project.id, editor.id, "storyboard_saved", `${editor.name || editor.email} saved storyboard state.`, {
        revision: nextRevision,
        shot_count: normalizedShots.length,
      });

      return json({ ok: true, revision: nextRevision, activeShotId });
    }

    if (path === "shots" && method === "POST") {
      const editor = await requireEditor(request, env);
      const body = await readJsonBody(request);
      const shot = validateShot(body.shot || body);
      const requestedId = cleanString(shot.shotId, crypto.randomUUID(), 80);

      const existing = await getShot(env, project.id, requestedId);
      if (existing) return json({ ok: false, error: "Shot id already exists" }, 409);

      await env.DB.prepare(`
        INSERT INTO storyboard_shots
          (project_id, shot_id, name, state_json, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(project.id, requestedId, shot.shotName, JSON.stringify(shot), editor.id, editor.id).run();

      const current = await env.DB.prepare(`SELECT revision FROM storyboard_projects WHERE project_id = ?`).bind(project.id).first();
      const nextRevision = Number(current?.revision || 1) + 1;
      await env.DB.prepare(`
        UPDATE storyboard_projects
        SET active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ?
      `).bind(requestedId, nextRevision, editor.id, project.id).run();

      await writeAudit(env, project.id, editor.id, "shot_created", `${editor.name || editor.email} created shot ${shot.shotName}.`, { shot_id: requestedId });
      return json({ ok: true, shot: { id: requestedId, name: shot.shotName, state: shot }, revision: nextRevision }, 201);
    }

    const shotMatch = path.match(/^shots\/([^/]+)$/);
    if (shotMatch) {
      const shotId = decodeURIComponent(shotMatch[1]);
      const existing = await getShot(env, project.id, shotId);
      if (!existing) return json({ ok: false, error: "Shot not found" }, 404);

      if (method === "GET") {
        return json({ ok: true, shot: {
          id: existing.shot_id,
          name: existing.name,
          state: safeJsonParse(existing.state_json, null),
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        }});
      }

      if (method === "PATCH") {
        const editor = await requireEditor(request, env);
        const body = await readJsonBody(request);
        const currentState = safeJsonParse(existing.state_json, {});
        const merged = { ...currentState, ...body.state };
        merged.shotId = existing.shot_id;
        if (body.name !== undefined) merged.shotName = cleanString(body.name, existing.name, 120);
        const shot = validateShot(merged);

        await env.DB.prepare(`
          UPDATE storyboard_shots
          SET name = ?, state_json = ?, updated_by = ?, updated_at = datetime('now')
          WHERE project_id = ? AND shot_id = ?
        `).bind(shot.shotName, JSON.stringify(shot), editor.id, project.id, shotId).run();

        const current = await env.DB.prepare(`SELECT revision FROM storyboard_projects WHERE project_id = ?`).bind(project.id).first();
        const nextRevision = Number(current?.revision || 1) + 1;
        await env.DB.prepare(`
          UPDATE storyboard_projects
          SET active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now')
          WHERE project_id = ?
        `).bind(shotId, nextRevision, editor.id, project.id).run();

        await writeAudit(env, project.id, editor.id, "shot_updated", `${editor.name || editor.email} updated shot ${shot.shotName}.`, { shot_id: shotId });
        return json({ ok: true, revision: nextRevision, shot: { id: shotId, name: shot.shotName, state: shot } });
      }

      if (method === "DELETE") {
        const editor = await requireEditor(request, env);
        await env.DB.prepare(`DELETE FROM storyboard_shots WHERE project_id = ? AND shot_id = ?`).bind(project.id, shotId).run();
        const current = await env.DB.prepare(`SELECT active_shot_id, revision FROM storyboard_projects WHERE project_id = ?`).bind(project.id).first();
        const nextActive = current?.active_shot_id === shotId ? null : current?.active_shot_id;
        const nextRevision = Number(current?.revision || 1) + 1;
        await env.DB.prepare(`
          UPDATE storyboard_projects
          SET active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now')
          WHERE project_id = ?
        `).bind(nextActive, nextRevision, editor.id, project.id).run();
        await writeAudit(env, project.id, editor.id, "shot_deleted", `${editor.name || editor.email} deleted shot ${shotId}.`, { shot_id: shotId });
        return json({ ok: true, revision: nextRevision, activeShotId: nextActive });
      }
    }

    const duplicateMatch = path.match(/^shots\/([^/]+)\/duplicate$/);
    if (duplicateMatch && method === "POST") {
      const editor = await requireEditor(request, env);
      const sourceId = decodeURIComponent(duplicateMatch[1]);
      const source = await getShot(env, project.id, sourceId);
      if (!source) return json({ ok: false, error: "Shot not found" }, 404);

      const body = await readJsonBody(request);
      const sourceState = safeJsonParse(source.state_json, {});
      const newId = crypto.randomUUID();
      const newName = cleanString(body.name, `${source.name} COPY`, 120);
      const shot = validateShot({ ...sourceState, shotId: newId, shotName: newName });

      await env.DB.prepare(`
        INSERT INTO storyboard_shots
          (project_id, shot_id, name, state_json, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(project.id, newId, newName, JSON.stringify(shot), editor.id, editor.id).run();

      const current = await env.DB.prepare(`SELECT revision FROM storyboard_projects WHERE project_id = ?`).bind(project.id).first();
      const nextRevision = Number(current?.revision || 1) + 1;
      await env.DB.prepare(`
        UPDATE storyboard_projects
        SET active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now')
        WHERE project_id = ?
      `).bind(newId, nextRevision, editor.id, project.id).run();

      await writeAudit(env, project.id, editor.id, "shot_duplicated", `${editor.name || editor.email} duplicated shot ${source.name}.`, { source_shot_id: sourceId, new_shot_id: newId });
      return json({ ok: true, revision: nextRevision, shot: { id: newId, name: newName, state: shot } }, 201);
    }

    if (path === "active" && method === "PUT") {
      const editor = await requireEditor(request, env);
      const body = await readJsonBody(request);
      const shotId = body.shotId ? String(body.shotId) : null;
      if (shotId) {
        const exists = await getShot(env, project.id, shotId);
        if (!exists) return json({ ok: false, error: "Shot not found" }, 404);
      }
      const current = await env.DB.prepare(`SELECT revision FROM storyboard_projects WHERE project_id = ?`).bind(project.id).first();
      const nextRevision = Number(current?.revision || 1) + 1;
      await env.DB.prepare(`UPDATE storyboard_projects SET active_shot_id = ?, revision = ?, updated_by = ?, updated_at = datetime('now') WHERE project_id = ?`)
        .bind(shotId, nextRevision, editor.id, project.id).run();
      return json({ ok: true, activeShotId: shotId, revision: nextRevision });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("storyboard API error", error);
    const message = error?.message || "Internal server error";
    const status = /body too large/i.test(message) ? 413 : /invalid json|must be|maximum|duplicate|does not exist|missing|invalid/i.test(message) ? 400 : 500;
    return json({ ok: false, error: message }, status);
  }
}
