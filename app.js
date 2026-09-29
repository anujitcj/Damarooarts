/* Damaroo Storyboard Simulator
   Step 1: choose the camera against a labelled GOD reference figure.
   Step 2: place up to 3 objects. Paint order = order added (first is the background). */
const W = 960, H = 540, D = Math.PI / 180, MAX_OBJ = 3;
const $ = s => document.querySelector(s);
const cv = $('#storyboard-canvas'), g = cv.getContext('2d');
const S = { step: 0, cam: { az: 25, el: 30, lens: 1, shot: 1 }, obs: [], sel: -1, shots: [], cur: -1, grid: false, hide: false, label: 'SHOT 001' };
const BB = [];            // screen bounding box per object, refreshed on every render
let CFG, OBJ, drag = null;

/* ---------- helpers ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = v => ((v + 540) % 360) - 180;
const nice = s => s.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const clone = o => JSON.parse(JSON.stringify(o));
const num = n => 'SHOT ' + String(n).padStart(3, '0');
const shade = (h, f) => '#' + [1, 3, 5].map(i => clamp(Math.round(parseInt(h.substr(i, 2), 16) * f), 0, 255).toString(16).padStart(2, '0')).join('');
const seg = (k, items, cur, wrapCls = '') =>
  `<div class="btn-row ${wrapCls}" data-k="${k}">` + items.map(([l, v]) => `<button class="btn-param${v == cur ? ' active' : ''}" data-v="${v}">${l}</button>`).join('') + '</div>';

/* ---------- camera ---------- */
/* The lens changes the field of view AND the camera distance, so the subject keeps its size
   and you see the real perspective difference between wide and tele. */
function cam() {
  const c = S.cam, K = CFG.camera, fov = K.lens[c.lens].fov * D;
  const d = K.shotScale[c.shot].factor * Math.tan(21 * D) / Math.tan(fov / 2), az = c.az * D, el = c.el * D, T = [0, .9, 0];
  const p = [d * Math.cos(el) * Math.sin(az), T[1] + d * Math.sin(el), d * Math.cos(el) * Math.cos(az)];
  const f = nrm(sub(T, p)), r = nrm(crs(f, [0, 1, 0])), u = crs(r, f);
  return { p, f, r, u, t: Math.tan(fov / 2) };
}
const pr = (C, v) => { const d = sub(v, C.p), z = dot(d, C.f), k = (H / 2) / C.t / z; return [W / 2 + dot(d, C.r) * k, H / 2 - dot(d, C.u) * k, z, k]; };
function floorHit(C, sx, sy) {             // screen point -> floor (x,z)
  const nx = (sx - W / 2) / (H / 2) * C.t, ny = -(sy - H / 2) / (H / 2) * C.t;
  const d = [0, 1, 2].map(i => C.f[i] + C.r[i] * nx + C.u[i] * ny);
  if (d[1] >= -1e-4) return null;
  const s = -C.p[1] / d[1];
  return s > 0 ? [C.p[0] + d[0] * s, C.p[2] + d[2] * s] : null;
}

