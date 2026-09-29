// ============================================================
// Damaroo Storyboard Simulator — app.js  (v2)
// Real 3D scene (objects live in x/y/z), projected to a 2D frame.
// Deterministic: same config -> same frame. No AI, no random.
// World axes: +x = screen right, +y = up, +z = toward the camera.
// ============================================================
const CFG = await fetch("config.json").then(r => r.json());
const $ = id => document.getElementById(id);
const D2R = Math.PI / 180;
const INK = "#22252B", ACCENT = "#F5B301";

// ── STATE ───────────────────────────────────────────────────
let state = { showGrid: false, activeShot: null, selectedObj: null, shots: [] };

function loadFromStorage(){
  try {
    const raw = localStorage.getItem("damaroo_sb");
    if (raw){ const s = JSON.parse(raw); state.shots = s.shots || []; state.activeShot = s.activeShot ?? 0; }
  } catch(e){}
}
function saveToStorage(){
  try { localStorage.setItem("damaroo_sb", JSON.stringify({ shots: state.shots, activeShot: state.activeShot })); } catch(e){}
}
function makeShot(){
  return { id: Date.now(), label: "", objects: [],
    camera: { horizontal: "center", vertical: "eye-level", lens: "normal", shotScale: "wide" } };
}
const currentShot = () => state.shots[state.activeShot] ?? null;
const currentObj  = () => { const s = currentShot(); return s && state.selectedObj !== null ? s.objects[state.selectedObj] ?? null : null; };
const shotNumLabel = i => "SHOT " + String(i + 1).padStart(3, "0");
const byId = (arr, id, fallback) => arr.find(o => o.id === id) || arr[fallback];

// ── VECTOR MATH ─────────────────────────────────────────────
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const mul = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
const mid = (a, b) => mul(add(a, b), .5);
function bbox(pts){
  const lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
  pts.forEach(p => { for (let i = 0; i < 3; i++){ lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } });
  return { lo, hi, c: mid(lo, hi), w: hi[0]-lo[0], h: hi[1]-lo[1], d: hi[2]-lo[2] };
}

// ── SCENE LAYOUT ────────────────────────────────────────────
// Grid position = spot on the FLOOR (left/right, far/near).
// Depth layer = which slice of the room (back / mid / front). Different z => no gluing.
const GRID_POS = {
  "top-left":[0,0], "top-middle":[1,0], "top-right":[2,0],
  "middle-left":[0,1], "center":[1,1], "middle-right":[2,1],
  "bottom-left":[0,2], "bottom-middle":[1,2], "bottom-right":[2,2]
};
const COLX = [-2.6, 0, 2.6], ROWZ = [-1.4, 0, 1.4];
const DEPTH_Z = { background: -4.5, midground: 0, foreground: 3.5 };
// Which way an object FACES (yaw about the vertical axis). "right" faces screen-right.
const ORI = { front:0, right:90, back:180, left:-90, "three-quarter-right":45, "three-quarter-left":-45 };

function place(o){
  const [c, r] = GRID_POS[o.position] || [1, 1];
  return [COLX[c], 0, (DEPTH_Z[o.depth] ?? 0) + ROWZ[r]];
}

