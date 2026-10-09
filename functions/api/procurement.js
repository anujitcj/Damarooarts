const PROJECT_SLUG = "we-before-me";
const MAX_PROP_NAME = 120;
const MAX_DESCRIPTION = 50;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function getAccessEmail(request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return email ? email.trim().toLowerCase() : null;
}

async function requireUser(request, env) {
  const email = getAccessEmail(request);
  if (!email) throw json({ ok: false, error: "Unauthorized" }, 401);
  const user = await env.DB.prepare(
    `SELECT id, email, name, role, active FROM users WHERE email = ? LIMIT 1`
  ).bind(email).first();
  if (!user) throw json({ ok: false, error: "Account not authorized" }, 403);
  if (!Number(user.active)) throw json({ ok: false, error: "Account disabled" }, 403);
  return user;
}

function canEdit(user) {
  return user.role === "admin" || user.role === "script_editor";
}

async function getProject(env) {
  return env.DB.prepare(`SELECT id, slug, name FROM projects WHERE slug = ? LIMIT 1`)
    .bind(PROJECT_SLUG).first();
}

async function ensureList(env, projectId) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO procurement_lists (project_id) VALUES (?)`
  ).bind(projectId).run();
  return env.DB.prepare(
    `SELECT id, project_id, locked, locked_by, locked_at FROM procurement_lists WHERE project_id = ? LIMIT 1`
  ).bind(projectId).first();
}

async function loadState(env, list) {
  const props = await env.DB.prepare(`
    SELECT p.id, p.name, p.description, p.checked, p.checked_at, p.position, p.created_at,
           cb.id AS checked_by_id, cb.name AS checked_by_name, cb.email AS checked_by_email,
           cr.name AS created_by_name, cr.email AS created_by_email
    FROM procurement_props p
    LEFT JOIN users cb ON cb.id = p.checked_by
    LEFT JOIN users cr ON cr.id = p.created_by
    WHERE p.list_id = ?
    ORDER BY p.position ASC, p.id ASC
  `).bind(list.id).all();

  const lockedBy = list.locked_by
    ? await env.DB.prepare(`SELECT name, email FROM users WHERE id = ? LIMIT 1`).bind(list.locked_by).first()
    : null;

  return {
    locked: Number(list.locked) === 1,
    locked_at: list.locked_at || null,
    locked_by_name: lockedBy ? (lockedBy.name || lockedBy.email) : null,
    props: (props.results || []).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      checked: Number(p.checked) === 1,
      checked_at: p.checked_at || null,
      checked_by_name: p.checked_by_name || p.checked_by_email || null,
      checked_by_id: p.checked_by_id || null,
      created_by_name: p.created_by_name || p.created_by_email || null,
      created_at: p.created_at,
    })),
  };
}

async function logAction(env, projectId, userId, action, description, metadata = null) {
  try {
    await env.DB.prepare(`
      INSERT INTO update_logs (project_id, user_id, action, description, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).bind(projectId, userId, action, description, metadata ? JSON.stringify(metadata) : null).run();
  } catch (e) {
    console.error("procurement audit failed", e);
  }
}