/* ---------- box geometry: [cx,cy,cz,w,h,d,color,labels] ---------- */
const FI = [[1, 3, 7, 5], [0, 2, 6, 4], [2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 7, 6], [0, 1, 3, 2]];
const NRM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const LB = { 0: [5, 1, 7], 1: [0, 4, 2], 2: [6, 7, 2], 4: [4, 5, 6], 5: [1, 0, 3] };
const LIGHT = nrm([-.4, .8, .5]);
function faces(bx, pos, yaw, sc) {
  const out = [], cs = Math.cos(yaw), sn = Math.sin(yaw);
  const T = (x, y, z) => [pos[0] + sc * (x * cs + z * sn), sc * y, pos[2] + sc * (-x * sn + z * cs)];
  for (const [cx, cy, cz, w, h, d, col, lab] of bx) {
    const vs = [];
    for (let i = 0; i < 8; i++) vs.push(T(cx + ((i & 1) - .5) * w, cy + ((i >> 1 & 1) - .5) * h, cz + ((i >> 2 & 1) - .5) * d));
    FI.forEach((f, fi) => {
      const n = NRM[fi], nw = [n[0] * cs + n[2] * sn, n[1], -n[0] * sn + n[2] * cs], v = f.map(i => vs[i]);
      out.push({ v, vs, fi, n: nw, c: [0, 1, 2].map(k => (v[0][k] + v[2][k]) / 2), col, lab: lab && lab[fi] });
    });
  }
  return out;
}
function draw(C, fs) {
  let b = [1e9, 1e9, -1e9, -1e9];
  const dist = f => { const d = sub(f.c, C.p); return dot(d, d); };
  fs.filter(f => dot(f.n, sub(f.c, C.p)) < 0).sort((a, b) => dist(b) - dist(a)).forEach(f => {
    const P = f.v.map(v => pr(C, v));
    if (P.some(p => p[2] < .2)) return;
    g.beginPath();
    P.forEach((p, i) => { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; });
    g.closePath();
    g.fillStyle = shade(f.col, .55 + .45 * Math.max(0, dot(f.n, LIGHT))); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
    if (f.lab) {                            // text laid onto the face in perspective
      const [a, bb, c] = LB[f.fi].map(i => pr(C, f.vs[i]));
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.transform((bb[0] - a[0]) / 100, (bb[1] - a[1]) / 100, (a[0] - c[0]) / 100, (a[1] - c[1]) / 100, c[0], c[1]);
      g.fillStyle = '#111'; g.font = 'bold 21px ui-monospace,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.lab, 50, 50);
      g.restore();
    }
  });
  return b;
}

