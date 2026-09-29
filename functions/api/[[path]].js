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
  return request.headers.get("Cf-Access-Authenticated-User-Email");
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
  return user.role === "admin" || user.role === "script_editor";
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

  const url = new URL(request.url);

  /*
   * [[path]] gives us everything after /api/
   *
   * Example:
   *
   * /api/me
   *                    -> "me"
   *
   * /api/projects/we-before-me/script
   *                    -> "projects/we-before-me/script"
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
      const user = await getCurrentUser(request, env);

      if (!user) {
        return json(
          {
            ok: false,
            authenticated: false,
          },
          401
        );
      }

      return json({
        ok: true,
        user,
      });
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
     * GET latest screenplay
     *
     * Users NEVER receive version history.
     * This always returns the latest version only.
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

      const object = await env.FILES.get(version.file_key);

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

  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json(
      {
        ok: false,
        error: "Upload must use multipart/form-data",
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

  const fileName = file.name || "screenplay.pdf";

  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return json(
      {
        ok: false,
        error: "Only PDF files are allowed",
      },
      400
    );
  }

  /*
   * Make sure the uploaded object is actually a PDF.
   */
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

  /*
   * Determine the next version number.
   */
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

  /*
   * Generate a unique R2 object key.
   */
  const safeFileName = fileName
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, "_");

  const uniqueId = crypto.randomUUID();

  const fileKey =
    `projects/${PROJECT_SLUG}/scripts/` +
    `v${String(nextVersion).padStart(3, "0")}/` +
    `${uniqueId}-${safeFileName}`;

  /*
   * Store the PDF privately in R2.
   */
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

  /*
   * Store the version in D1.
   */
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

  /*
   * Record the upload.
   */
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
      message: "Script uploaded successfully.",
      version: nextVersion,
      version_id: versionId,
      file_name: fileName,
    },
    201
  );
}
    /*
     * ---------------------------------------------------------
     * GET comments
     *
     * ONLY comments belonging to the latest screenplay
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

      const latestVersion = await getLatestVersion(
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
     * POST comment
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

      const latestVersion = await getLatestVersion(
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

      const anchorValue = JSON.stringify({
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

      /*
       * Log the comment action.
       */

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
          message: "Comment added successfully.",
          comment_id: commentId,
        },
        201
      );
    }

    /*
     * ---------------------------------------------------------
     * PATCH /comments/:id
     *
     * Resolve / reopen comment.
     * Admin + script editor only.
     * ---------------------------------------------------------
     */

    const commentMatch = path.match(
      /^projects\/we-before-me\/comments\/(\d+)$/
    );

    if (commentMatch && method === "PATCH") {
      const user = await requireUser(
        request,
        env
      );

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

      if (typeof body.resolved !== "boolean") {
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
     * Everything else
     *
     * There is deliberately NO public route for:
     *
     * /versions
     * /script/:versionId
     *
     * Users can only access the latest screenplay.
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
