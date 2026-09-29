const PROJECT_SLUG = "we-before-me";

/*
* ---------------------------------------------------------
* Basic JSON response helper
* ---------------------------------------------------------
*/

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
* ---------------------------------------------------------
* Cloudflare Access authentication
*
* Cloudflare Access injects the authenticated Google
* account's email into this request header.
* ---------------------------------------------------------
*/

function getAccessEmail(request) {
const email = request.headers.get(
"Cf-Access-Authenticated-User-Email"
);

if (!email) {
return null;
}

return email.trim().toLowerCase();
}

/*
* ---------------------------------------------------------
* Find the current application user in D1
* ---------------------------------------------------------
*/

async function getCurrentUser(request, env) {
const email = getAccessEmail(request);

if (!email) {
return null;
}

return await env.DB.prepare(
`
SELECT
id,
email,
name,
role,
active
FROM users
WHERE email = ?
LIMIT 1
`
)
.bind(email)
.first();
}

/*
* ---------------------------------------------------------
* Require an authenticated + authorized application user
* ---------------------------------------------------------
*/

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

/*
* ---------------------------------------------------------
* Permission helpers
* ---------------------------------------------------------
*/

function isScriptEditor(user) {
return (
user.role === "admin" ||
user.role === "script_editor"
);
}

function isAdmin(user) {
return user.role === "admin";
}

/*
* ---------------------------------------------------------
* Get project
* ---------------------------------------------------------
*/

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

/*
* ---------------------------------------------------------
* Get latest screenplay version
*
* IMPORTANT:
* The application intentionally exposes ONLY the latest
* screenplay version to normal users.
*
* Previous versions remain stored in D1/R2.
* ---------------------------------------------------------
*/

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

/*
* ---------------------------------------------------------
* Main Pages Function
* ---------------------------------------------------------
*/