/* ---------- object library (built from config ids) ---------- */
const SK = '#E8C39E', PA = '#3F4756', WD = '#B08968', HAIR = '#2b1d14', NOSE = '#c9a07a';
const pair = (x, ...r) => [[-x, ...r], [x, ...r]];
const q4 = (x, y, z, ...r) => [[-x, y, -z, ...r], [x, y, -z, ...r], [-x, y, z, ...r], [x, y, z, ...r]];
function person(col, wm, o) {
  const pose = o.pose, ex = o.expr, ar = o.arms, slp = pose == 'sleeping';
  const arm = (x, up) => {
    if (slp) return [x, .15, up ? -.62 : .05, .13, .16, .62, col];
    const [sy, z] = { standing: [1.44, 0], sitting: [1.14, .02], crouching: [1.2, .1] }[pose];
    return up ? [x, sy + .28, z, .13, .62, .16, col] : [x, sy - .3, z, .13, .62, .16, col];
  };
  const B = {
    standing: { p: [...pair(.13, .4, 0, .22, .8, .24, PA), [0, 1.13, 0, .52, .66, .28, col]], h: [1.58, 0] },
    sitting: { p: [...pair(.13, .45, .22, .22, .2, .5, PA), ...pair(.13, .22, .45, .2, .44, .2, PA), [0, .83, 0, .52, .66, .28, col]], h: [1.31, 0] },
    crouching: { p: [...pair(.13, .45, .2, .22, .22, .45, PA), ...pair(.13, .25, .42, .2, .5, .2, PA), [0, .9, .05, .52, .6, .28, col]], h: [1.35, .08] },
    sleeping: { p: [...pair(.12, .12, .75, .2, .22, .8, PA), [0, .15, 0, .52, .28, .66, col]], h: [.16, -.5] }
  }[pose];
  const [hy, hz] = B.h;
  // face features sit on the front of the head (or on top when lying down)
  const f = (x, dy, w, h) => slp ? [x, hy + .145, hz - dy, w, .02, h, '#111'] : [x, hy + dy, hz + .145, w, h, .02, '#111'];
  const mouth = ex == 'smile' ? [f(0, -.07, .1, .02), f(-.06, -.05, .02, .03), f(.06, -.05, .02, .03)]
    : ex == 'sad' ? [f(0, -.09, .1, .02), f(-.06, -.11, .02, .03), f(.06, -.11, .02, .03)] : [f(0, -.08, .1, .02)];
  return [
    ...B.p, arm(-.35, ar == 'both-raised'), arm(.35, ar != 'both-down'),
    [0, hy, hz, .28, .28, .28, SK],
    slp ? [0, hy + .16, hz + .02, .06, .06, .06, NOSE] : [0, hy - .02, hz + .16, .06, .06, .06, NOSE],
    f(-.06, .04, .04, .04), f(.06, .04, .04, .04), ...mouth,
    slp ? [0, hy + .02, hz - .16, .3, .3, .08, HAIR] : [0, hy + .15, hz - .01, .3, .07, .3, HAIR],
    ...(wm && !slp ? [[0, hy - .05, hz - .14, .3, .34, .08, HAIR]] : [])
  ];
}
const BUILD = {
  man: o => person('#3B82C4', 0, o), woman: o => person('#D45B8C', 1, o),
  chair: () => [[0, .45, 0, .5, .08, .5, WD], ...q4(.2, .2, .2, .06, .4, .06, WD), [0, .8, -.22, .5, .7, .06, WD]],
  table: () => [[0, .75, 0, 1.4, .08, .8, WD], ...q4(.6, .36, .32, .08, .72, .08, WD)],
  sofa: () => [[0, .25, 0, 1.8, .5, .8, '#7C6A8F'], [0, .7, -.32, 1.8, .5, .16, '#6B5A7E'], ...pair(.85, .5, .05, .16, .4, .7, '#6B5A7E')],
  bed: () => [[0, .25, 0, 1, .4, 2, WD], [0, .5, 0, .96, .16, 1.9, '#DDE3EA'], [0, .62, -.75, .6, .12, .3, '#fff'], [0, .65, -1, 1, .6, .08, WD]],
  car: () => [[0, .4, 0, 1.7, .5, 4, '#C0392B'], [0, .85, -.1, 1.5, .5, 2, '#A93226'], [0, .85, .92, 1.4, .4, .06, '#9CC7E6'], ...q4(.85, .3, 1.3, .2, .6, .6, '#222')],
  door: () => [[0, 1, 0, 1, 2, .12, '#8B5E3C'], [.35, 1, .09, .08, .08, .1, '#D4AF37']],
  window: () => [[0, 1.4, 0, 1.3, 1.1, .1, '#E5E7EB'], [0, 1.4, .03, 1.1, .9, .06, '#9CC7E6']],
  phone: () => [[0, .2, 0, .22, .4, .04, '#1F2937'], [0, .2, .023, .19, .35, .01, '#7DD3FC'], [0, .06, .025, .06, .02, .01, '#374151']],
  laptop: () => [[0, .03, .1, .6, .04, .42, '#9CA3AF'], [0, .28, -.1, .6, .46, .03, '#374151'], [0, .28, -.083, .54, .4, .01, '#7DD3FC']]
};
const GOD = [
  [0, .6, 0, 1.3, 1.2, 1.3, '#9CA3AF', { 4: 'FRONT', 5: 'BACK', 0: 'RIGHT', 1: 'LEFT' }],
  [0, 1.55, 0, .7, .7, .7, '#D1D5DB', { 2: 'TOP' }], [0, 1.5, .42, .16, .16, .16, '#F5B301']
];

