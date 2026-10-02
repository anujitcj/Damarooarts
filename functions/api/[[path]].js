const PROJECT_SLUG = "we-before-me";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/*
 * Cloudflare Access protects the Pages site.
 *
 * Access injects the authenticated Google user's email
 * into this request header before it reaches the Function.
 */
function getAccessEmail(request) {
  const email = request.headers.get(
    "Cf-Access-Authenticated-User-Email"
  );

  return email ? email.trim().toLowerCase() : null;
}

async function getCurrentUser(request, env) {
  const email = getAccessEmail(request);

  if (!email) {
    return null;
  }

  return await env.DB.prepare(
    `
    SELECT id, email, name, role, active
    FROM users
    WHERE email = ?
    LIMIT 1
    `
  )
    .bind(email)
    .first();
}

async function requireUser(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: "Unauthorized",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  if (!user.active) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: "Account disabled",
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  return user;
}

function isScriptEditor(user) {
  return (
    user.role === "admin" ||
    user.role === "script_editor"
  );
}

function isAdmin(user) {
  return user.role === "admin";
}

async function getProject(env) {
  return await env.DB.prepare(
    `
    SELECT *
    FROM projects
    WHERE slug = ?
    LIMIT 1
    `
  )
    .bind(PROJECT_SLUG)
    .first();
}

async function getLatestVersion(env, projectId) {
  return await env.DB.prepare(
    `
    SELECT
      sv.id,
      sv.version_number,
      sv.file_key,
      sv.file_name,
      sv.uploaded_by,
      sv.notes,
      sv.created_at,
      u.name AS uploaded_by_name,
      u.email AS uploaded_by_email
    FROM script_versions sv
    LEFT JOIN users u
      ON u.id = sv.uploaded_by
    WHERE sv.project_id = ?
    ORDER BY sv.version_number DESC
    LIMIT 1
    `
  )
    .bind(projectId)
    .first();
}