export async function onRequest(context) {
const {
request,
env,
params,
} = context;

/*
* [[path]] contains everything after /api/
*
* /api/me
* ->
* me
*
* /api/projects/we-before-me/script
* ->
* projects/we-before-me/script
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
* -------------------------------------------------------
* GET /api/health
* -------------------------------------------------------
*/

if (
path === "health" &&
method === "GET"
) {
return json({
ok: true,
database: "connected",
});
}

/*
* -------------------------------------------------------
* GET /api/me
*
* Returns the currently authenticated application user.
* -------------------------------------------------------
*/

if (
path === "me" &&
method === "GET"
) {
const user =
await getCurrentUser(
request,
env
);

if (!user) {
return json(
{
ok: false,
authenticated: false,
},
401
);
}

if (!user.active) {
return json(
{
ok: false,
authenticated: true,
error: "Account disabled",
},
403
);
}

return json({
ok: true,
user,
});
}

/*
* -------------------------------------------------------
* GET /api/projects/we-before-me
*
* Project information + current user.
* -------------------------------------------------------
*/

if (
path === `projects/${PROJECT_SLUG}` &&
method === "GET"
) {
const user =
await requireUser(
request,
env
);

const project =
await getProject(env);

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
* -------------------------------------------------------
* GET /api/projects/we-before-me/script
*
* Returns ONLY the latest screenplay.
*
* There is intentionally no public version-history
* endpoint.
* -------------------------------------------------------
*/

if (
path ===
`projects/${PROJECT_SLUG}/script` &&
method === "GET"
) {
await requireUser(
request,
env
);

const project =
await getProject(env);

if (!project) {
return json(
{
ok: false,
error: "Project not found",
},
404
);
}

const version =
await getLatestVersion(
env,
project.id
);

if (!version) {
return json(
{
ok: false,
error:
"No screenplay uploaded yet",
},
404
);
}

const object =
await env.FILES.get(
version.file_key
);

if (!object) {
return json(
{
ok: false,
error:
"Screenplay file not found",
},
404
);
}

const headers =
new Headers();

headers.set(
"Content-Type",
object.httpMetadata
?.contentType ||
"application/pdf"
);

headers.set(
"Content-Disposition",
`inline; filename="${version.file_name.replace(
/"/g,
""
)}"`
);

headers.set(
"Cache-Control",
"private, no-store"
);

headers.set(
"X-Script-Version",
String(
version.version_number
)
);

return new Response(
object.body,
{
status: 200,
headers,
}
);
}

/*
* -------------------------------------------------------
* POST /api/projects/we-before-me/script
*
* Upload a new screenplay version.
*
* Allowed:
* admin
* script_editor
*
* Not allowed:
* reader
*
* The old version is NEVER deleted.
* -------------------------------------------------------
*/

if (
path ===
`projects/${PROJECT_SLUG}/script` &&
method === "POST"
) {
const user =
await requireUser(
request,
env
);

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

const project =
await getProject(env);

if (!project) {
return json(
{
ok: false,
error: "Project not found",
},
404
);
}

/*
* -----------------------------------------------------
* Read multipart/form-data
* -----------------------------------------------------
*/

let formData;

try {
formData =
await request.formData();
} catch {
return json(
{
ok: false,
error:
"Expected multipart/form-data",
},
400
);
}

const file =
formData.get("file");

const notes =
formData.get("notes");

if (
!file ||
typeof file.stream !== "function"
) {
return json(
{
ok: false,
error:
"PDF screenplay file is required",
},
400
);
}

const fileName =
typeof file.name === "string"
? file.name
: "screenplay.pdf";

/*
* -----------------------------------------------------
* PDF-only restriction
* -----------------------------------------------------
*/

const contentType =
file.type || "";

const isPdf =
contentType ===
"application/pdf" ||
fileName
.toLowerCase()
.endsWith(".pdf");

if (!isPdf) {
return json(
{
ok: false,
error:
"Only PDF screenplay files are allowed",
},
400
);
}

/*
* -----------------------------------------------------
* Determine next version number
* -----------------------------------------------------
*/

const latest =
await env.DB.prepare(
`
SELECT
MAX(version_number) AS max_version
FROM script_versions
WHERE project_id = ?
`
)
.bind(project.id)
.first();

const nextVersion =
Number(
latest?.max_version || 0
) + 1;

/*
* -----------------------------------------------------
* Sanitize filename
* -----------------------------------------------------
*/

const safeFileName =
fileName
.replace(
/[^a-zA-Z0-9._ -]/g,
"_"
)
.replace(
/\s+/g,
"_"
);

/*
* -----------------------------------------------------
* Generate private R2 key
*
* Example:
*
* projects/
* we-before-me/
* scripts/
* v001/
* UUID-UNIT_1_.pdf
* -----------------------------------------------------
*/

const uniqueId =
crypto.randomUUID();

const fileKey =
`projects/${PROJECT_SLUG}/scripts/` +
`v${String(
nextVersion
).padStart(3, "0")}/` +
`${uniqueId}-${safeFileName}`;

/*
* -----------------------------------------------------
* Store PDF in private R2 bucket
* -----------------------------------------------------
*/

await env.FILES.put(
fileKey,
file.stream(),
{
httpMetadata: {
contentType:
"application/pdf",
},

customMetadata: {
project:
PROJECT_SLUG,

version:
String(
nextVersion
),

uploadedBy:
user.email,
},
}
);

/*
* -----------------------------------------------------
* Insert version into D1
* -----------------------------------------------------
*/

const notesText =
typeof notes === "string"
? notes.trim()
: "";

const inserted =
await env.DB.prepare(
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

const versionId =
inserted?.id;

/*
* -----------------------------------------------------
* Log upload
* -----------------------------------------------------
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
`${
user.name ||
user.email
} uploaded screenplay version ${nextVersion}.`,
versionId,
JSON.stringify({
file_name:
fileName,
version:
nextVersion,
})
)
.run();

return json(
{
ok: true,
message:
"Script uploaded successfully.",
version:
nextVersion,
version_id:
versionId,
file_name:
fileName,
},
201
);
}

/*
* -------------------------------------------------------
* GET /api/projects/we-before-me/comments
*
* Only comments belonging to the CURRENT screenplay
* version are returned.
* -------------------------------------------------------
*/

if (
path ===
`projects/${PROJECT_SLUG}/comments` &&
method === "GET"
) {
await requireUser(
request,
env
);

const project =
await getProject(env);

if (!project) {
return json(
{
ok: false,
error:
"Project not found",
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

const result =
await env.DB.prepare(
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
id:
latestVersion.id,

version_number:
latestVersion.version_number,

file_name:
latestVersion.file_name,
},

comments:
result.results || [],
});
}

/*
* -------------------------------------------------------
* POST /api/projects/we-before-me/comments
*
* Any authorized user can add comments.
* -------------------------------------------------------
*/

if (
path ===
`projects/${PROJECT_SLUG}/comments` &&
method === "POST"
) {
const user =
await requireUser(
request,
env
);

const project =
await getProject(env);

if (!project) {
return json(
{
ok: false,
error:
"Project not found",
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
body =
await request.json();
} catch {
return json(
{
ok: false,
error:
"Invalid JSON body",
},
400
);
}

const anchor =
body.anchor || {};

const page =
anchor.page !==
undefined
? Number(
anchor.page
)
: null;

const x =
anchor.x !==
undefined
? Number(
anchor.x
)
: null;

const y =
anchor.y !==
undefined
? Number(
anchor.y
)
: null;

const selectedText =
typeof body.selected_text ===
"string"
? body.selected_text.trim()
: "";

const commentBody =
typeof body.body ===
"string"
? body.body.trim()
: "";

if (!commentBody) {
return json(
{
ok: false,
error:
"Comment cannot be empty",
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

const inserted =
await env.DB.prepare(
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
selectedText ||
null,
commentBody
)
.first();

const commentId =
inserted?.id;

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
`${
user.name ||
user.email
} added a screenplay comment.`,
latestVersion.id,
JSON.stringify({
comment_id:
commentId,
})
)
.run();

return json(
{
ok: true,
message:
"Comment added successfully.",
comment_id:
commentId,
},
201
);
}
/*
* -------------------------------------------------------
* PATCH /api/projects/we-before-me/comments/:id
*
* Resolve / reopen a screenplay comment.
*
* Allowed:
* admin
* script_editor
*
* Reader cannot resolve/reopen comments.
* -------------------------------------------------------
*/

const commentMatch = path.match(
/^projects\/we-before-me\/comments\/(\d+)$/
);

if (
commentMatch &&
method === "PATCH"
) {
const user =
await requireUser(
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

const commentId =
Number(
commentMatch[1]
);

let body;

try {
body =
await request.json();
} catch {
return json(
{
ok: false,
error:
"Invalid JSON body",
},
400
);
}

if (
typeof body.resolved !==
"boolean"
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

/*
* Find the existing comment.
*/

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
error:
"Comment not found",
},
404
);
}

/*
* Update comment state.
*/

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
body.resolved
? 1
: 0,
commentId
)
.run();

/*
* Log the action.
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
existing.project_id,
user.id,

body.resolved
? "comment_resolved"
: "comment_reopened",

body.resolved
? `${
user.name ||
user.email
} resolved a screenplay comment.`
: `${
user.name ||
user.email
} reopened a screenplay comment.`,

existing.script_version_id,

JSON.stringify({
comment_id:
commentId,
})
)
.run();

return json({
ok: true,

message:
body.resolved
? "Comment resolved."
: "Comment reopened.",
});
}

/*
* -------------------------------------------------------
* ADMIN USER MANAGEMENT
*
* GET /api/admin/users
*
* Only admins can see the authorized-user list.
* -------------------------------------------------------
*/

if (
path === "admin/users" &&
method === "GET"
) {
const user =
await requireUser(
request,
env
);

if (!isAdmin(user)) {
return json(
{
ok: false,
error:
"Admin access required",
},
403
);
}

const result =
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

ORDER BY
active DESC,
name ASC,
email ASC
`
)
.all();

return json({
ok: true,
users:
result.results || [],
});
}

/*
* -------------------------------------------------------
* ADMIN USER MANAGEMENT
*
* POST /api/admin/users
*
* Creates a new authorized application user.
*
* The Google account does NOT automatically gain access
* merely by authenticating with Google.
*
* The account must exist in this table.
* -------------------------------------------------------
*/

if (
path === "admin/users" &&
method === "POST"
) {
const user =
await requireUser(
request,
env
);

if (!isAdmin(user)) {
return json(
{
ok: false,
error:
"Admin access required",
},
403
);
}

let body;

try {
body =
await request.json();
} catch {
return json(
{
ok: false,
error:
"Invalid JSON body",
},
400
);
}

const email =
typeof body.email ===
"string"
? body.email
.trim()
.toLowerCase()
: "";

const name =
typeof body.name ===
"string"
? body.name.trim()
: "";

const role =
typeof body.role ===
"string"
? body.role.trim()
: "reader";

/*
* Validate email.
*/

if (!email) {
return json(
{
ok: false,
error:
"Email is required",
},
400
);
}

/*
* Basic email validation.
*
* This is not intended to be a complete RFC email
* validator. It simply prevents obvious bad input.
*/

if (
!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
email
)
) {
return json(
{
ok: false,
error:
"Invalid email address",
},
400
);
}

/*
* Validate role.
*/

const allowedRoles = [
"admin",
"script_editor",
"reader",
];

if (
!allowedRoles.includes(
role
)
) {
return json(
{
ok: false,
error:
"Invalid role",
},
400
);
}

/*
* Check whether user already exists.
*/

const existing =
await env.DB.prepare(
`
SELECT
id,
email,
name,
role,
active
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

/*
* Insert authorized user.
*/

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

RETURNING
id,
email,
name,
role,
active,
created_at,
updated_at
`
)
.bind(
email,
name || null,
role
)
.first();

/*
* Log the user creation.
*
* Project ID 1 currently represents
* "We Before Me".
*/

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
user.id,
"user_added",
`${
user.name ||
user.email
} added ${
email
} as a ${
role
} user.`,
JSON.stringify({
added_user_id:
inserted.id,
email,
role,
})
)
.run();

return json(
{
ok: true,
message:
"User added successfully.",
user: inserted,
},
201
);
}

/*
* -------------------------------------------------------
* ADMIN USER MANAGEMENT
*
* PATCH /api/admin/users/:id
*
* Admin can:
*
* - change name
* - change role
* - activate user
* - deactivate user
*
* An admin cannot deactivate themselves.
*
* An admin also cannot remove their own admin role.
* -------------------------------------------------------
*/

const adminUserMatch =
path.match(
/^admin\/users\/(\d+)$/
);

if (
adminUserMatch &&
method === "PATCH"
) {
const user =
await requireUser(
request,
env
);

if (!isAdmin(user)) {
return json(
{
ok: false,
error:
"Admin access required",
},
403
);
}

const targetUserId =
Number(
adminUserMatch[1]
);

const targetUser =
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
.bind(targetUserId)
.first();

if (!targetUser) {
return json(
{
ok: false,
error:
"User not found",
},
404
);
}

let body;

try {
body =
await request.json();
} catch {
return json(
{
ok: false,
error:
"Invalid JSON body",
},
400
);
}

/*
* Start with existing values.
*/

let newName =
targetUser.name;

let newRole =
targetUser.role;

let newActive =
Number(
targetUser.active
);

/*
* Name
*/

if (
body.name !==
undefined
) {
if (
body.name === null
) {
newName = null;
} else if (
typeof body.name ===
"string"
) {
newName =
body.name.trim() ||
null;
} else {
return json(
{
ok: false,
error:
"name must be a string or null",
},
400
);
}
}

/*
* Role
*/

if (
body.role !==
undefined
) {
if (
typeof body.role !==
"string"
) {
return json(
{
ok: false,
error:
"role must be a string",
},
400
);
}

const allowedRoles = [
"admin",
"script_editor",
"reader",
];

if (
!allowedRoles.includes(
body.role
)
) {
return json(
{
ok: false,
error:
"Invalid role",
},
400
);
}

newRole =
body.role;
}

/*
* Active state
*/

if (
body.active !==
undefined
) {
if (
typeof body.active !==
"boolean"
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

newActive =
body.active ? 1 : 0;
}

/*
* Prevent self-lockout.
*/

if (
targetUser.id ===
user.id
) {
if (
newActive === 0
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
newRole !== "admin"
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
}

/*
* Apply update.
*/

await env.DB.prepare(
`
UPDATE users

SET
name = ?,
role = ?,
active = ?,
updated_at = datetime('now')

WHERE id = ?
`
)
.bind(
newName,
newRole,
newActive,
targetUserId
)
.run();

/*
* Get updated user.
*/

const updatedUser =
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
.bind(
targetUserId
)
.first();

/*
* Log administrative change.
*/

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
user.id,
"user_updated",
`${
user.name ||
user.email
} updated the access settings for ${
targetUser.email
}.`,
JSON.stringify({
target_user_id:
targetUser.id,

before: {
name:
targetUser.name,
role:
targetUser.role,
active:
targetUser.active,
},

after: {
name:
newName,
role:
newRole,
active:
newActive,
},
})
)
.run();

return json({
ok: true,
message:
"User updated successfully.",
user:
updatedUser,
});
}

/*
* -------------------------------------------------------
* IMPORTANT SECURITY RULE
*
* There are deliberately NO routes here for:
*
* GET /api/.../versions
* GET /api/.../script/:version
* GET /api/.../history
* GET /api/.../logs
*
* Normal users therefore cannot request previous
* screenplay versions through the application.
*
* Previous versions remain in private R2 and D1 for
* administrative/backend inspection.
* -------------------------------------------------------
*/

return json(
{
ok: false,
error: "Not found",
},
404
);

} catch (error) {
/*
* -------------------------------------------------------
* Expected authorization errors are already Responses.
* Return them directly.
* -------------------------------------------------------
*/

if (
error instanceof Response
) {
return error;
}

/*
* Unexpected server-side error.
*/

console.error(
error
);

return json(
{
ok: false,
error:
"Internal server error",
},
500
);
}
}