/* ---------- scene rendering ---------- */
function ln(C, a, b) {
  const za = dot(sub(a, C.p), C.f), zb = dot(sub(b, C.p), C.f);
  if (za < .2 && zb < .2) return;
  if (za < .2) a = lerp(a, b, (.2 - za) / (zb - za)); else if (zb < .2) b = lerp(b, a, (.2 - zb) / (za - zb));
  const p = pr(C, a), q = pr(C, b); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
}
function floor(C) {
  g.strokeStyle = '#DAD8D1'; g.lineWidth = 1; g.beginPath();
  for (let i = -10; i <= 10; i++) { ln(C, [i, 0, -10], [i, 0, 10]); ln(C, [-10, 0, i], [10, 0, i]); }
  g.stroke();
}
function ring(C) {                          // angle ring around the GOD figure
  g.strokeStyle = '#F5B301'; g.lineWidth = 2; g.beginPath();
  for (let a = 0; a < 64; a++) ln(C, [3 * Math.sin(a / 64 * 6.283), 0, 3 * Math.cos(a / 64 * 6.283)], [3 * Math.sin((a + 1) / 64 * 6.283), 0, 3 * Math.cos((a + 1) / 64 * 6.283)]);
  g.stroke();
  for (let a = -180; a < 180; a += 45) {
    const p = pr(C, [3.5 * Math.sin(a * D), 0, 3.5 * Math.cos(a * D)]); if (p[2] < .5) continue;
    g.font = 'bold ' + clamp(.3 * p[3], 10, 26) + 'px ui-monospace,monospace'; g.fillStyle = '#B45309'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a + '°', p[0], p[1]);
  }
}
function objFaces(o) {                      // camera-relative facing; size normalised so config "medium" = 1
  return faces(BUILD[o.t](o), [o.x, 0, o.z], (S.cam.az + o.rel) * D, CFG.scale[o.s].factor / .85);
}
function render(clean) {
  const C = cam();
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); floor(C);
  BB.length = 0;
  if (S.step == 0 && !clean) { ring(C); draw(C, faces(GOD, [0, 0, 0], 0, 1)); }
  S.obs.forEach((o, i) => {                 // painter order = layer order: first added is furthest back
    if (!clean && S.hide && S.step == 1 && S.sel >= 0 && i < S.sel) return;
    BB[i] = draw(C, objFaces(o));
  });
  if (!clean) {
    if (S.step == 1 && BB[S.sel]) { const b = BB[S.sel]; g.strokeStyle = '#F5B301'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(b[0] - 6, b[1] - 6, b[2] - b[0] + 12, b[3] - b[1] + 12); g.setLineDash([]); }
    if (S.grid) { g.strokeStyle = 'rgba(245,179,1,.7)'; g.lineWidth = 1; g.beginPath(); for (let i = 1; i < 3; i++) { g.moveTo(W * i / 3, 0); g.lineTo(W * i / 3, H); g.moveTo(0, H * i / 3); g.lineTo(W, H * i / 3); } g.stroke(); }
    const K = CFG.camera;
    $('#shot-info').textContent = `az ${S.cam.az}° · el ${S.cam.el}° · ${K.lens[S.cam.lens].label} lens · ${K.shotScale[S.cam.shot].label} shot · ${S.obs.length}/${MAX_OBJ} objects`;
  }
}