export async function onRequest(context) {
  const { request, env, params } = context;

  /*
   * [[path]] gives us everything after /api/.
   *
   * Examples:
   * /api/me
   * /api/projects/we-before-me/script
   * /api/admin/users
   */

  const pathParts = Array.isArray(params.path)
    ? params.path
    : params.path
      ? [params.path]
      : [];

  const path = pathParts.join("/");
  const method = request.method;

  try {
    /*
     * ---------------------------------------------------------
     * GET /api/health
     * ---------------------------------------------------------
     */

    if (path === "health" && method === "GET") {
      return json({
        ok: true,
        database: "connected",
      });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/me
     * ---------------------------------------------------------
     */

    if (path === "me" && method === "GET") {
      const accessEmail = getAccessEmail(request);
      const user = await getCurrentUser(request, env);

      if (!accessEmail) {
        return json(
          {
            ok: false,
            authenticated: false,
            authorized: false,
            reason: "access_session_missing",
            error: "Cloudflare Access session is not available to the application.",
          },
          401
        );
      }

      if (!user) {
        return json(
          {
            ok: false,
            authenticated: true,
            authorized: false,
            reason: "not_authorized",
            email: accessEmail,
            error: "Google account is authenticated but is not authorised in D1.",
          },
          403
        );
      }

      if (!user.active) {
        return json(
          {
            ok: false,
            authenticated: true,
            authorized: true,
            reason: "account_disabled",
            error: "Account disabled",
          },
          403
        );
      }

      return json({ ok: true, user });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/projects/we-before-me
     * ---------------------------------------------------------
     */

    if (
      path === `projects/${PROJECT_SLUG}` &&
      method === "GET"
    ) {
      const user = await requireUser(request, env);
      const project = await getProject(env);

      if (!project) {
        return json(
          {
            ok: false,
            error: "Project not found",
          },
          404
        );
      }

      return json({
        ok: true,
        project,
        user,
      });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/projects/we-before-me/script
     *
     * Users only receive the latest screenplay.
     * Past versions are intentionally not exposed through
     * the application API.
     * ---------------------------------------------------------
     */

    if (
      path === `projects/${PROJECT_SLUG}/script` &&
      method === "GET"
    ) {
      await requireUser(request, env);

      const project = await getProject(env);

      if (!project) {
        return json(
          {
            ok: false,
            error: "Project not found",
          },
          404
        );
      }

      const version = await getLatestVersion(
        env,
        project.id
      );

      if (!version) {
        return json(
          {
            ok: false,
            error: "No screenplay uploaded yet",
          },
          404
        );
      }

      const object = await env.FILES.get(
        version.file_key
      );

      if (!object) {
        return json(
          {
            ok: false,
            error: "Screenplay file not found",
          },
          404
        );
      }

      const headers = new Headers();

      headers.set(
        "Content-Type",
        object.httpMetadata?.contentType ||
          "application/pdf"
      );

      headers.set(
        "Content-Disposition",
        `inline; filename="${version.file_name.replace(/"/g, "")}"`
      );

      headers.set(
        "Cache-Control",
        "private, no-store"
      );

      headers.set(
        "X-Script-Version",
        String(version.version_number)
      );

      headers.set(
        "X-Script-Uploaded-At",
        String(version.created_at || "")
      );

      headers.set(
        "X-Script-File-Name",
        encodeURIComponent(String(version.file_name || "screenplay.pdf"))
      );

      return new Response(object.body, {
        status: 200,
        headers,
      });
    }

    /*
     * ---------------------------------------------------------
     * POST /api/projects/we-before-me/script
     *
     * Upload a new screenplay PDF.
     *
     * Allowed:
     *   admin
     *   script_editor
     *
     * Not allowed:
     *   reader
     *
     * Every uploaded version remains stored in R2 and D1.
     * Users do not get a version-history endpoint.
     * ---------------------------------------------------------
     */

    if (
      path === `projects/${PROJECT_SLUG}/script` &&
      method === "POST"
    ) {
      const user = await requireUser(request, env);

      if (!isScriptEditor(user)) {
        return json(
          {
            ok: false,
            error:
              "Only admin or script editors can upload the screenplay",
          },
          403
        );
      }

      const project = await getProject(env);

      if (!project) {
        return json(
          {
            ok: false,
            error: "Project not found",
          },
          404
        );
      }

      const contentType =
        request.headers.get("Content-Type") || "";

      if (
        !contentType
          .toLowerCase()
          .includes("multipart/form-data")
      ) {
        return json(
          {
            ok: false,
            error:
              "Upload must use multipart/form-data",
          },
          400
        );
      }

      const formData = await request.formData();

      const file = formData.get("file");
      const notes = formData.get("notes");

      if (!file || typeof file === "string") {
        return json(
          {
            ok: false,
            error: "PDF file is required",
          },
          400
        );
      }

      const fileName =
        file.name || "screenplay.pdf";

      if (
        !fileName
          .toLowerCase()
          .endsWith(".pdf")
      ) {
        return json(
          {
            ok: false,
            error: "Only PDF files are allowed",
          },
          400
        );
      }

      if (
        file.type &&
        file.type !== "application/pdf"
      ) {
        return json(
          {
            ok: false,
            error: "Uploaded file must be a PDF",
          },
          400
        );
      }

      const latest = await env.DB.prepare(
        `
        SELECT MAX(version_number) AS max_version
        FROM script_versions
        WHERE project_id = ?
        `
      )
        .bind(project.id)
        .first();

      const nextVersion =
        Number(latest?.max_version || 0) + 1;

      const safeFileName = fileName
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .replace(/\s+/g, "_");

      const uniqueId = crypto.randomUUID();

      const fileKey =
        `projects/${PROJECT_SLUG}/scripts/` +
        `v${String(nextVersion).padStart(3, "0")}/` +
        `${uniqueId}-${safeFileName}`;

      await env.FILES.put(
        fileKey,
        file.stream(),
        {
          httpMetadata: {
            contentType: "application/pdf",
          },
          customMetadata: {
            project: PROJECT_SLUG,
            version: String(nextVersion),
            uploadedBy: user.email,
          },
        }
      );

      const notesText =
        typeof notes === "string"
          ? notes.trim()
          : "";

      const inserted = await env.DB.prepare(
        `
        INSERT INTO script_versions (
          project_id,
          version_number,
          file_key,
          file_name,
          uploaded_by,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
        `
      )
        .bind(
          project.id,
          nextVersion,
          fileKey,
          fileName,
          user.id,
          notesText || null
        )
        .first();

      const versionId = inserted?.id;

      await env.DB.prepare(
        `
        INSERT INTO update_logs (
          project_id,
          user_id,
          action,
          description,
          script_version_id,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          project.id,
          user.id,
          "script_uploaded",
          `${user.name || user.email} uploaded screenplay version ${nextVersion}.`,
          versionId,
          JSON.stringify({
            file_name: fileName,
            version: nextVersion,
          })
        )
        .run();

      return json(
        {
          ok: true,
          message:
            "Script uploaded successfully.",
          version: nextVersion,
          version_id: versionId,
          file_name: fileName,
        },
        201
      );
    }

    /*
     * ---------------------------------------------------------
     * GET /api/projects/we-before-me/comments
     *
     * Only comments belonging to the CURRENT screenplay
     * version are returned.
     * ---------------------------------------------------------
     */

    if (
      path === `projects/${PROJECT_SLUG}/comments` &&
      method === "GET"
    ) {
      await requireUser(request, env);

      const project = await getProject(env);

      if (!project) {
        return json(
          {
            ok: false,
            error: "Project not found",
          },
          404
        );
      }

      const latestVersion =
        await getLatestVersion(
          env,
          project.id
        );

      if (!latestVersion) {
        return json({
          ok: true,
          version: null,
          comments: [],
        });
      }

      const result = await env.DB.prepare(
        `
        SELECT
          c.id,
          c.script_version_id,
          c.anchor_type,
          c.anchor_value,
          c.selected_text,
          c.body,
          c.resolved,
          c.created_at,
          c.updated_at,
          u.id AS author_id,
          u.name AS author_name,
          u.email AS author_email
        FROM comments c
        JOIN users u
          ON u.id = c.author_id
        WHERE c.project_id = ?
          AND c.script_version_id = ?
        ORDER BY c.created_at ASC
        `
      )
        .bind(
          project.id,
          latestVersion.id
        )
        .all();

      return json({
        ok: true,
        version: {
          id: latestVersion.id,
          version_number:
            latestVersion.version_number,
          file_name:
            latestVersion.file_name,
        },
        comments: result.results || [],
      });
    }

    /*
     * ---------------------------------------------------------
     * POST /api/projects/we-before-me/comments
     *
     * Any authorized user can comment.
     * ---------------------------------------------------------
     */

    if (
      path === `projects/${PROJECT_SLUG}/comments` &&
      method === "POST"
    ) {
      const user = await requireUser(request, env);

      const project = await getProject(env);

      if (!project) {
        return json(
          {
            ok: false,
            error: "Project not found",
          },
          404
        );
      }

      const latestVersion =
        await getLatestVersion(
          env,
          project.id
        );

      if (!latestVersion) {
        return json(
          {
            ok: false,
            error:
              "No screenplay available for commenting",
          },
          400
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON body",
          },
          400
        );
      }

      const anchor = body.anchor || {};

      const page =
        anchor.page !== undefined
          ? Number(anchor.page)
          : null;

      const x =
        anchor.x !== undefined
          ? Number(anchor.x)
          : null;

      const y =
        anchor.y !== undefined
          ? Number(anchor.y)
          : null;

      const selectedText =
        typeof body.selected_text === "string"
          ? body.selected_text.trim()
          : "";

      const commentBody =
        typeof body.body === "string"
          ? body.body.trim()
          : "";

      if (!commentBody) {
        return json(
          {
            ok: false,
            error: "Comment cannot be empty",
          },
          400
        );
      }

      const anchorValue =
        JSON.stringify({
          page,
          x,
          y,
        });

      const inserted = await env.DB.prepare(
        `
        INSERT INTO comments (
          project_id,
          script_version_id,
          author_id,
          anchor_type,
          anchor_value,
          selected_text,
          body
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        `
      )
        .bind(
          project.id,
          latestVersion.id,
          user.id,
          "pdf",
          anchorValue,
          selectedText || null,
          commentBody
        )
        .first();

      const commentId = inserted?.id;

      await env.DB.prepare(
        `
        INSERT INTO update_logs (
          project_id,
          user_id,
          action,
          description,
          script_version_id,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          project.id,
          user.id,
          "comment_added",
          `${user.name || user.email} added a screenplay comment.`,
          latestVersion.id,
          JSON.stringify({
            comment_id: commentId,
          })
        )
        .run();

      return json(
        {
          ok: true,
          message:
            "Comment added successfully.",
          comment_id: commentId,
        },
        201
      );
    }

    /*
     * ---------------------------------------------------------
     * PATCH /api/projects/we-before-me/comments/:id
     *
     * Admin + script editor can resolve/reopen comments.
     * ---------------------------------------------------------
     */

    const commentMatch = path.match(
      /^projects\/we-before-me\/comments\/(\d+)$/
    );

    if (
      commentMatch &&
      method === "PATCH"
    ) {
      const user =
        await requireUser(request, env);

      if (!isScriptEditor(user)) {
        return json(
          {
            ok: false,
            error:
              "Only admin or script editors can modify comments",
          },
          403
        );
      }

      const commentId = Number(
        commentMatch[1]
      );

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON body",
          },
          400
        );
      }

      if (
        typeof body.resolved !== "boolean"
      ) {
        return json(
          {
            ok: false,
            error:
              "resolved must be true or false",
          },
          400
        );
      }

      const existing =
        await env.DB.prepare(
          `
          SELECT
            id,
            project_id,
            script_version_id
          FROM comments
          WHERE id = ?
          LIMIT 1
          `
        )
          .bind(commentId)
          .first();

      if (!existing) {
        return json(
          {
            ok: false,
            error: "Comment not found",
          },
          404
        );
      }

      await env.DB.prepare(
        `
        UPDATE comments
        SET
          resolved = ?,
          updated_at = datetime('now')
        WHERE id = ?
        `
      )
        .bind(
          body.resolved ? 1 : 0,
          commentId
        )
        .run();

      await env.DB.prepare(
        `
        INSERT INTO update_logs (
          project_id,
          user_id,
          action,
          description,
          script_version_id,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          existing.project_id,
          user.id,
          body.resolved
            ? "comment_resolved"
            : "comment_reopened",
          body.resolved
            ? `${user.name || user.email} resolved a screenplay comment.`
            : `${user.name || user.email} reopened a screenplay comment.`,
          existing.script_version_id,
          JSON.stringify({
            comment_id: commentId,
          })
        )
        .run();

      return json({
        ok: true,
        message: body.resolved
          ? "Comment resolved."
          : "Comment reopened.",
      });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/projects/we-before-me/comments/:id/replies
     * ---------------------------------------------------------
     */
    const replyListMatch = path.match(
      new RegExp(`^projects/${PROJECT_SLUG}/comments/(\\d+)/replies$`)
    );

    if (replyListMatch && method === "GET") {
      await requireUser(request, env);
      const commentId = Number(replyListMatch[1]);
      const result = await env.DB.prepare(`
        SELECT r.id, r.comment_id, r.body, r.created_at,
               u.id AS author_id, u.name AS author_name, u.email AS author_email
        FROM comment_replies r
        JOIN users u ON u.id = r.author_id
        WHERE r.comment_id = ?
        ORDER BY r.created_at ASC, r.id ASC
      `).bind(commentId).all();
      return json({ ok: true, replies: result.results || [] });
    }

    /*
     * ---------------------------------------------------------
     * POST /api/projects/we-before-me/comments/:id/replies
     * ---------------------------------------------------------
     */
    if (replyListMatch && method === "POST") {
      const user = await requireUser(request, env);
      const commentId = Number(replyListMatch[1]);
      const comment = await env.DB.prepare(`SELECT id, project_id, script_version_id FROM comments WHERE id = ? LIMIT 1`).bind(commentId).first();
      if (!comment) return json({ ok: false, error: "Comment not found" }, 404);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) return json({ ok: false, error: "Reply cannot be empty" }, 400);
      const inserted = await env.DB.prepare(`
        INSERT INTO comment_replies (comment_id, author_id, body) VALUES (?, ?, ?) RETURNING id
      `).bind(commentId, user.id, text).first();
      await env.DB.prepare(`
        INSERT INTO update_logs (project_id, user_id, action, description, script_version_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(comment.project_id, user.id, "comment_replied", `${user.name || user.email} replied to screenplay comment ${commentId}.`, comment.script_version_id, JSON.stringify({ comment_id: commentId, reply_id: inserted?.id })).run();
      return json({ ok: true, reply_id: inserted?.id }, 201);
    }

    /*
     * ---------------------------------------------------------
     * GET /api/admin/users
     *
     * Admin only.
     * ---------------------------------------------------------
     */

    if (
      path === "admin/users" &&
      method === "GET"
    ) {
      const admin =
        await requireUser(request, env);

      if (!isAdmin(admin)) {
        return json(
          {
            ok: false,
            error: "Admin access required",
          },
          403
        );
      }

      const result = await env.DB.prepare(
        `
        SELECT
          id,
          email,
          name,
          role,
          active,
          created_at,
          updated_at
        FROM users
        ORDER BY
          active DESC,
          name ASC,
          email ASC
        `
      ).all();

      return json({
        ok: true,
        users: result.results || [],
      });
    }

    /*
     * ---------------------------------------------------------
     * POST /api/admin/users
     *
     * Admin only.
     *
     * Adds an authorized Google account to D1.
     * ---------------------------------------------------------
     */

    if (
      path === "admin/users" &&
      method === "POST"
    ) {
      const admin =
        await requireUser(request, env);

      if (!isAdmin(admin)) {
        return json(
          {
            ok: false,
            error: "Admin access required",
          },
          403
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON body",
          },
          400
        );
      }

      const email =
        typeof body.email === "string"
          ? body.email.trim().toLowerCase()
          : "";

      const name =
        typeof body.name === "string"
          ? body.name.trim()
          : "";

      const role =
        typeof body.role === "string"
          ? body.role.trim()
          : "reader";

      if (!email) {
        return json(
          {
            ok: false,
            error: "Email is required",
          },
          400
        );
      }

      if (!email.includes("@")) {
        return json(
          {
            ok: false,
            error: "Invalid email address",
          },
          400
        );
      }

      const validRoles = [
        "admin",
        "script_editor",
        "reader",
      ];

      if (!validRoles.includes(role)) {
        return json(
          {
            ok: false,
            error: "Invalid role",
          },
          400
        );
      }

      const existing =
        await env.DB.prepare(
          `
          SELECT id
          FROM users
          WHERE email = ?
          LIMIT 1
          `
        )
          .bind(email)
          .first();

      if (existing) {
        return json(
          {
            ok: false,
            error:
              "A user with this email already exists",
          },
          409
        );
      }

      const inserted =
        await env.DB.prepare(
          `
          INSERT INTO users (
            email,
            name,
            role,
            active
          )
          VALUES (?, ?, ?, 1)
          RETURNING id, email, name, role, active
          `
        )
          .bind(
            email,
            name || null,
            role
          )
          .first();

      await env.DB.prepare(
        `
        INSERT INTO update_logs (
          project_id,
          user_id,
          action,
          description,
          metadata
        )
        VALUES (?, ?, ?, ?, ?)
        `
      )
        .bind(
          1,
          admin.id,
          "user_added",
          `${admin.name || admin.email} authorized ${email} as ${role}.`,
          JSON.stringify({
            target_user_id:
              inserted?.id,
            target_email: email,
            role,
          })
        )
        .run();

      return json(
        {
          ok: true,
          message:
            "User authorized successfully.",
          user: inserted,
        },
        201
      );
    }

    /*
     * ---------------------------------------------------------
     * PATCH /api/admin/users/:id
     *
     * Admin only.
     *
     * Can change:
     *   name
     *   role
     *   active
     *
     * Admin cannot accidentally remove their own admin role
     * or deactivate their own account.
     * ---------------------------------------------------------
     */

    const adminUserMatch = path.match(
      /^admin\/users\/(\d+)$/
    );

    if (
      adminUserMatch &&
      method === "PATCH"
    ) {
      const admin =
        await requireUser(request, env);

      if (!isAdmin(admin)) {
        return json(
          {
            ok: false,
            error: "Admin access required",
          },
          403
        );
      }

      const targetId = Number(
        adminUserMatch[1]
      );

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          {
            ok: false,
            error: "Invalid JSON body",
          },
          400
        );
      }

      const target =
        await env.DB.prepare(
          `
          SELECT
            id,
            email,
            name,
            role,
            active
          FROM users
          WHERE id = ?
          LIMIT 1
          `
        )
          .bind(targetId)
          .first();

      if (!target) {
        return json(
          {
            ok: false,
            error: "User not found",
          },
          404
        );
      }

      if (
        target.id === admin.id &&
        body.active === false
      ) {
        return json(
          {
            ok: false,
            error:
              "You cannot deactivate your own account",
          },
          400
        );
      }

      if (
        target.id === admin.id &&
        body.role &&
        body.role !== "admin"
      ) {
        return json(
          {
            ok: false,
            error:
              "You cannot remove your own admin role",
          },
          400
        );
      }

      const updates = [];
      const values = [];

      if (body.name !== undefined) {
        if (
          typeof body.name !== "string"
        ) {
          return json(
            {
              ok: false,
              error: "Invalid name",
            },
            400
          );
        }

        updates.push("name = ?");
        values.push(
          body.name.trim() || null
        );
      }

      if (body.role !== undefined) {
        const validRoles = [
          "admin",
          "script_editor",
          "reader",
        ];

        if (
          !validRoles.includes(
            body.role
          )
        ) {
          return json(
            {
              ok: false,
              error: "Invalid role",
            },
            400
          );
        }

        updates.push("role = ?");
        values.push(body.role);
      }

      if (body.active !== undefined) {
        if (
          typeof body.active !== "boolean"
        ) {
          return json(
            {
              ok: false,
              error:
                "active must be true or false",
            },
            400
          );
        }

        updates.push("active = ?");
        values.push(
          body.active ? 1 : 0
        );
      }

      if (!updates.length) {
        return json(
          {
            ok: false,
            error: "No changes supplied",
          },
          400
        );
      }

      updates.push(
        "updated_at = datetime('now')"
      );

      values.push(targetId);

      await env.DB.prepare(
        `
        UPDATE users
        SET ${updates.join(", ")}
        WHERE id = ?
        `
      )
        .bind(...values)
        .run();

      const updated =
        await env.DB.prepare(
          `
          SELECT
            id,
            email,
            name,
            role,
            active,
            created_at,
            updated_at
          FROM users
          WHERE id = ?
          LIMIT 1
          `
        )
          .bind(targetId)
          .first();

      await env.DB.prepare(
        `
        INSERT INTO update_logs (
          project_id,
          user_id,
          action,
          description,
          metadata
        )
        VALUES (?, ?, ?, ?, ?)
        `
      )
        .bind(
          1,
          admin.id,
          "user_updated",
          `${admin.name || admin.email} updated user ${target.email}.`,
          JSON.stringify({
            target_user_id: target.id,
            target_email: target.email,
            changes: body,
          })
        )
        .run();

      return json({
        ok: true,
        message:
          "User updated successfully.",
        user: updated,
      });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/admin/projects/we-before-me/versions
     * Admin-only screenplay archive metadata.
     * ---------------------------------------------------------
     */

    if (
      path === `admin/projects/${PROJECT_SLUG}/versions` &&
      method === "GET"
    ) {
      const admin = await requireUser(request, env);
      if (!isAdmin(admin)) {
        return json({ ok: false, error: "Admin access required" }, 403);
      }

      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);

      const result = await env.DB.prepare(`
        SELECT
          sv.id, sv.version_number, sv.file_name, sv.notes, sv.created_at,
          u.name AS uploaded_by_name, u.email AS uploaded_by_email
        FROM script_versions sv
        LEFT JOIN users u ON u.id = sv.uploaded_by
        WHERE sv.project_id = ?
        ORDER BY sv.version_number DESC
      `).bind(project.id).all();

      return json({ ok: true, versions: result.results || [] });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/admin/projects/we-before-me/versions/:id
     * Admin-only access to an archived PDF.
     * ---------------------------------------------------------
     */

    const adminVersionMatch = path.match(
      new RegExp(`^admin/projects/${PROJECT_SLUG}/versions/(\\d+)$`)
    );

    if (adminVersionMatch && method === "GET") {
      const admin = await requireUser(request, env);
      if (!isAdmin(admin)) return json({ ok: false, error: "Admin access required" }, 403);

      const versionId = Number(adminVersionMatch[1]);
      const version = await env.DB.prepare(`
        SELECT id, version_number, file_key, file_name
        FROM script_versions
        WHERE id = ?
        LIMIT 1
      `).bind(versionId).first();

      if (!version) return json({ ok: false, error: "Version not found" }, 404);
      const object = await env.FILES.get(version.file_key);
      if (!object) return json({ ok: false, error: "Archived screenplay file not found" }, 404);

      const headers = new Headers();
      headers.set("Content-Type", object.httpMetadata?.contentType || "application/pdf");
      headers.set("Content-Disposition", `inline; filename="${version.file_name.replace(/"/g, "")}"`);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Script-Version", String(version.version_number));
      return new Response(object.body, { status: 200, headers });
    }

    /*
     * ---------------------------------------------------------
     * DELETE /api/admin/projects/we-before-me/versions/:id
     * Admin-only permanent removal of a stored screenplay version.
     * ---------------------------------------------------------
     */
    if (adminVersionMatch && method === "DELETE") {
      const admin = await requireUser(request, env);
      if (!isAdmin(admin)) return json({ ok: false, error: "Admin access required" }, 403);
      const versionId = Number(adminVersionMatch[1]);
      const version = await env.DB.prepare(`SELECT id, project_id, version_number, file_key, file_name FROM script_versions WHERE id = ? LIMIT 1`).bind(versionId).first();
      if (!version) return json({ ok: false, error: "Version not found" }, 404);
      await env.DB.prepare(`DELETE FROM comment_replies WHERE comment_id IN (SELECT id FROM comments WHERE script_version_id = ?)`).bind(versionId).run();
      await env.DB.prepare(`DELETE FROM comments WHERE script_version_id = ?`).bind(versionId).run();
      await env.DB.prepare(`DELETE FROM script_versions WHERE id = ?`).bind(versionId).run();
      try { await env.FILES.delete(version.file_key); } catch (e) { console.error(e); }
      await env.DB.prepare(`INSERT INTO update_logs (project_id, user_id, action, description, script_version_id, metadata) VALUES (?, ?, ?, ?, NULL, ?)`).bind(version.project_id, admin.id, "script_deleted", `${admin.name || admin.email} removed screenplay version ${version.version_number}.`, JSON.stringify({ version_id: version.id, file_name: version.file_name })).run();
      return json({ ok: true, message: "Screenplay version removed." });
    }

    /*
     * ---------------------------------------------------------
     * GET /api/admin/projects/we-before-me/logs
     * Admin-only audit log.
     * ---------------------------------------------------------
     */

    if (
      path === `admin/projects/${PROJECT_SLUG}/logs` &&
      method === "GET"
    ) {
      const admin = await requireUser(request, env);
      if (!isAdmin(admin)) return json({ ok: false, error: "Admin access required" }, 403);

      const project = await getProject(env);
      if (!project) return json({ ok: false, error: "Project not found" }, 404);

      const result = await env.DB.prepare(`
        SELECT
          l.id, l.action, l.description, l.metadata, l.created_at,
          u.name AS user_name, u.email AS user_email,
          sv.version_number AS script_version
        FROM update_logs l
        LEFT JOIN users u ON u.id = l.user_id
        LEFT JOIN script_versions sv ON sv.id = l.script_version_id
        WHERE l.project_id = ?
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 250
      `).bind(project.id).all();

      return json({ ok: true, logs: result.results || [] });
    }

    /*
     * ---------------------------------------------------------
     * Intentionally no public routes for:
     *
     * /api/projects/we-before-me/versions
     * /api/projects/we-before-me/script/:versionId
     *
     * Users only receive the latest screenplay.
     * Older versions remain in D1/R2 for administrative
     * inspection through Cloudflare.
     * ---------------------------------------------------------
     */

    return json(
      {
        ok: false,
        error: "Not found",
      },
      404
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(error);

    return json(
      {
        ok: false,
        error: "Internal server error",
      },
      500
    );
  }
}