async function readBody(request) {
  try { return await request.json(); } catch { throw json({ ok: false, error: "Invalid JSON body" }, 400); }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = parts.join("/");
  const method = request.method.toUpperCase();

  try {
    const user = await requireUser(request, env);
    const project = await getProject(env);
    if (!project) return json({ ok: false, error: "Project not found" }, 404);
    const list = await ensureList(env, project.id);

    if (path === "" && method === "GET") {
      return json({ ok: true, can_edit: canEdit(user), ...(await loadState(env, list)) });
    }

    if (path === "props" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can add props" }, 403);
      if (Number(list.locked) === 1) return json({ ok: false, error: "The list is locked" }, 409);
      const body = await readBody(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return json({ ok: false, error: "Prop name is required" }, 400);
      if (name.length > MAX_PROP_NAME) return json({ ok: false, error: `Prop name must be ${MAX_PROP_NAME} characters or fewer` }, 400);

      const pos = await env.DB.prepare(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM procurement_props WHERE list_id = ?`
      ).bind(list.id).first();

      const inserted = await env.DB.prepare(`
        INSERT INTO procurement_props (list_id, name, position, created_by)
        VALUES (?, ?, ?, ?) RETURNING id
      `).bind(list.id, name, Number(pos?.next || 1), user.id).first();

      await logAction(env, project.id, user.id, "prop_added",
        `${user.name || user.email} added prop "${name}".`, { prop_id: inserted.id });
      return json({ ok: true, prop_id: inserted.id }, 201);
    }

    const propMatch = path.match(/^props\/(\d+)$/);
    if (propMatch && method === "DELETE") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can remove props" }, 403);
      if (Number(list.locked) === 1) return json({ ok: false, error: "The list is locked" }, 409);
      const propId = Number(propMatch[1]);
      const prop = await env.DB.prepare(
        `SELECT id, name FROM procurement_props WHERE id = ? AND list_id = ? LIMIT 1`
      ).bind(propId, list.id).first();
      if (!prop) return json({ ok: false, error: "Prop not found" }, 404);
      await env.DB.prepare(`DELETE FROM procurement_props WHERE id = ?`).bind(propId).run();
      await logAction(env, project.id, user.id, "prop_removed",
        `${user.name || user.email} removed prop "${prop.name}".`, { prop_id: propId });
      return json({ ok: true });
    }

    const checkMatch = path.match(/^props\/(\d+)\/check$/);
    if (checkMatch && method === "PATCH") {
      if (Number(list.locked) === 1) return json({ ok: false, error: "The list is locked" }, 409);
      const propId = Number(checkMatch[1]);
      const body = await readBody(request);
      if (typeof body.checked !== "boolean") return json({ ok: false, error: "checked must be true or false" }, 400);
      const prop = await env.DB.prepare(
        `SELECT id, name, checked FROM procurement_props WHERE id = ? AND list_id = ? LIMIT 1`
      ).bind(propId, list.id).first();
      if (!prop) return json({ ok: false, error: "Prop not found" }, 404);

      if (body.checked) {
        await env.DB.prepare(`
          UPDATE procurement_props SET checked = 1, checked_by = ?, checked_at = datetime('now') WHERE id = ?
        `).bind(user.id, propId).run();
      } else {
        await env.DB.prepare(`
          UPDATE procurement_props SET checked = 0, checked_by = NULL, checked_at = NULL WHERE id = ?
        `).bind(propId).run();
      }
      await logAction(env, project.id, user.id, body.checked ? "prop_checked" : "prop_unchecked",
        `${user.name || user.email} ${body.checked ? "checked" : "unchecked"} prop "${prop.name}".`,
        { prop_id: propId });
      return json({ ok: true, checked: body.checked });
    }

    const descMatch = path.match(/^props\/(\d+)\/description$/);
    if (descMatch && method === "PATCH") {
      if (Number(list.locked) === 1) return json({ ok: false, error: "The list is locked" }, 409);
      const propId = Number(descMatch[1]);
      const body = await readBody(request);
      const text = typeof body.description === "string" ? body.description.trim() : "";
      if (text.length > MAX_DESCRIPTION) return json({ ok: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer` }, 400);
      const prop = await env.DB.prepare(
        `SELECT id, name FROM procurement_props WHERE id = ? AND list_id = ? LIMIT 1`
      ).bind(propId, list.id).first();
      if (!prop) return json({ ok: false, error: "Prop not found" }, 404);
      await env.DB.prepare(`UPDATE procurement_props SET description = ? WHERE id = ?`)
        .bind(text || null, propId).run();
      await logAction(env, project.id, user.id, "prop_described",
        `${user.name || user.email} updated the description of prop "${prop.name}".`, { prop_id: propId });
      return json({ ok: true, description: text });
    }

    if (path === "lock" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can lock the list" }, 403);
      if (Number(list.locked) === 1) return json({ ok: true, locked: true });
      const counts = await env.DB.prepare(`
        SELECT COUNT(*) AS total, COALESCE(SUM(checked), 0) AS done
        FROM procurement_props WHERE list_id = ?
      `).bind(list.id).first();
      if (!Number(counts.total)) return json({ ok: false, error: "Add at least one prop before locking" }, 400);
      if (Number(counts.done) !== Number(counts.total)) return json({ ok: false, error: "Every prop must be checked before locking" }, 400);
      await env.DB.prepare(`
        UPDATE procurement_lists SET locked = 1, locked_by = ?, locked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(user.id, list.id).run();
      await logAction(env, project.id, user.id, "procurement_locked",
        `${user.name || user.email} locked the Prop List.`);
      return json({ ok: true, locked: true });
    }

    if (path === "unlock" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can unlock the list" }, 403);
      await env.DB.prepare(`
        UPDATE procurement_lists SET locked = 0, locked_by = NULL, locked_at = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).bind(list.id).run();
      await logAction(env, project.id, user.id, "procurement_unlocked",
        `${user.name || user.email} unlocked the Prop List.`);
      return json({ ok: true, locked: false });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("procurement API error", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