/* ---------- camera panel ---------- */
const pCam = $('#pan-cam'), pObj = $('#pan-obj');
function buildCam() {
  const K = CFG.camera;
  pCam.innerHTML = `<div class="ctrl-section-title">Camera</div>
  <div class="ctrl-hint" style="margin:-4px 0 14px">The block in the frame is the reference figure. Its faces and the floor ring show the angle you are looking from. Drag the frame to orbit.</div>
  <div class="ctrl-group"><div class="ctrl-label">Horizontal angle</div>${seg('h', K.horizontal.map(o => [o.label, o.angle]), S.cam.az, 'flex-wrap')}
    <div class="slider-row"><input type="range" id="sl-az" min="-180" max="180"><b id="v-az"></b></div></div>
  <div class="ctrl-group"><div class="ctrl-label">Vertical angle</div>${seg('v', K.vertical.map(o => [o.label, o.angle]), S.cam.el, 'flex-wrap')}
    <div class="slider-row"><input type="range" id="sl-el" min="-60" max="85"><b id="v-el"></b></div></div>
  <div class="ctrl-group"><div class="ctrl-label">Lens</div>${seg('lens', K.lens.map((o, i) => [o.label, i]), S.cam.lens)}</div>
  <div class="ctrl-group"><div class="ctrl-label">Shot size</div>${seg('shot', K.shotScale.map((o, i) => [o.label, i]), S.cam.shot)}</div>
  <div class="ctrl-group"><div class="ctrl-label">Camera position (top view, drag to move)</div><canvas id="cam-map" width="240" height="240"></canvas></div>`;
}
function drawMap() {
  const m = $('#cam-map').getContext('2d'), c = 120, R = 92;
  m.clearRect(0, 0, 240, 240); m.fillStyle = '#1C2028'; m.fillRect(0, 0, 240, 240);
  m.strokeStyle = '#2A2F3A'; m.beginPath(); m.arc(c, c, R, 0, 7); m.stroke();
  m.fillStyle = '#5D6473'; m.font = '9px monospace'; m.textAlign = 'center';
  for (let a = -180; a < 180; a += 45) m.fillText(a + '°', c + (R + 14) * Math.sin(a * D), c + (R + 14) * Math.cos(a * D) + 3);
  m.fillStyle = '#9CA3AF'; m.fillRect(c - 9, c - 9, 18, 18); m.fillStyle = '#F5B301'; m.fillRect(c - 3, c + 9, 6, 4);
  const a = S.cam.az * D, x = c + R * Math.sin(a), y = c + R * Math.cos(a);
  const hf = Math.atan(Math.tan(CFG.camera.lens[S.cam.lens].fov * D / 2) * 16 / 9), b = Math.atan2(c - y, c - x);
  m.strokeStyle = '#F5B301'; m.beginPath();
  [-hf, hf].forEach(s => { m.moveTo(x, y); m.lineTo(x + 70 * Math.cos(b + s), y + 70 * Math.sin(b + s)); }); m.stroke();
  m.fillStyle = '#F5B301'; m.beginPath(); m.arc(x, y, 7, 0, 7); m.fill();
}
function syncCam() {
  const c = S.cam;
  $('#sl-az').value = c.az; $('#sl-el').value = c.el; $('#v-az').textContent = c.az + '°'; $('#v-el').textContent = c.el + '°';
  pCam.querySelectorAll('.btn-row').forEach(r => {
    const k = r.dataset.k, cur = k == 'h' ? c.az : k == 'v' ? c.el : c[k];
    r.querySelectorAll('.btn-param').forEach(b => b.classList.toggle('active', +b.dataset.v == cur));
  });
  drawMap(); render();
}
pCam.addEventListener('click', e => {
  const b = e.target.closest('.btn-param'); if (!b) return;
  const k = b.parentNode.dataset.k; S.cam[k == 'h' ? 'az' : k == 'v' ? 'el' : k] = +b.dataset.v; syncCam();
});
pCam.addEventListener('input', e => {
  if (e.target.id == 'sl-az') S.cam.az = +e.target.value;
  if (e.target.id == 'sl-el') S.cam.el = +e.target.value;
  syncCam();
});
let mapDown = false;
const mapMove = e => { const m = $('#cam-map'), r = m.getBoundingClientRect(), k = 240 / r.width; S.cam.az = Math.round(Math.atan2((e.clientX - r.left) * k - 120, (e.clientY - r.top) * k - 120) / D); syncCam(); };
pCam.addEventListener('pointerdown', e => { if (e.target.id != 'cam-map') return; mapDown = true; e.target.setPointerCapture(e.pointerId); mapMove(e); });
pCam.addEventListener('pointermove', e => mapDown && mapMove(e));
pCam.addEventListener('pointerup', () => mapDown = false);

