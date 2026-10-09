const PROJECT_SLUG = "we-before-me";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
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
  return env.DB.prepare(`
    SELECT id, email, name, role, active, created_at, updated_at
    FROM users WHERE email = ? LIMIT 1
  `).bind(email).first();
}

async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) throw json({ ok: false, error: "Unauthorized" }, 401);
  if (!Number(user.active)) throw json({ ok: false, error: "Account disabled" }, 403);
  return user;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw json({ ok: false, error: "Insufficient permissions" }, 403);
}

function isEditor(user) { return user.role === "admin" || user.role === "script_editor"; }
function isAdmin(user) { return user.role === "admin"; }

async function getProject(env) {
  return env.DB.prepare(`SELECT * FROM projects WHERE slug = ? LIMIT 1`).bind(PROJECT_SLUG).first();
}

async function getLatestVersion(env, projectId) {
  return env.DB.prepare(`
    SELECT sv.id, sv.project_id, sv.version_number, sv.file_key, sv.file_name,
           sv.uploaded_by, sv.notes, sv.created_at,
           u.name AS uploaded_by_name, u.email AS uploaded_by_email
    FROM script_versions sv
    LEFT JOIN users u ON u.id = sv.uploaded_by
    WHERE sv.project_id = ?
    ORDER BY sv.version_number DESC, sv.id DESC
    LIMIT 1
  `).bind(projectId).first();
}