// ── 3D MODELS ───────────────────────────────────────────────
// Box parts: [cx, cy, cz, w, h, d, colour] in metres, front = +z.
const S = "#8A6F4E";
const PARTS = {
  bed:    [[0,.12,0,1.06,.24,2.06,"#B9A88C"],[0,.3,.02,1,.2,1.96,"#E8E4DC"],[0,.6,-1.03,1.06,.9,.06,S],[0,.45,-.7,.7,.1,.35,"#FFFFFF"]],
  chair:  [[0,.45,0,.5,.06,.5,"#DAD3C6"],[0,.78,-.22,.5,.6,.06,"#DAD3C6"],...[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,z]) => [x*.21,.21,z*.21,.05,.42,.05,S])],
  sofa:   [[0,.25,0,1.8,.3,.8,"#C9C3B8"],[0,.65,-.33,1.8,.5,.15,"#BDB7AB"],[-.85,.45,.05,.15,.4,.7,"#BDB7AB"],[.85,.45,.05,.15,.4,.7,"#BDB7AB"]],
  table:  [[0,.72,0,1.2,.06,.7,"#D8CDB8"],...[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,z]) => [x*.55,.36,z*.3,.06,.7,.06,S])],
  door:   [[0,1.02,0,.9,2.04,.06,"#E5E0D8"],[.32,1,.05,.06,.06,.05,"#8A8580"]],
  window: [[0,1.5,0,1.2,1,.08,S],[0,1.5,.045,1.04,.84,.02,"#CFE4F4"]],
  phone:  [[0,.25,0,.22,.45,.04,"#2A2825"],[0,.26,.022,.19,.38,.005,"#CFE4F4"]],
  laptop: [[0,.02,0,.5,.03,.35,"#BCBAB5"],[0,.22,-.16,.5,.4,.02,"#8C8A85"],[0,.22,-.148,.46,.34,.005,"#1F4E79"]],
  car:    [[0,.55,0,1.8,.6,4.2,"#C9C4BA"],[0,1.1,-.2,1.6,.5,2.2,"#8AB0D0"],...[[-1,-1],[1,-1],[-1,1],[1,1]].map(([x,z]) => [x*.9,.3,z*1.3,.2,.6,.6,"#4A4744"])]
};

function boxFaces(b){
  const [cx, cy, cz, w, h, d] = b, hs = [w/2, h/2, d/2], c = [cx, cy, cz], out = [];
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]){
    const u = (a+1)%3, v = (a+2)%3, q = [];
    for (const [su, sv] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
      const p = [0,0,0]; p[a] = c[a] + s*hs[a]; p[u] = c[u] + su*hs[u]; p[v] = c[v] + sv*hs[v]; q.push(p);
    }
    const n = [0,0,0]; n[a] = s; out.push({ n, q, color: b[6] });
  }
  return out;
}

// Character skeleton (local space, facing +z, ~1.75 m tall)
const POSES = {
  standing:  { hip:[0,.95,0],  neck:[0,1.5,0],  knee:[.1,.5,.03],  foot:[.11,0,.05],  fwd:[0,0,1], up:[0,1,0] },
  sitting:   { hip:[0,.5,0],   neck:[0,1.05,0], knee:[.1,.52,.42], foot:[.1,0,.45],   fwd:[0,0,1], up:[0,1,0] },
  crouching: { hip:[0,.42,-.05], neck:[0,.95,.12], knee:[.12,.55,.32], foot:[.12,0,.18], fwd:[0,0,1], up:[0,1,0] },
  sleeping:  { hip:[0,.1,0],   neck:[0,.1,.55], knee:[.09,.1,-.42], foot:[.1,.06,-.85], fwd:[0,1,0], up:[0,0,1] }
};
function charRig(pose, arms, woman){
  const P = POSES[pose] || POSES.standing, { hip, neck } = P, u = norm(sub(neck, hip));
  const head = add(neck, mul(u, .13)), sc = sub(neck, mul(u, .05));
  const sh = s => add(sc, [s*.2, 0, 0]), hp = s => add(hip, [s*.09, 0, 0]);
  const armFwd = (pose === "sitting" || pose === "crouching") ? [0, 0, .18] : [0, 0, 0];
  const raised = s => arms === "both-raised" || (arms === "one-raised" && s > 0);
  const segs = [[hip, neck], [neck, head], [sh(-1), sh(1)], [hp(-1), hp(1)]];
  for (const s of [-1, 1]){
    const a = sh(s), k = [s*P.knee[0], P.knee[1], P.knee[2]], f = [s*P.foot[0], P.foot[1], P.foot[2]];
    segs.push([a, raised(s) ? add(a, add(mul(u, .6), [s*.12, 0, .05])) : add(a, add(mul(u, -.58), add([s*.05, 0, 0], armFwd)))]);
    segs.push([hp(s), k], [k, f]);
  }
  let skirt = null;
  if (woman && pose !== "sleeping"){
    const m = s => { const k = [s*P.knee[0], P.knee[1], P.knee[2]]; return add(add(hp(s), mul(sub(k, hp(s)), .55)), [s*.1, 0, 0]); };
    skirt = [hp(-1), hp(1), m(1), m(-1)];
  }
  return { segs, head, skirt, fwd: P.fwd, up: P.up, hip };
}