/* ---------- object panels ---------- */
const CELLS = [[0, 0, 'TL'], [1, 0, 'T'], [2, 0, 'TR'], [0, 1, 'L'], [1, 1, '●'], [2, 1, 'R'], [0, 2, 'BL'], [1, 2, 'B'], [2, 2, 'BR']];
const cellXD = (c, r) => [(c - 1) * 2.4, (1 - r) * 2.2];                 // camera-relative: x right, depth away
function toWorld(x, dp) { const a = S.cam.az * D; return [x * Math.cos(a) - dp * Math.sin(a), -x * Math.sin(a) - dp * Math.cos(a)]; }
function toCamRel(wx, wz) { const a = S.cam.az * D; return [wx * Math.cos(a) - wz * Math.sin(a), -wx * Math.sin(a) - wz * Math.cos(a)]; }
const isChar = o => OBJ[o.t].category == 'character';
function buildObj() {
  const o = S.obs[S.sel];
  if (!o) { pObj.innerHTML = `<div class="ctrl-section-title">Object</div><div class="empty-hint">${S.obs.length ? 'Click an object on the frame<br>or in the list to edit it.' : 'Add your first object.<br>It becomes the <b>background</b> layer.'}</div>`; return; }
  const [rx, dp] = toCamRel(o.x, o.z);
  let best = null, bd = .9; CELLS.forEach(([c, r]) => { const [cx, cd] = cellXD(c, r), d = Math.hypot(cx - rx, cd - dp); if (d < bd) { bd = d; best = c + ',' + r; } });
  const rel = CFG.orientationLabels || {};
  const REL = [['Front', 0], ['¾ Right', 45], ['Right', 90], ['¾ Back R', 135], ['Back', 180], ['¾ Back L', -135], ['Left', -90], ['¾ Left', -45]];
  let h = `<div class="ctrl-section-title">${OBJ[o.t].label} · layer ${S.sel + 1}</div>
  <div class="ctrl-group"><div class="ctrl-label">Position on floor</div>
    <div class="ctrl-hint">Drag the object on the frame to move it, or click here.</div>
    <div class="grid-picker" style="margin-top:8px">${CELLS.map(([c, r, t]) => `<button data-pos="${c},${r}" class="${best == c + ',' + r ? 'active' : ''}">${t}</button>`).join('')}</div></div>
  <div class="ctrl-group"><div class="ctrl-label">Size</div>${seg('s', CFG.scale.map((x, i) => [x.label, i]), o.s)}</div>
  <div class="ctrl-group"><div class="ctrl-label">Facing (relative to camera)</div>${seg('rel', REL.map(([l, v]) => [l, v]), o.rel, 'flex-wrap')}</div>`;
  if (isChar(o)) {
    const c = OBJ[o.t];
    h += `<div class="ctrl-group"><div class="ctrl-label">Pose</div>${seg('pose', c.poses.map(p => [nice(p), p]), o.pose, 'flex-wrap')}</div>
    <div class="ctrl-group"><div class="ctrl-label">Arms</div>${seg('arms', c.arms.map(p => [nice(p), p]), o.arms, 'flex-wrap')}</div>
    <div class="ctrl-group"><div class="ctrl-label">Expression</div>${seg('expr', c.expressions.map(p => [nice(p), p]), o.expr)}</div>`;
  }
  h += `<div class="ctrl-group" style="padding-top:10px;border-top:1px solid var(--line)"><div class="ctrl-label">Layer visibility</div>
    <button class="btn-layer-toggle${S.hide ? ' active' : ''}" id="btn-hide-below" title="Hide objects behind the selected one">Hide Behind</button>
    <div class="ctrl-hint">Ctrl+drag on the frame to orbit the camera.</div></div>`;
  pObj.innerHTML = h;
}
pObj.addEventListener('click', e => {
  const b = e.target.closest('button'), o = S.obs[S.sel]; if (!b || !o) return;
  if (b.dataset.pos) { const [c, r] = b.dataset.pos.split(',').map(Number), [x, dp] = cellXD(c, r); [o.x, o.z] = toWorld(x, dp); }
  else if (b.id == 'btn-hide-below') S.hide = !S.hide;
  else if (b.parentNode.dataset.k) { const k = b.parentNode.dataset.k; o[k] = (k == 's' || k == 'rel') ? +b.dataset.v : b.dataset.v; }
  refresh();
});

/* right panel: scene object list + picker */
function renderList() {
  const n = S.obs.length, layer = i => i == 0 ? 'Background' : i == n - 1 ? 'Foreground' : 'Middle';
  $('#obj-count').textContent = n + '/' + MAX_OBJ;
  $('#obj-list').innerHTML = n ? S.obs.map((o, i) => `<div class="obj-item${i == S.sel ? ' active' : ''}" data-sel="${i}">
    <span class="obj-item-layer">${i + 1}</span><div class="obj-item-info"><div class="obj-item-name">${OBJ[o.t].label}</div>
    <div class="obj-item-meta">${layer(i)}${isChar(o) ? ' · ' + nice(o.pose) + ' · ' + nice(o.expr) : ''}</div></div>
    <button class="obj-item-del" data-del="${i}" title="Remove">×</button></div>`).join('') : '<div class="empty-hint">No objects yet.</div>';
  $('#btn-add-obj').disabled = n >= MAX_OBJ;
  $('#btn-add-obj').textContent = n >= MAX_OBJ ? 'Maximum 3 objects' : '+ Add Object';
}
function refresh() { buildObj(); renderList(); render(); }
$('#obj-list').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'), s = e.target.closest('[data-sel]');
  if (d) { S.obs.splice(+d.dataset.del, 1); S.sel = S.obs.length - 1; } else if (s) S.sel = +s.dataset.sel; else return;
  refresh();
});
const picker = $('#obj-picker');
$('#btn-add-obj').addEventListener('click', e => {
  e.stopPropagation();
  picker.innerHTML = CFG.objects.map(o => `<button class="obj-picker-item" data-add="${o.id}">${o.label}<span class="obj-picker-cat">${o.category}</span></button>`).join('');
  picker.hidden = !picker.hidden;
});
picker.addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b || S.obs.length >= MAX_OBJ) return;
  const c = OBJ[b.dataset.add], i = S.obs.length, [dx, dp] = [[-2, 1.6], [0, 0], [2, -1]][i], [x, z] = toWorld(dx, dp);
  S.obs.push({ t: c.id, x, z, s: 1, rel: 0, pose: 'standing', arms: 'both-down', expr: 'neutral' });
  S.sel = S.obs.length - 1; picker.hidden = true; refresh();
});
document.addEventListener('click', e => { if (!e.target.closest('.add-obj-wrap')) picker.hidden = true; });