async function logAction(env, { projectId, userId, action, description, versionId = null, metadata = null }) {
  await env.DB.prepare(`
    INSERT INTO update_logs (project_id, user_id, action, description, script_version_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(projectId, userId, action, description, versionId, metadata ? JSON.stringify(metadata) : null).run();
}

function safeFileName(name) {
  return String(name || "screenplay.pdf")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 180);
}

function slugifyProjectName(name) {
  const base = String(name || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return base || "project";
}

function scriptHeaders(version) {
  return {
    "X-Script-Version": String(version.version_number),
    "X-Script-Uploaded-At": String(version.created_at || ""),
    "X-Script-File-Name": encodeURIComponent(version.file_name || "screenplay.pdf"),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const pathParts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = pathParts.join("/");
  const method = request.method.toUpperCase();
    if (path === "procurement" || path.startsWith("procurement/")) {
    const { onRequest: procurementHandler } = await import("./procurement.js");
    return procurementHandler({ request, env, params: { path: pathParts.slice(1) } });
  }

  try {
    if (method === "OPTIONS") return new Response(null, { status: 204 });

    if (path === "health" && method === "GET") {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, database: "connected", storage: !!env.FILES });
    }

    if (path === "me" && method === "GET") {
      const accessEmail = getAccessEmail(request);
      const user = await getCurrentUser(request, env);
      if (!accessEmail) return json({ ok: false, authenticated: false }, 401);
      if (!user) return json({ ok: false, authenticated: true, authorized: false, error: "Account not authorized" }, 403);
      if (!Number(user.active)) return json({ ok: false, authenticated: true, authorized: false, error: "Account disabled" }, 403);
      return json({ ok: true, user });
    }

    if (path === "projects" && method === "GET") {
      const user = await requireUser(request, env);
      const result = await env.DB.prepare(`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.description,
          p.status,
          p.created_at,
          p.updated_at,
          CASE WHEN ps.id IS NULL THEN 0 ELSE 1 END AS signed_up,
          (
            SELECT COUNT(*)
            FROM project_signups ps2
            WHERE ps2.project_id = p.id
          ) AS signup_count
        FROM projects p
        LEFT JOIN project_signups ps
          ON ps.project_id = p.id
         AND ps.user_id = ?
        WHERE p.status IN ('in_production','wip')
        ORDER BY
          CASE WHEN p.slug = 'we-before-me' THEN 0 ELSE 1 END,
          CASE WHEN p.status = 'wip' THEN 0 ELSE 1 END,
          p.created_at ASC,
          p.id ASC
      `).bind(user.id).all();
      return json({ ok: true, projects: result.results || [] });
    }

    const signupMatch = path.match(/^projects\/([^/]+)\/signup$/);
    if (signupMatch && method === "POST") {
      const user = await requireUser(request, env);
      const slug = signupMatch[1].toLowerCase();
      const project = await env.DB.prepare(`
        SELECT id, name, slug, status
        FROM projects
        WHERE slug = ?
        LIMIT 1
      `).bind(slug).first();

      if (!project) return json({ ok: false, error: "Project not found" }, 404);
      if (project.status !== "wip") return json({ ok: false, error: "Sign-up is only available for WORK IN PROGRESS projects" }, 400);

      const existing = await env.DB.prepare(`
        SELECT id FROM project_signups WHERE project_id = ? AND user_id = ? LIMIT 1
      `).bind(project.id, user.id).first();

      if (existing) return json({ ok: true, already_signed_up: true, message: "You are already signed up." });

      await env.DB.prepare(`
        INSERT INTO project_signups (project_id, user_id)
        VALUES (?, ?)
      `).bind(project.id, user.id).run();

      await logAction(env, {
        projectId: project.id,
        userId: user.id,
        action: "project_signup",
        description: `${user.name || user.email} signed up for WORK IN PROGRESS project ${project.name}.`,
        metadata: { project_id: project.id, project_slug: project.slug },
      });

      return json({ ok: true, already_signed_up: false, message: `Signed up for ${project.name}.` }, 201);
    }

    if (path === `projects/${PROJECT_SLUG}` && method === "GET") {
      const user = await requireUser(request, env);
      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);
      return json({ ok: true, project, user });
    }

    if (path === `projects/${PROJECT_SLUG}/script` && method === "GET") {
      await requireUser(request, env);
      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const version = await getLatestVersion(env, project.id);
      if (!version) return json({ ok: false, error: "No screenplay uploaded yet" }, 404);
      const object = await env.FILES.get(version.file_key);
      if (!object) return json({ ok: false, error: "Screenplay file not found in private storage" }, 404);
      const headers = new Headers({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${String(version.file_name).replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        ...scriptHeaders(version),
      });
      if (typeof object.size === "number") headers.set("Content-Length", String(object.size));
      return new Response(object.body, { status: 200, headers });
    }

    if (path === `projects/${PROJECT_SLUG}/script` && method === "POST") {
      const user = await requireUser(request, env);
      requireRole(user, ["admin", "script_editor"]);
      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);

      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().includes("multipart/form-data")) {
        return json({ ok: false, error: "Upload must use multipart/form-data" }, 400);
      }

      const form = await request.formData();
      const file = form.get("file");
      const notes = typeof form.get("notes") === "string" ? form.get("notes").trim() : "";
      if (!file || typeof file === "string") return json({ ok: false, error: "PDF file is required" }, 400);

      const fileName = file.name || "screenplay.pdf";
      if (!fileName.toLowerCase().endsWith(".pdf")) return json({ ok: false, error: "Only PDF files are allowed" }, 400);
      if (file.type && file.type !== "application/pdf") return json({ ok: false, error: "Uploaded file must be a PDF" }, 400);

      const latest = await env.DB.prepare(`SELECT MAX(version_number) AS max_version FROM script_versions WHERE project_id = ?`).bind(project.id).first();
      const nextVersion = Number(latest?.max_version || 0) + 1;
      const cleanName = safeFileName(fileName);
      const fileKey = `projects/${PROJECT_SLUG}/scripts/v${String(nextVersion).padStart(3, "0")}/${crypto.randomUUID()}-${cleanName}`;

      await env.FILES.put(fileKey, file.stream(), {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { project: PROJECT_SLUG, version: String(nextVersion), uploadedBy: user.email },
      });

      let inserted;
      try {
        inserted = await env.DB.prepare(`
          INSERT INTO script_versions (project_id, version_number, file_key, file_name, uploaded_by, notes)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id, version_number, file_name, created_at
        `).bind(project.id, nextVersion, fileKey, fileName, user.id, notes || null).first();

        await logAction(env, {
          projectId: project.id,
          userId: user.id,
          action: "script_uploaded",
          description: `${user.name || user.email} uploaded screenplay version ${nextVersion}.`,
          versionId: inserted.id,
          metadata: { file_name: fileName, version: nextVersion, file_key: fileKey },
        });
      } catch (error) {
        await env.FILES.delete(fileKey).catch(() => {});
        throw error;
      }

      return json({ ok: true, message: "Script uploaded successfully.", version: nextVersion, version_id: inserted.id, file_name: fileName, created_at: inserted.created_at }, 201);
    }

    if (path === `projects/${PROJECT_SLUG}/comments` && method === "GET") {
      await requireUser(request, env);
      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const latest = await getLatestVersion(env, project.id);
      if (!latest) return json({ ok: true, version: null, comments: [] });

      const result = await env.DB.prepare(`
        SELECT c.id, c.project_id, c.script_version_id, c.anchor_type, c.anchor_value,
               c.selected_text, c.body, c.resolved, c.created_at, c.updated_at,
               u.id AS author_id, u.name AS author_name, u.email AS author_email
        FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.project_id = ? AND c.script_version_id = ?
        ORDER BY c.created_at ASC, c.id ASC
      `).bind(project.id, latest.id).all();

      return json({ ok: true, version: latest, comments: result.results || [] });
    }

    if (path === `projects/${PROJECT_SLUG}/comments` && method === "POST") {
      const user = await requireUser(request, env);
      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const latest = await getLatestVersion(env, project.id);
      if (!latest) return json({ ok: false, error: "No screenplay available for commenting" }, 400);

      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const anchor = body?.anchor || {};
      const page = Number.isFinite(Number(anchor.page)) ? Number(anchor.page) : null;
      const x = Number.isFinite(Number(anchor.x)) ? Number(anchor.x) : null;
      const y = Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : null;
      const text = typeof body.body === "string" ? body.body.trim() : "";
      const selected = typeof body.selected_text === "string" ? body.selected_text.trim() : "";
      if (!text) return json({ ok: false, error: "Comment cannot be empty" }, 400);
      if (!page || page < 1 || x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) {
        return json({ ok: false, error: "A valid PDF page and point are required" }, 400);
      }

      const inserted = await env.DB.prepare(`
        INSERT INTO comments (project_id, script_version_id, author_id, anchor_type, anchor_value, selected_text, body)
        VALUES (?, ?, ?, 'pdf', ?, ?, ?) RETURNING id
      `).bind(project.id, latest.id, user.id, JSON.stringify({ page, x, y }), selected || null, text).first();

      await logAction(env, {
        projectId: project.id,
        userId: user.id,
        action: "comment_added",
        description: `${user.name || user.email} added a screenplay comment.`,
        versionId: latest.id,
        metadata: { comment_id: inserted.id },
      });
      return json({ ok: true, comment_id: inserted.id }, 201);
    }

    const commentMatch = path.match(new RegExp(`^projects/${PROJECT_SLUG}/comments/(\\d+)$`));
    if (commentMatch && method === "PATCH") {
      const user = await requireUser(request, env);
      requireRole(user, ["admin", "script_editor"]);
      const commentId = Number(commentMatch[1]);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      if (typeof body.resolved !== "boolean") return json({ ok: false, error: "resolved must be true or false" }, 400);

      const existing = await env.DB.prepare(`
        SELECT id, project_id, script_version_id, resolved FROM comments WHERE id = ? LIMIT 1
      `).bind(commentId).first();
      if (!existing) return json({ ok: false, error: "Comment not found" }, 404);
      if (Number(existing.resolved) === (body.resolved ? 1 : 0)) return json({ ok: true, resolved: body.resolved });

      await env.DB.prepare(`UPDATE comments SET resolved = ?, updated_at = datetime('now') WHERE id = ?`).bind(body.resolved ? 1 : 0, commentId).run();
      await logAction(env, {
        projectId: existing.project_id,
        userId: user.id,
        action: body.resolved ? "comment_resolved" : "comment_reopened",
        description: `${user.name || user.email} ${body.resolved ? "resolved" : "reopened"} screenplay comment ${commentId}.`,
        versionId: existing.script_version_id,
        metadata: { comment_id: commentId },
      });
      return json({ ok: true, resolved: body.resolved });
    }

    const repliesMatch = path.match(new RegExp(`^projects/${PROJECT_SLUG}/comments/(\\d+)/replies$`));
    if (repliesMatch && method === "GET") {
      await requireUser(request, env);
      const commentId = Number(repliesMatch[1]);
      const comment = await env.DB.prepare(`SELECT id FROM comments WHERE id = ? LIMIT 1`).bind(commentId).first();
      if (!comment) return json({ ok: false, error: "Comment not found" }, 404);
      const result = await env.DB.prepare(`
        SELECT r.id, r.comment_id, r.body, r.created_at, u.id AS author_id, u.name AS author_name, u.email AS author_email
        FROM comment_replies r JOIN users u ON u.id = r.author_id
        WHERE r.comment_id = ? ORDER BY r.created_at ASC, r.id ASC
      `).bind(commentId).all();
      return json({ ok: true, replies: result.results || [] });
    }

    if (repliesMatch && method === "POST") {
      const user = await requireUser(request, env);
      const commentId = Number(repliesMatch[1]);
      const comment = await env.DB.prepare(`SELECT id, project_id, script_version_id FROM comments WHERE id = ? LIMIT 1`).bind(commentId).first();
      if (!comment) return json({ ok: false, error: "Comment not found" }, 404);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) return json({ ok: false, error: "Reply cannot be empty" }, 400);
      const inserted = await env.DB.prepare(`INSERT INTO comment_replies (comment_id, author_id, body) VALUES (?, ?, ?) RETURNING id`).bind(commentId, user.id, text).first();
      await logAction(env, { projectId: comment.project_id, userId: user.id, action: "comment_replied", description: `${user.name || user.email} replied to screenplay comment ${commentId}.`, versionId: comment.script_version_id, metadata: { comment_id: commentId, reply_id: inserted.id } });
      return json({ ok: true, reply_id: inserted.id }, 201);
    }

    if (path === "admin/projects" && method === "POST") {
      const admin = await requireUser(request, env);
      requireRole(admin, ["admin"]);

      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }

      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const status = typeof body.status === "string" ? body.status.trim() : "wip";

      if (!name) return json({ ok: false, error: "Project name is required" }, 400);
      if (name.length > 120) return json({ ok: false, error: "Project name is too long" }, 400);
      if (description.length > 1000) return json({ ok: false, error: "Description is too long" }, 400);
      if (status !== "wip") return json({ ok: false, error: "New projects can only be created as WORK IN PROGRESS projects" }, 400);

      const baseSlug = slugifyProjectName(name);
      let slug = baseSlug;
      let suffix = 2;
      while (await env.DB.prepare(`SELECT id FROM projects WHERE slug = ? LIMIT 1`).bind(slug).first()) {
        slug = `${baseSlug}-${suffix++}`;
      }

      const inserted = await env.DB.prepare(`
        INSERT INTO projects (name, slug, description, status)
        VALUES (?, ?, ?, 'wip')
        RETURNING id, name, slug, description, status, created_at, updated_at
      `).bind(name, slug, description || null).first();

      await logAction(env, {
        projectId: inserted.id,
        userId: admin.id,
        action: "project_created",
        description: `${admin.name || admin.email} created WORK IN PROGRESS project ${inserted.name}.`,
        metadata: { project_id: inserted.id, project_slug: inserted.slug },
      });

      return json({ ok: true, project: inserted }, 201);
    }

    if (path === "admin/users" && method === "GET") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const result = await env.DB.prepare(`SELECT id, email, name, role, active, created_at, updated_at FROM users ORDER BY active DESC, name ASC, email ASC`).all();
      return json({ ok: true, users: result.results || [] });
    }

    if (path === "admin/users" && method === "POST") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      let body; try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const role = typeof body.role === "string" ? body.role.trim() : "reader";
      if (!email || !email.includes("@")) return json({ ok: false, error: "Valid email is required" }, 400);
      if (!["admin", "script_editor", "reader"].includes(role)) return json({ ok: false, error: "Invalid role" }, 400);
      const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(email).first();
      if (existing) return json({ ok: false, error: "A user with this email already exists" }, 409);
      const inserted = await env.DB.prepare(`INSERT INTO users (email, name, role, active) VALUES (?, ?, ?, 1) RETURNING id, email, name, role, active`).bind(email, name || null, role).first();
      const project = await getProject(env);
      if (project) await logAction(env, { projectId: project.id, userId: admin.id, action: "user_added", description: `${admin.name || admin.email} authorized ${email} as ${role}.`, metadata: { target_user_id: inserted.id, target_email: email, role } });
      return json({ ok: true, user: inserted }, 201);
    }

    const adminUserMatch = path.match(/^admin\/users\/(\d+)$/);
    if (adminUserMatch && method === "PATCH") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const targetId = Number(adminUserMatch[1]);
      let body; try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const target = await env.DB.prepare(`SELECT id, email, name, role, active FROM users WHERE id = ? LIMIT 1`).bind(targetId).first();
      if (!target) return json({ ok: false, error: "User not found" }, 404);
      if (target.id === admin.id && body.active === false) return json({ ok: false, error: "You cannot deactivate your own account" }, 400);
      if (target.id === admin.id && body.role && body.role !== "admin") return json({ ok: false, error: "You cannot remove your own admin role" }, 400);

      const updates = [], values = [];
      if (body.name !== undefined) { if (typeof body.name !== "string") return json({ ok: false, error: "Invalid name" }, 400); updates.push("name = ?"); values.push(body.name.trim() || null); }
      if (body.role !== undefined) { if (!["admin", "script_editor", "reader"].includes(body.role)) return json({ ok: false, error: "Invalid role" }, 400); updates.push("role = ?"); values.push(body.role); }
      if (body.active !== undefined) { if (typeof body.active !== "boolean") return json({ ok: false, error: "active must be true or false" }, 400); updates.push("active = ?"); values.push(body.active ? 1 : 0); }
      if (!updates.length) return json({ ok: false, error: "No changes supplied" }, 400);
      updates.push("updated_at = datetime('now')"); values.push(targetId);
      await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
      const updated = await env.DB.prepare(`SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE id = ? LIMIT 1`).bind(targetId).first();
      const project = await getProject(env);
      if (project) await logAction(env, { projectId: project.id, userId: admin.id, action: "user_updated", description: `${admin.name || admin.email} updated user ${target.email}.`, metadata: { target_user_id: target.id, target_email: target.email, changes: body } });
      return json({ ok: true, user: updated });
    }

    if (path === `admin/projects/${PROJECT_SLUG}/versions` && method === "GET") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const project = await getProject(env); if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const result = await env.DB.prepare(`
        SELECT sv.id, sv.project_id, sv.version_number, sv.file_name, sv.file_key, sv.notes, sv.created_at,
               u.name AS uploaded_by_name, u.email AS uploaded_by_email
        FROM script_versions sv LEFT JOIN users u ON u.id = sv.uploaded_by
        WHERE sv.project_id = ? ORDER BY sv.version_number DESC
      `).bind(project.id).all();
      return json({ ok: true, versions: result.results || [] });
    }

    const adminVersionMatch = path.match(new RegExp(`^admin/projects/${PROJECT_SLUG}/versions/(\\d+)$`));
    if (adminVersionMatch && method === "GET") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const versionId = Number(adminVersionMatch[1]);
      const version = await env.DB.prepare(`
        SELECT sv.*, u.name AS uploaded_by_name, u.email AS uploaded_by_email
        FROM script_versions sv LEFT JOIN users u ON u.id = sv.uploaded_by WHERE sv.id = ? LIMIT 1
      `).bind(versionId).first();
      if (!version) return json({ ok: false, error: "Version not found" }, 404);
      return json({ ok: true, version });
    }

    if (adminVersionMatch && method === "DELETE") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const versionId = Number(adminVersionMatch[1]);
      const project = await getProject(env); if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const version = await env.DB.prepare(`SELECT id, project_id, version_number, file_key, file_name FROM script_versions WHERE id = ? AND project_id = ? LIMIT 1`).bind(versionId, project.id).first();
      if (!version) return json({ ok: false, error: "Version not found" }, 404);

      const latest = await getLatestVersion(env, project.id);
      const wasLatest = latest && latest.id === version.id;

      await env.DB.prepare(`DELETE FROM comments WHERE script_version_id = ?`).bind(versionId).run();
      await env.DB.prepare(`DELETE FROM script_versions WHERE id = ?`).bind(versionId).run();
      const storageDeleted = await env.FILES.delete(version.file_key).then(() => true).catch(() => false);

      await logAction(env, { projectId: project.id, userId: admin.id, action: "script_deleted", description: `${admin.name || admin.email} removed screenplay version ${version.version_number}.`, metadata: { version_id: version.id, file_name: version.file_name, was_latest: wasLatest, storage_deleted: storageDeleted } });
      const newLatest = await getLatestVersion(env, project.id);
      return json({ ok: true, deleted_version: version.version_number, deleted_file: version.file_name, was_latest: wasLatest, new_latest_version: newLatest?.version_number || null, storage_deleted: storageDeleted });
    }

    if (path === `admin/projects/${PROJECT_SLUG}/logs` && method === "GET") {
      const admin = await requireUser(request, env); requireRole(admin, ["admin"]);
      const project = await getProject(env); if (!project) return json({ ok: false, error: "Project not found" }, 404);
      const result = await env.DB.prepare(`
        SELECT l.id, l.action, l.description, l.metadata, l.created_at,
               u.id AS user_id, u.name AS user_name, u.email AS user_email,
               sv.version_number AS script_version
        FROM update_logs l
        JOIN users u ON u.id = l.user_id
        LEFT JOIN script_versions sv ON sv.id = l.script_version_id
        WHERE l.project_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 500
      `).bind(project.id).all();
      return json({ ok: true, logs: result.results || [] });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Projects API error:", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
