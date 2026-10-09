const PROJECT_SLUG = "we-before-me";
const MAX_PROP_NAME = 120;
const MAX_DESCRIPTION = 50;
const STORE_KEY = `projects/${PROJECT_SLUG}/procurement/props.json`;

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

function emptyStore() {
  return { locked: false, locked_by: null, locked_at: null, nextId: 1, props: [] };
}

async function readStore(env) {
  const obj = await env.FILES.get(STORE_KEY);
  if (!obj) return emptyStore();
  try {
    const data = await obj.json();
    return { ...emptyStore(), ...data };
  } catch {
    return emptyStore();
  }
}

async function writeStore(env, store) {
  await env.FILES.put(STORE_KEY, JSON.stringify(store), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function readBody(request) {
  try { return await request.json(); } catch { throw json({ ok: false, error: "Invalid JSON body" }, 400); }
}

function publicState(store, canEditFlag) {
  return {
    ok: true,
    can_edit: canEditFlag,
    locked: !!store.locked,
    locked_at: store.locked_at || null,
    locked_by_name: store.locked_by_name || null,
    props: store.props.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || "",
      checked: !!p.checked,
      checked_at: p.checked_at || null,
      checked_by_name: p.checked_by_name || null,
      created_by_name: p.created_by_name || null,
      created_at: p.created_at,
    })),
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = parts.join("/");
  const method = request.method.toUpperCase();

  try {
    const user = await requireUser(request, env);
    const displayName = user.name || user.email;
    const store = await readStore(env);

    if (path === "" && method === "GET") {
      return json(publicState(store, canEdit(user)));
    }

    if (path === "props" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can add props" }, 403);
      if (store.locked) return json({ ok: false, error: "The list is locked" }, 409);
      const body = await readBody(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return json({ ok: false, error: "Prop name is required" }, 400);
      if (name.length > MAX_PROP_NAME) return json({ ok: false, error: `Prop name must be ${MAX_PROP_NAME} characters or fewer` }, 400);
      const id = store.nextId || 1;
      store.nextId = id + 1;
      store.props.push({
        id, name, description: "", checked: false,
        checked_at: null, checked_by_name: null,
        created_by_name: displayName, created_at: new Date().toISOString(),
      });
      await writeStore(env, store);
      return json({ ok: true, prop_id: id }, 201);
    }

    const propMatch = path.match(/^props\/(\d+)$/);
    if (propMatch && method === "DELETE") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can remove props" }, 403);
      if (store.locked) return json({ ok: false, error: "The list is locked" }, 409);
      const id = Number(propMatch[1]);
      const before = store.props.length;
      store.props = store.props.filter(p => p.id !== id);
      if (store.props.length === before) return json({ ok: false, error: "Prop not found" }, 404);
      await writeStore(env, store);
      return json({ ok: true });
    }

    const checkMatch = path.match(/^props\/(\d+)\/check$/);
    if (checkMatch && method === "PATCH") {
      if (store.locked) return json({ ok: false, error: "The list is locked" }, 409);
      const id = Number(checkMatch[1]);
      const body = await readBody(request);
      if (typeof body.checked !== "boolean") return json({ ok: false, error: "checked must be true or false" }, 400);
      const prop = store.props.find(p => p.id === id);
      if (!prop) return json({ ok: false, error: "Prop not found" }, 404);
      prop.checked = body.checked;
      prop.checked_by_name = body.checked ? displayName : null;
      prop.checked_at = body.checked ? new Date().toISOString() : null;
      await writeStore(env, store);
      return json({ ok: true, checked: body.checked });
    }

    const descMatch = path.match(/^props\/(\d+)\/description$/);
    if (descMatch && method === "PATCH") {
      if (store.locked) return json({ ok: false, error: "The list is locked" }, 409);
      const id = Number(descMatch[1]);
      const body = await readBody(request);
      const text = typeof body.description === "string" ? body.description.trim() : "";
      if (text.length > MAX_DESCRIPTION) return json({ ok: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer` }, 400);
      const prop = store.props.find(p => p.id === id);
      if (!prop) return json({ ok: false, error: "Prop not found" }, 404);
      prop.description = text;
      await writeStore(env, store);
      return json({ ok: true, description: text });
    }

    if (path === "lock" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can lock the list" }, 403);
      if (store.locked) return json({ ok: true, locked: true });
      if (!store.props.length) return json({ ok: false, error: "Add at least one prop before locking" }, 400);
      if (!store.props.every(p => p.checked)) return json({ ok: false, error: "Every prop must be checked before locking" }, 400);
      store.locked = true;
      store.locked_by_name = displayName;
      store.locked_at = new Date().toISOString();
      await writeStore(env, store);
      return json({ ok: true, locked: true });
    }

    if (path === "unlock" && method === "POST") {
      if (!canEdit(user)) return json({ ok: false, error: "Only admins and script editors can unlock the list" }, 403);
      store.locked = false;
      store.locked_by_name = null;
      store.locked_at = null;
      await writeStore(env, store);
      return json({ ok: true, locked: false });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("procurement API error", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