/* ---------- mouse: orbit camera (step 1, or Ctrl+drag) / drag objects (step 2) ---------- */
const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
const hit = (x, y) => { for (let k = S.obs.length - 1; k >= 0; k--) { const b = BB[k]; if (b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return k; } return -1; };
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  const [x, y] = pt(e); cv.setPointerCapture(e.pointerId);
  if (S.step == 0 || e.ctrlKey || e.metaKey) { drag = { m: 'o', x: e.clientX, y: e.clientY, az: S.cam.az, el: S.cam.el }; cv.classList.add('grabbing'); return; }
  const i = hit(x, y); S.sel = i; refresh();
  if (i < 0) return;
  const h = floorHit(cam(), x, y), o = S.obs[i];
  drag = { m: 'm', i, dx: h ? o.x - h[0] : 0, dz: h ? o.z - h[1] : 0 };
  cv.classList.add('grabbing');
});
cv.addEventListener('pointermove', e => {
  if (!drag) { if (S.step == 1) { const [x, y] = pt(e); cv.classList.toggle('over-obj', hit(x, y) >= 0); } return; }
  if (drag.m == 'o') {
    S.cam.az = wrap(Math.round(drag.az - (e.clientX - drag.x) * .4));
    S.cam.el = clamp(Math.round(drag.el + (e.clientY - drag.y) * .3), -60, 85);
    syncCam();
  } else {
    const [x, y] = pt(e), h = floorHit(cam(), x, y);
    if (h) { const o = S.obs[drag.i]; o.x = clamp(h[0] + drag.dx, -8, 8); o.z = clamp(h[1] + drag.dz, -8, 8); render(); }
  }
});
const endDrag = () => { const wasObj = drag && drag.m == 'm'; drag = null; cv.classList.remove('grabbing'); if (wasObj) buildObj(); };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

/* ---------- steps ---------- */
function go(n) {
  S.step = n;
  document.querySelectorAll('.step-tab').forEach(t => t.classList.toggle('active', +t.dataset.step == n));
  pCam.hidden = n == 1; pObj.hidden = n == 0; $('#panel-right').hidden = n == 0;
  $('#btn-next').textContent = n ? 'Edit camera' : 'Lock camera, place objects';
  cv.classList.toggle('arrow', n == 1);
  if (n) refresh(); else syncCam();
}
document.querySelectorAll('.step-tab').forEach(t => t.addEventListener('click', () => go(+t.dataset.step)));
$('#btn-next').addEventListener('click', () => go(1 - S.step));