function buildModel(o){
  const def = CFG.objects.find(x => x.id === o.type) || {};
  const k = (CFG.scale.find(s => s.id === o.scale)?.factor ?? .85) / .85;
  const yaw = (ORI[o.orientation] ?? 0) * D2R, cs = Math.cos(yaw), sn = Math.sin(yaw), pos = place(o);
  const R = v => [v[0]*cs + v[2]*sn, v[1], -v[0]*sn + v[2]*cs];
  const T = p => { const q = R(mul(p, k)); return [pos[0] + q[0], q[1], pos[2] + q[2]]; };

  if (def.category === "character"){
    const rig = charRig(o.pose || "standing", o.arms || "both-down", def.id === "woman");
    const m = { kind: "char", color: def.color || "#3B82C4", pos, expr: o.expression || "neutral",
      segs: rig.segs.map(s => [T(s[0]), T(s[1])]), skirt: rig.skirt && rig.skirt.map(T),
      headC: T(rig.head), headR: .11 * k, fwd: R(rig.fwd), up: R(rig.up), hipW: T(rig.hip) };
    m.pts = m.segs.flat().concat([add(m.headC, [0, m.headR, 0]), add(m.headC, [0, -m.headR, 0])]);
    m.bb = bbox(m.pts);
    return m;
  }
  const faces = (PARTS[o.type] || [[0,.3,0,.6,.6,.6,"#DDD"]]).flatMap(boxFaces)
    .map(f => ({ n: R(f.n), q: f.q.map(T), color: f.color }));
  const pts = faces.flatMap(f => f.q);
  return { kind: "obj", faces, pts, bb: bbox(pts), pos };
}

// ── CAMERA ──────────────────────────────────────────────────
// Horizontal = orbit left/right, Vertical = orbit up/down (top = looking down).
// Shot scale frames the subject: Wide = whole scene / full body,
// Medium = waist-up, Close = the face.
function makeCam(shot, models, W, H, sel){
  const c = shot.camera, cfg = CFG.camera;
  const az = byId(cfg.horizontal, c.horizontal, 2).angle * D2R;
  const pt = byId(cfg.vertical, c.vertical, 2).angle * D2R;
  const fov = 40 * D2R * byId(cfg.lens, c.lens, 1).fov;
  const fr = byId(cfg.shotScale, c.shotScale, 0).id;
  const asp = W / H, bb = bbox(models.flatMap(m => m.pts));
  const hero = models[sel] ?? models.find(m => m.kind === "char") ?? models[0];
  let tgt, vis;
  if (fr === "wide"){
    tgt = bb.c; vis = Math.max(1.8, bb.h * 1.35, Math.hypot(bb.w, bb.d) * 1.2 / asp);
  } else if (hero.kind === "char"){
    if (fr === "medium"){ tgt = mid(hero.hipW, hero.headC); vis = Math.max(1.1, Math.hypot(...sub(hero.headC, hero.hipW)) * 1.5); }
    else { tgt = hero.headC; vis = hero.headR * 4.4; }
  } else {
    const big = Math.max(hero.bb.w, hero.bb.h, hero.bb.d);
    tgt = hero.bb.c; vis = big * (fr === "medium" ? 1.1 : .5);
  }
  const t = Math.tan(fov / 2), dist = vis / 2 / t;
  const pos = add(tgt, mul([Math.sin(az)*Math.cos(pt), Math.sin(pt), Math.cos(az)*Math.cos(pt)], dist));
  const f = norm(sub(tgt, pos)), r = norm(cross(f, [0,1,0])), u = cross(r, f), foc = (H / 2) / t;
  const depth = P => dot(sub(P, pos), f);
  const p = P => { const v = sub(P, pos), d = dot(v, f); return d < .05 ? null : { x: W/2 + dot(v, r)*foc/d, y: H/2 - dot(v, u)*foc/d, s: foc/d, d }; };
  const line = (a, b) => { // near-plane clipped segment
    let da = depth(a), db = depth(b);
    if (da < .05 && db < .05) return null;
    if (da < .05) a = add(a, mul(sub(b, a), (.05 - da) / (db - da)));
    if (db < .05) b = add(b, mul(sub(a, b), (.05 - db) / (da - db)));
    return [p(a), p(b)];
  };
  return { pos, p, line, depth };
}

// ── RENDER ──────────────────────────────────────────────────
const LIGHT = norm([.35, .85, .45]);
function shade(hex, f){
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${[n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v * f))})`;
}
function polyPath(g, pts){ g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); }

function render(g, W, H, shot, opt = {}){
  g.save();
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
  g.lineCap = "round"; g.lineJoin = "round";
  if (!shot || !shot.objects.length){
    g.fillStyle = "#B5B8BF"; g.font = `${Math.max(11, W * .02)}px 'DM Mono', monospace`; g.textAlign = "center";
    g.fillText("Add objects to compose the frame", W / 2, H / 2); g.restore(); return;
  }
  const models = shot.objects.map(buildModel);
  const cam = makeCam(shot, models, W, H, opt.sel);

  // floor grid (skipped when the camera is below the floor)
  if (cam.pos[1] > .05){
    g.strokeStyle = "rgba(34,37,43,.10)"; g.lineWidth = Math.max(.6, W / 900);
    for (let i = -9; i <= 9; i++) for (const [a, b] of [[[i,0,-9],[i,0,9]], [[-9,0,i],[9,0,i]]]){
      const l = cam.line(a, b); if (!l) continue;
      g.beginPath(); g.moveTo(l[0].x, l[0].y); g.lineTo(l[1].x, l[1].y); g.stroke();
    }
  }
  // selection ring on the floor
  if (opt.sel != null && models[opt.sel]){
    const m = models[opt.sel], rad = Math.max(m.bb.w, m.bb.d) / 2 + .2, ring = [];
    for (let i = 0; i < 32; i++){ const a = i / 32 * Math.PI * 2; ring.push(cam.p([m.pos[0] + Math.cos(a)*rad, .01, m.pos[2] + Math.sin(a)*rad])); }
    if (ring.every(Boolean)){ polyPath(g, ring); g.strokeStyle = ACCENT; g.lineWidth = Math.max(1.5, W / 420); g.setLineDash([6, 5]); g.stroke(); g.setLineDash([]); }
  }
  // far -> near
  [...models].sort((a, b) => cam.depth(b.bb.c) - cam.depth(a.bb.c)).forEach(m => m.kind === "char" ? drawChar(g, m, cam) : drawObj(g, m, cam));

  if (opt.grid){
    g.strokeStyle = "rgba(185,28,28,.35)"; g.lineWidth = 1; g.setLineDash([5, 5]);
    for (let i = 1; i < 3; i++){ g.beginPath(); g.moveTo(W*i/3, 0); g.lineTo(W*i/3, H); g.moveTo(0, H*i/3); g.lineTo(W, H*i/3); g.stroke(); }
    g.setLineDash([]);
  }
  if (opt.label){
    g.fillStyle = "#9AA0AB"; g.font = `${Math.max(9, W * .016)}px 'DM Mono', monospace`;
    g.textAlign = "right"; g.textBaseline = "bottom"; g.fillText(opt.label, W - 10, H - 8);
  }
  g.restore();
}

function drawObj(g, m, cam){
  const items = [];
  m.faces.forEach(f => {
    const c = f.q.reduce((a, p) => add(a, p), [0,0,0]).map(v => v / 4);
    if (dot(f.n, sub(cam.pos, c)) <= 0) return;           // back-face
    const pp = f.q.map(cam.p); if (pp.some(x => !x)) return;
    items.push({ pp, d: cam.depth(c), f });
  });
  items.sort((a, b) => b.d - a.d).forEach(({ pp, f }) => {
    polyPath(g, pp);
    g.fillStyle = shade(f.color, .7 + .3 * Math.max(0, dot(f.n, LIGHT)));
    g.fill();
    g.strokeStyle = INK; g.lineWidth = Math.max(1, pp[0].s * .014); g.stroke();
  });
}

function drawChar(g, m, cam){
  g.strokeStyle = g.fillStyle = m.color;
  if (m.skirt){
    const pp = m.skirt.map(cam.p);
    if (pp.every(Boolean)){ g.globalAlpha = .28; polyPath(g, pp); g.fill(); g.globalAlpha = 1; }
  }
  m.segs.forEach(([a, b]) => {
    const l = cam.line(a, b); if (!l) return;
    g.lineWidth = Math.max(1.4, .05 * (l[0].s + l[1].s) / 2);
    g.beginPath(); g.moveTo(l[0].x, l[0].y); g.lineTo(l[1].x, l[1].y); g.stroke();
  });
  const hp = cam.p(m.headC); if (!hp) return;
  const r = m.headR * hp.s;
  g.beginPath(); g.arc(hp.x, hp.y, r, 0, Math.PI * 2);
  g.fillStyle = "#FFFFFF"; g.fill();
  const facing = dot(m.fwd, norm(sub(cam.pos, m.headC)));
  if (facing <= .05){ g.globalAlpha = .35; g.fillStyle = m.color; g.fill(); g.globalAlpha = 1; } // back/top of head = hair
  g.lineWidth = Math.max(1.4, .05 * hp.s); g.strokeStyle = m.color; g.stroke();
  if (facing <= .05) return;

  // face features are real 3D points on the head, so they foreshorten with the camera
  const X = norm(cross(m.up, m.fwd)), hr = m.headR;
  const fp = (x, y, f = .93) => cam.p(add(m.headC, add(mul(X, x*hr), add(mul(m.up, y*hr), mul(m.fwd, f*hr)))));
  g.fillStyle = m.color;
  [-.38, .38].forEach(x => { const e = fp(x, .12); if (e){ g.beginPath(); g.arc(e.x, e.y, Math.max(1, r * .08), 0, Math.PI * 2); g.fill(); } });
  const mouth = [];
  for (let i = -4; i <= 4; i++){
    const t = i / 4;
    const y = m.expr === "smile" ? -.55 + .28*t*t : m.expr === "sad" ? -.32 - .25*t*t : -.42;
    mouth.push(fp(t * .4, y, .9));
  }
  if (mouth.every(Boolean)){
    g.beginPath(); mouth.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
    g.lineWidth = Math.max(1, r * .07); g.stroke();
  }
}

// ── CANVAS ──────────────────────────────────────────────────
const canvas = $("storyboard-canvas"), ctx = canvas.getContext("2d");
function sizeCanvas(){
  const wrap = document.querySelector(".canvas-wrap");
  const maxW = wrap.clientWidth - 48, maxH = wrap.clientHeight - 24;
  let w = Math.min(maxW, maxH * 16 / 9), h = w * 9 / 16;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.width = Math.floor(w) + "px"; canvas.style.height = Math.floor(h) + "px";
  canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
  redraw();
}
function redraw(){
  const s = currentShot();
  render(ctx, canvas.width, canvas.height, s, { sel: state.selectedObj, grid: state.showGrid, label: s && (s.label || shotNumLabel(state.activeShot)) });
}
window.addEventListener("resize", sizeCanvas);

// ── CAMERA DIAGRAM (top view + side view) ───────────────────
function drawCamDiagram(){
  const c = $("cam-diagram-canvas"), g = c.getContext("2d"), W = c.width, H = c.height;
  const cam = currentShot()?.camera || {};
  const az = byId(CFG.camera.horizontal, cam.horizontal, 2).angle * D2R;
  const pt = byId(CFG.camera.vertical, cam.vertical, 2).angle * D2R;
  g.clearRect(0, 0, W, H);
  const view = (cx, cy, title, ang, top) => {
    const R = 32;
    g.strokeStyle = "#2F3542"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#8B93A3"; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    const x = top ? cx + R * Math.sin(ang) : cx - R * Math.cos(ang);
    const y = top ? cy + R * Math.cos(ang) : cy - R * Math.sin(ang);
    g.strokeStyle = ACCENT; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
    g.fillStyle = ACCENT; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#8B93A3"; g.font = "9px 'DM Mono', monospace"; g.textAlign = "center"; g.fillText(title, cx, H - 4);
  };
  view(W * .27, H / 2 - 3, "TOP VIEW", az, true);
  view(W * .73, H / 2 - 3, "SIDE VIEW", pt, false);
}

// ── UI BUILDERS ─────────────────────────────────────────────
function buildParamButtons(containerId, items, getter, setter){
  const el = $(containerId); el.innerHTML = "";
  items.forEach(item => {
    const b = document.createElement("button");
    b.className = "btn-param"; b.dataset.id = item.id; b.textContent = item.label;
    if (item.angle !== undefined) b.title = item.angle + "°";
    b.addEventListener("click", () => { setter(item.id); refreshAll(); });
    el.appendChild(b);
  });
  const val = getter();
  el.querySelectorAll(".btn-param").forEach(b => b.classList.toggle("active", b.dataset.id === val));
}

function buildCameraControls(){
  const cam = () => currentShot().camera;
  if (!currentShot()) return;
  buildParamButtons("ctrl-horizontal", CFG.camera.horizontal, () => cam().horizontal, v => cam().horizontal = v);
  buildParamButtons("ctrl-vertical",   CFG.camera.vertical,   () => cam().vertical,   v => cam().vertical = v);
  buildParamButtons("ctrl-lens",       CFG.camera.lens,       () => cam().lens,       v => cam().lens = v);
  buildParamButtons("ctrl-shotscale",  CFG.camera.shotScale,  () => cam().shotScale,  v => cam().shotScale = v);
}

function buildObjControls(){
  const obj = currentObj(), box = $("obj-controls");
  if (!obj){ box.style.display = "none"; return; }
  box.style.display = "";
  const def = CFG.objects.find(o => o.id === obj.type);
  $("obj-ctrl-title").textContent = def ? def.label : obj.type;
  document.querySelectorAll("#ctrl-position button").forEach(b => {
    b.classList.toggle("active", b.dataset.pos === obj.position);
    b.onclick = () => { obj.position = b.dataset.pos; refreshAll(); };
  });
  const set = k => v => { if (currentObj()) currentObj()[k] = v; };
  buildParamButtons("ctrl-depth", CFG.depth, () => currentObj()?.depth, set("depth"));
  buildParamButtons("ctrl-scale", CFG.scale, () => currentObj()?.scale, set("scale"));
  buildParamButtons("ctrl-orientation",
    (def?.orientations || ["front","back","left","right"]).map(id => ({ id, label: CFG.orientationLabels[id] || id })),
    () => currentObj()?.orientation, set("orientation"));
  const isChar = def?.category === "character";
  $("char-controls").style.display = isChar ? "" : "none";
  if (isChar){
    const opts = (list, labels) => (list || []).map(id => ({ id, label: labels[id] || id }));
    buildParamButtons("ctrl-pose", opts(def.poses, CFG.poseLabels), () => currentObj()?.pose, set("pose"));
    buildParamButtons("ctrl-arms", opts(def.arms, CFG.armLabels), () => currentObj()?.arms, set("arms"));
    buildParamButtons("ctrl-expression", opts(def.expressions, CFG.expressionLabels), () => currentObj()?.expression, set("expression"));
  }
}

function buildObjList(){
  const shot = currentShot(), list = $("obj-list");
  list.innerHTML = "";
  if (!shot || !shot.objects.length){
    list.innerHTML = `<div class="empty-hint">Nothing in this shot yet.<br>Use <b>+ Add Object</b> below.</div>`;
    $("btn-add-obj").disabled = false; return;
  }
  const lbl = (arr, id) => (arr.find(x => x.id === id) || {}).label || "—";
  shot.objects.forEach((obj, i) => {
    const def = CFG.objects.find(o => o.id === obj.type);
    const item = document.createElement("div");
    item.className = "obj-item" + (state.selectedObj === i ? " active" : "");
    item.innerHTML = `
      <div class="obj-item-dot" style="background:${(def && def.color) || "#8B93A3"}"></div>
      <div class="obj-item-info">
        <div class="obj-item-name">${def ? def.label : obj.type}</div>
        <div class="obj-item-meta">${lbl(CFG.depth, obj.depth)} · ${(obj.position || "").replace("-", " ")} · ${lbl(CFG.scale, obj.scale)}</div>
      </div>
      <button class="obj-item-del" title="Remove">×</button>`;
    item.querySelector(".obj-item-del").addEventListener("click", e => {
      e.stopPropagation(); shot.objects.splice(i, 1);
      state.selectedObj = shot.objects.length ? Math.min(state.selectedObj ?? 0, shot.objects.length - 1) : null;
      refreshAll();
    });
    item.addEventListener("click", () => { state.selectedObj = i; refreshAll(); });
    list.appendChild(item);
  });
  $("btn-add-obj").disabled = shot.objects.length >= 8;
}

function buildObjPicker(){
  const picker = $("obj-picker"); picker.innerHTML = "";
  CFG.objects.forEach(def => {
    const item = document.createElement("div");
    item.className = "obj-picker-item";
    item.innerHTML = `<span>${def.label}</span><span class="obj-picker-cat">${def.category}</span>`;
    item.addEventListener("click", () => { addObject(def); picker.style.display = "none"; });
    picker.appendChild(item);
  });
}

function addObject(def){
  const shot = currentShot(); if (!shot || shot.objects.length >= 8) return;
  // spread new objects across the floor so they never spawn glued together
  const spots = ["center", "middle-left", "middle-right", "top-middle", "bottom-middle", "top-left", "top-right", "bottom-left"];
  const o = { type: def.id, position: spots[shot.objects.length % spots.length], depth: "midground", scale: "medium",
              orientation: def.orientations?.[0] || "front" };
  if (def.category === "character"){ o.pose = "standing"; o.arms = "both-down"; o.expression = "neutral"; }
  shot.objects.push(o);
  state.selectedObj = shot.objects.length - 1;
  refreshAll();
}

// ── TIMELINE ────────────────────────────────────────────────
function buildTimeline(){
  const strip = $("timeline-strip"); strip.innerHTML = "";
  state.shots.forEach((shot, i) => {
    const wrap = document.createElement("div");
    wrap.className = "shot-thumb" + (i === state.activeShot ? " active" : "");
    wrap.innerHTML = `<canvas class="shot-thumb-canvas" width="240" height="135"></canvas>
      <div class="shot-thumb-label">${shot.label || shotNumLabel(i)}</div>
      <div class="shot-thumb-actions">
        <button class="shot-thumb-btn" data-a="dup" title="Duplicate">⧉</button>
        <button class="shot-thumb-btn" data-a="del" title="Delete">×</button>
      </div>`;
    const tc = wrap.querySelector("canvas");
    render(tc.getContext("2d"), tc.width, tc.height, shot);
    wrap.addEventListener("click", e => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "dup") return duplicateShot(i);
      if (a === "del") return deleteShot(i);
      state.activeShot = i; state.selectedObj = null; refreshAll();
    });
    strip.appendChild(wrap);
  });
}
function newShot(){ state.shots.push(makeShot()); state.activeShot = state.shots.length - 1; state.selectedObj = null; refreshAll(); }
function duplicateShot(i){
  const c = JSON.parse(JSON.stringify(state.shots[i])); c.id = Date.now(); c.label = "";
  state.shots.splice(i + 1, 0, c); state.activeShot = i + 1; state.selectedObj = null; refreshAll();
}
function deleteShot(i){
  if (state.shots.length === 1) return;
  state.shots.splice(i, 1);
  state.activeShot = Math.min(state.activeShot, state.shots.length - 1); state.selectedObj = null; refreshAll();
}

// ── HEADER / INFO ───────────────────────────────────────────
function updateShotLabel(){
  const el = $("shot-label"), s = currentShot();
  el.textContent = s.label || shotNumLabel(state.activeShot);
  el.contentEditable = "true"; el.title = "Click to rename";
  el.onblur = () => { s.label = el.textContent.trim(); refreshAll(); };
  el.onkeydown = e => { if (e.key === "Enter"){ e.preventDefault(); el.blur(); } };
  const c = s.camera, cf = CFG.camera, L = (a, id, f) => byId(a, id, f);
  const h = L(cf.horizontal, c.horizontal, 2), v = L(cf.vertical, c.vertical, 2);
  $("shot-info").textContent = [L(cf.shotScale, c.shotScale, 0).label, `${h.label} ${h.angle}°`, `${v.label} ${v.angle}°`, L(cf.lens, c.lens, 1).label].join("  ·  ");
}

function refreshAll(){
  if (!currentShot()) return;
  updateShotLabel(); buildCameraControls(); buildObjControls(); buildObjList(); buildTimeline(); redraw(); drawCamDiagram(); saveToStorage();
}

// ── EXPORT ──────────────────────────────────────────────────
function download(href, name){ const a = document.createElement("a"); a.download = name; a.href = href; a.click(); }
function exportPNG(){
  const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
  render(c.getContext("2d"), 1920, 1080, currentShot(), { label: currentShot().label || shotNumLabel(state.activeShot) });
  download(c.toDataURL("image/png"), (currentShot().label || shotNumLabel(state.activeShot)) + ".png");
}
function exportSheet(){
  const cols = Math.min(state.shots.length, 3), rows = Math.ceil(state.shots.length / cols);
  const sw = 640, sh = 360, pad = 24, lh = 28;
  const ec = document.createElement("canvas");
  ec.width = cols * (sw + pad) + pad; ec.height = rows * (sh + lh + pad) + pad;
  const g = ec.getContext("2d"); g.fillStyle = "#F4F2EC"; g.fillRect(0, 0, ec.width, ec.height);
  state.shots.forEach((shot, i) => {
    const x = pad + (i % cols) * (sw + pad), y = pad + Math.floor(i / cols) * (sh + lh + pad);
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, sw, sh); g.clip();
    render(g, sw, sh, shot); g.restore();
    g.strokeStyle = INK; g.lineWidth = 1.5; g.strokeRect(x, y, sw, sh);
    g.fillStyle = INK; g.font = "bold 13px 'DM Mono', monospace"; g.textAlign = "left";
    g.fillText(shot.label || shotNumLabel(i), x, y + sh + 19);
  });
  download(ec.toDataURL("image/png"), "storyboard-sheet.png");
}

// ── EVENTS ──────────────────────────────────────────────────
$("btn-toggle-grid").addEventListener("click", function(){ state.showGrid = !state.showGrid; this.classList.toggle("on", state.showGrid); redraw(); });
$("btn-add-obj").addEventListener("click", () => { const p = $("obj-picker"); p.style.display = p.style.display === "none" ? "" : "none"; });
document.addEventListener("click", e => { if (!e.target.closest(".add-obj-wrap")) $("obj-picker").style.display = "none"; });
$("btn-save-shot").addEventListener("click", () => {
  saveToStorage(); const b = $("btn-save-shot"); b.textContent = "Saved ✓"; setTimeout(() => b.textContent = "Save Shot", 1200);
});
$("btn-new-shot").addEventListener("click", newShot);
$("btn-duplicate-shot").addEventListener("click", () => duplicateShot(state.activeShot));
$("btn-export-png").addEventListener("click", exportPNG);
$("btn-export-sheet").addEventListener("click", exportSheet);

// ── INIT ────────────────────────────────────────────────────
loadFromStorage();
if (!state.shots.length){ state.shots.push(makeShot()); state.activeShot = 0; }
state.activeShot = Math.min(state.activeShot ?? 0, state.shots.length - 1);
buildObjPicker(); sizeCanvas(); refreshAll();