/* ---------- shots, timeline, exports ---------- */
function snap() {
  render(true);
  const t = document.createElement('canvas'); t.width = 224; t.height = 126; t.getContext('2d').drawImage(cv, 0, 0, 224, 126);
  const s = { cam: { ...S.cam }, obs: clone(S.obs), img: t.toDataURL(), label: S.label }; render(); return s;
}
function saveShot(dup) {
  const s = snap();
  if (dup || S.cur < 0) { if (dup) s.label = num(S.shots.length + 1); S.shots.push(s); S.cur = S.shots.length - 1; } else S.shots[S.cur] = s;
  S.label = s.label; renderTl();
}
function loadShot(i) { const s = S.shots[i]; S.cam = { ...s.cam }; S.obs = clone(s.obs); S.cur = i; S.sel = -1; S.label = s.label; renderTl(); go(S.step); }
function renderTl() {
  $('#shot-label').textContent = S.label;
  $('#timeline-strip').innerHTML = S.shots.length ? S.shots.map((s, i) => `<div class="shot-thumb${i == S.cur ? ' active' : ''}" data-i="${i}">
    <img src="${s.img}" alt=""><div class="shot-thumb-actions"><button class="shot-thumb-btn" data-dup="${i}" title="Duplicate">⧉</button><button class="shot-thumb-btn" data-x="${i}" title="Delete">×</button></div>
    <span class="shot-thumb-label">${s.label}</span></div>`).join('') : '<div class="timeline-empty">Saved shots appear here.</div>';
}
$('#timeline-strip').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'), d = e.target.closest('[data-dup]'), t = e.target.closest('[data-i]');
  if (x) { S.shots.splice(+x.dataset.x, 1); S.cur = -1; renderTl(); }
  else if (d) { const s = clone(S.shots[+d.dataset.dup]); s.label = num(S.shots.length + 1); S.shots.push(s); renderTl(); }
  else if (t) loadShot(+t.dataset.i);
});
$('#btn-save-shot').addEventListener('click', () => saveShot(false));
$('#btn-duplicate-shot').addEventListener('click', () => saveShot(true));
$('#btn-new-shot').addEventListener('click', () => { S.obs = []; S.sel = -1; S.cur = -1; S.label = num(S.shots.length + 1); renderTl(); go(0); });
$('#shot-label').addEventListener('input', e => { S.label = e.target.textContent.trim() || 'SHOT'; if (S.cur >= 0) { S.shots[S.cur].label = S.label; } });
$('#shot-label').addEventListener('blur', renderTl);
$('#shot-label').addEventListener('keydown', e => { if (e.key == 'Enter') { e.preventDefault(); e.target.blur(); } });
$('#btn-toggle-grid').addEventListener('click', e => { S.grid = !S.grid; e.currentTarget.classList.toggle('on', S.grid); render(); });
const download = (href, name) => { const a = document.createElement('a'); a.download = name; a.href = href; a.click(); };
$('#btn-export-png').addEventListener('click', () => { render(true); download(cv.toDataURL('image/png'), S.label.replace(/\s+/g, '-') + '.png'); render(); });
$('#btn-export-sheet').addEventListener('click', () => {
  if (!S.shots.length) { alert('Save at least one shot first.'); return; }
  const n = S.shots.length, cols = Math.min(3, n), rows = Math.ceil(n / cols), cw = 480, ch = 270, pad = 24, top = 48;
  const c = document.createElement('canvas'); c.width = cols * (cw + pad) + pad; c.height = top + rows * (ch + 34 + pad) + pad / 2;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#111'; x.font = 'bold 16px monospace'; x.textBaseline = 'alphabetic'; x.fillText('DAMAROO STORYBOARD', pad, 30);
  const keep = [S.cam, S.obs];
  S.shots.forEach((s, i) => {
    S.cam = s.cam; S.obs = s.obs; render(true);
    const px = pad + (i % cols) * (cw + pad), py = top + Math.floor(i / cols) * (ch + 34 + pad);
    x.drawImage(cv, px, py, cw, ch); x.strokeStyle = '#111'; x.lineWidth = 1; x.strokeRect(px, py, cw, ch);
    x.fillStyle = '#111'; x.font = '13px monospace'; x.fillText(s.label, px, py + ch + 20);
  });
  [S.cam, S.obs] = keep; render();
  download(c.toDataURL('image/png'), 'storyboard-sheet.png');
});

/* ---------- boot ---------- */
(async function init() {
  try { CFG = await (await fetch('config.json')).json(); }
  catch (err) { document.body.insertAdjacentHTML('beforeend', '<div class="fatal">Could not load config.json. Open this page through GitHub Pages or a local web server (not by double-clicking the file).</div>'); return; }
  OBJ = Object.fromEntries(CFG.objects.map(o => [o.id, o]));
  buildCam(); renderTl(); renderList(); go(0);
})();
