// ============================================================
// Damaroo Storyboard Simulator — app.js
// Deterministic stickman storyboard renderer.
// No AI. No random. Same config → same frame, always.
// ============================================================

// ── LOAD CONFIG ─────────────────────────────────────────────
const CFG = await fetch("config.json").then(r => r.json());

// ── STATE ───────────────────────────────────────────────────
let state = {
  showGrid: false,
  activeShot: null,   // index into shots[]
  selectedObj: null,  // index into shots[activeShot].objects[]
  shots: []
};

function loadFromStorage(){
  try {
    const raw = localStorage.getItem("damaroo_sb");
    if (raw) {
      const saved = JSON.parse(raw);
      state.shots = saved.shots || [];
      state.activeShot = saved.activeShot ?? 0;
    }
  } catch(e){}
}

function saveToStorage(){
  localStorage.setItem("damaroo_sb", JSON.stringify({
    shots: state.shots,
    activeShot: state.activeShot
  }));
}

function makeShot(overrides){
  return Object.assign({
    id: Date.now(),
    label: "",
    camera: {
      horizontal: "center",
      vertical: "eye-level",
      lens: "normal",
      shotScale: "medium"
    },
    objects: []
  }, overrides || {});
}

function currentShot(){
  return state.shots[state.activeShot] ?? null;
}

function currentObj(){
  const s = currentShot();
  if (!s || state.selectedObj === null) return null;
  return s.objects[state.selectedObj] ?? null;
}

// ── CANVAS SETUP ────────────────────────────────────────────
const canvas = document.getElementById("storyboard-canvas");
const ctx = canvas.getContext("2d");

function sizeCanvas(){
  const wrap = document.querySelector(".canvas-wrap");
  const maxW = wrap.clientWidth - 40;
  const maxH = wrap.clientHeight - 10;
  const aspect = 16 / 9;
  let w = Math.min(maxW, maxH * aspect);
  let h = w / aspect;
  if (h > maxH){ h = maxH; w = h * aspect; }
  canvas.width  = Math.floor(w);
  canvas.height = Math.floor(h);
  canvas.style.width  = canvas.width  + "px";
  canvas.style.height = canvas.height + "px";
  renderFrame();
}

window.addEventListener("resize", sizeCanvas);

// ── RENDERER ────────────────────────────────────────────────
const GRID_POS = {
  "top-left":      [0, 0], "top-middle":    [1, 0], "top-right":     [2, 0],
  "middle-left":   [0, 1], "center":        [1, 1], "middle-right":  [2, 1],
  "bottom-left":   [0, 2], "bottom-middle": [1, 2], "bottom-right":  [2, 2]
};

const DEPTH_ORDER = { background: 0, midground: 1, foreground: 2 };
const SCALE_F     = { small: 0.55, medium: 0.85, large: 1.2 };
const SHOT_SCALE  = { wide: 0.58, medium: 0.85, close: 1.18 };
const LENS_F      = { wide: 1.28, normal: 1.0, telephoto: 0.78 };

function gridCellXY(col, row){
  const W = canvas.width, H = canvas.height;
  const cx = (col / 3 + 1 / 6) * W;
  const cy = (row / 3 + 1 / 6) * H;
  return [cx, cy];
}

// Camera horizontal/vertical shifts base positions
function camOffset(shot){
  const hOpts = CFG.camera.horizontal;
  const vOpts = CFG.camera.vertical;
  const h = hOpts.find(o => o.id === shot.camera.horizontal) || hOpts[2];
  const v = vOpts.find(o => o.id === shot.camera.vertical)   || vOpts[2];
  const W = canvas.width, H = canvas.height;
  const xShift = -(h.angle / 60) * W * 0.15;
  const yShift =  (v.angle / 70) * H * 0.12;
  return [xShift, yShift];
}

function renderFrame(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  const shot = currentShot();

  // subtle horizon / ground plane
  const gy = H * 0.62;
  const grad = ctx.createLinearGradient(0, H * 0.2, 0, H);
  grad.addColorStop(0, "#F0EFEB");
  grad.addColorStop(1, "#E2DDD6");
  ctx.fillStyle = grad;
  ctx.fillRect(0, gy, W, H - gy);

  ctx.strokeStyle = "#CCCAC4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(W, gy);
  ctx.stroke();

  // composition grid
  if (state.showGrid){
    ctx.strokeStyle = "rgba(180,60,60,0.22)";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 4]);
    for (let i = 1; i < 3; i++){
      ctx.beginPath();
      ctx.moveTo(W * i / 3, 0);
      ctx.lineTo(W * i / 3, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, H * i / 3);
      ctx.lineTo(W, H * i / 3);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (!shot || shot.objects.length === 0){
    ctx.fillStyle = "#AAAAAA";
    ctx.font = `${Math.max(12, W * 0.022)}px 'DM Mono', monospace`;
    ctx.textAlign = "center";
    ctx.fillText("Add objects to compose the frame.", W / 2, H / 2);
    return;
  }

  const [ox, oy] = camOffset(shot);
  const lensF = LENS_F[shot.camera.lens] || 1;
  const scaleF = SHOT_SCALE[shot.camera.shotScale] || 1;

  // sort by depth
  const sorted = [...shot.objects].sort((a, b) =>
    (DEPTH_ORDER[a.depth] || 0) - (DEPTH_ORDER[b.depth] || 0)
  );

  sorted.forEach(obj => {
    const [col, row] = GRID_POS[obj.position] || [1, 1];
    let [cx, cy] = gridCellXY(col, row);
    cx += ox; cy += oy;

    const depthF = { background: 0.55, midground: 0.82, foreground: 1.1 }[obj.depth] || 1;
    const sz = W * 0.13 * depthF * (SCALE_F[obj.scale] || 1) * scaleF * lensF;

    const objDef = CFG.objects.find(o => o.id === obj.type);

    if (obj.type === "man" || obj.type === "woman"){
      drawCharacter(ctx, obj, cx, cy, sz, objDef);
    } else {
      drawObject(ctx, obj, cx, cy, sz, objDef);
    }
  });

  // shot label bottom-right
  const shot_idx = state.activeShot;
  const label = shot.label || shotNumLabel(shot_idx);
  ctx.fillStyle = "#AAAAAA";
  ctx.font = `${Math.max(9, W * 0.016)}px 'DM Mono', monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, W - 8, H - 6);
  ctx.textBaseline = "alphabetic";
}

function shotNumLabel(idx){
  return "SHOT " + String(idx + 1).padStart(3, "0");
}

// ── CHARACTER RENDERER ──────────────────────────────────────

function drawCharacter(ctx, obj, cx, cy, sz, def){
  const col = (def && def.color) || "#3B82C4";
  const pose = obj.pose || "standing";
  const arms = obj.arms || "both-down";
  const expr = obj.expression || "neutral";
  const orientation = obj.orientation || "front";
  const isBack = orientation === "back";
  const isLeft = orientation === "left";
  const isRight = orientation === "right";
  const isProfile = isLeft || isRight;
  const is3QL = orientation === "three-quarter-left";
  const is3QR = orientation === "three-quarter-right";
  const flipX = isRight || is3QR ? -1 : 1;

  ctx.save();
  ctx.translate(cx, cy);

  const headR = sz * 0.14;
  const neckH = sz * 0.06;
  const torsoH = sz * { standing: 0.26, sitting: 0.22, crouching: 0.2, sleeping: 0.06 }[pose];
  const legH   = sz * { standing: 0.34, sitting: 0.0,  crouching: 0.14, sleeping: 0.0 }[pose];
  const legSpread = isProfile ? 0 : sz * 0.1;

  const strokeW = Math.max(1.5, sz * 0.042);
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pose === "sleeping"){
    // horizontal, feet to the right
    const dir = isRight ? -1 : 1;
    const bodyLen = sz * 0.55;
    ctx.beginPath();
    ctx.ellipse(0, 0, headR, headR * 0.9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dir * headR, 0);
    ctx.lineTo(dir * (headR + bodyLen), 0);
    ctx.stroke();
    drawExpression(ctx, 0, 0, headR, expr, isBack, strokeW, col);
    ctx.restore();
    return;
  }

  const headY  = -torsoH / 2 - neckH - headR;
  const torsoT = -torsoH / 2;
  const torsoB = torsoH / 2;

  if (pose === "sitting"){
    // legs horizontal
    ctx.save();
    ctx.scale(flipX, 1);
    ctx.beginPath();
    ctx.moveTo(0, torsoB);
    if (isProfile){
      ctx.lineTo(sz * 0.1, torsoB + sz * 0.14);
      ctx.moveTo(sz * 0.04, torsoB + sz * 0.06);
      ctx.lineTo(sz * 0.28, torsoB + sz * 0.06);
    } else {
      ctx.lineTo(-legSpread, torsoB + sz * 0.05);
      ctx.lineTo(-sz * 0.28, torsoB + sz * 0.05);
      ctx.moveTo(0, torsoB);
      ctx.lineTo(legSpread, torsoB + sz * 0.05);
      ctx.lineTo(sz * 0.28, torsoB + sz * 0.05);
    }
    ctx.stroke();
    ctx.restore();
  } else if (pose === "crouching"){
    ctx.save();
    ctx.scale(flipX, 1);
    ctx.beginPath();
    if (isProfile){
      ctx.moveTo(0, torsoB);
      ctx.lineTo(sz * 0.08, torsoB + sz * 0.1);
      ctx.lineTo(sz * 0.18, torsoB + sz * 0.08);
    } else {
      ctx.moveTo(0, torsoB);
      ctx.lineTo(-legSpread * 1.2, torsoB + sz * 0.12);
      ctx.lineTo(-legSpread, torsoB + legH * 0.7);
      ctx.moveTo(0, torsoB);
      ctx.lineTo(legSpread * 1.2, torsoB + sz * 0.12);
      ctx.lineTo(legSpread, torsoB + legH * 0.7);
    }
    ctx.stroke();
    ctx.restore();
  } else {
    // standing legs
    ctx.save();
    ctx.scale(flipX, 1);
    ctx.beginPath();
    if (isProfile){
      ctx.moveTo(0, torsoB);
      ctx.lineTo(sz * 0.04, torsoB + legH * 0.5);
      ctx.lineTo(sz * 0.06, torsoB + legH);
    } else {
      ctx.moveTo(0, torsoB);
      ctx.lineTo(-legSpread, torsoB + legH);
      ctx.moveTo(0, torsoB);
      ctx.lineTo(legSpread, torsoB + legH);
    }
    ctx.stroke();
    ctx.restore();
  }

  // torso
  ctx.beginPath();
  if (isProfile){
    ctx.moveTo(0, torsoT);
    ctx.lineTo(sz * 0.04, torsoB);
  } else if (is3QL || is3QR){
    ctx.moveTo(0, torsoT);
    ctx.quadraticCurveTo(sz * 0.05 * flipX, 0, 0, torsoB);
  } else {
    ctx.moveTo(0, torsoT);
    ctx.lineTo(0, torsoB);
  }
  ctx.stroke();

  // neck
  ctx.beginPath();
  ctx.moveTo(0, torsoT);
  ctx.lineTo(0, torsoT - neckH);
  ctx.stroke();

  // arms
  const shoulderY = torsoT + sz * 0.05;
  const armLen    = sz * 0.24;
  const foreLen   = sz * 0.2;

  if (arms === "both-down"){
    if (isProfile){
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(sz * 0.08, shoulderY + armLen * 0.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(-sz * 0.18, shoulderY + armLen);
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(sz * 0.18, shoulderY + armLen);
      ctx.stroke();
    }
  } else if (arms === "one-raised"){
    // right arm up, left arm down
    if (isProfile){
      const dir2 = (isLeft || is3QL) ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(dir2 * sz * 0.08, shoulderY - armLen * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(-sz * 0.18, shoulderY + armLen);
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(sz * 0.22, shoulderY - armLen * 0.7);
      ctx.lineTo(sz * 0.28, shoulderY - armLen * 0.9 - foreLen * 0.4);
      ctx.stroke();
    }
  } else if (arms === "both-raised"){
    if (isProfile){
      const dir2 = (isLeft || is3QL) ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(dir2 * sz * 0.06, shoulderY - armLen * 0.7);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(-sz * 0.22, shoulderY - armLen * 0.7);
      ctx.lineTo(-sz * 0.28, shoulderY - armLen - foreLen * 0.3);
      ctx.moveTo(0, shoulderY);
      ctx.lineTo(sz * 0.22, shoulderY - armLen * 0.7);
      ctx.lineTo(sz * 0.28, shoulderY - armLen - foreLen * 0.3);
      ctx.stroke();
    }
  }

  // head
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  // expression
  if (!isBack) drawExpression(ctx, 0, headY, headR, expr, false, strokeW, col);

  // woman indicator: triangle skirt
  if (def && def.id === "woman" && pose !== "sleeping"){
    ctx.save();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    if (isProfile){
      ctx.moveTo(0, torsoB);
      ctx.lineTo(sz * 0.12, torsoB + sz * 0.1);
      ctx.lineTo(-sz * 0.04, torsoB + sz * 0.1);
    } else {
      ctx.moveTo(-sz * 0.1, torsoB);
      ctx.lineTo(sz * 0.1, torsoB);
      ctx.lineTo(sz * 0.18, torsoB + sz * 0.13);
      ctx.lineTo(-sz * 0.18, torsoB + sz * 0.13);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawExpression(ctx, x, y, r, expr, isBack, sw, col){
  if (isBack) return;
  const es = r * 0.28;
  const ey = y - r * 0.05;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = Math.max(1, sw * 0.6);

  // eyes
  ctx.beginPath();
  ctx.arc(x - r * 0.3, ey, es * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.3, ey, es * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // mouth
  const my = y + r * 0.28;
  ctx.beginPath();
  if (expr === "smile"){
    ctx.arc(x, my - r * 0.1, r * 0.28, 0.1, Math.PI - 0.1);
  } else if (expr === "sad"){
    ctx.arc(x, my + r * 0.15, r * 0.28, Math.PI + 0.1, -0.1);
  } else {
    ctx.moveTo(x - r * 0.28, my);
    ctx.lineTo(x + r * 0.28, my);
  }
  ctx.stroke();
  ctx.restore();
}

// ── OBJECT RENDERER ─────────────────────────────────────────

function drawObject(ctx, obj, cx, cy, sz, def){
  const orient = obj.orientation || "front";

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#2A2825";
  ctx.fillStyle = "transparent";
  ctx.lineWidth = Math.max(1.2, sz * 0.03);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch(obj.type){
    case "bed":     drawBed(ctx, sz, orient);    break;
    case "chair":   drawChair(ctx, sz, orient);  break;
    case "sofa":    drawSofa(ctx, sz, orient);   break;
    case "table":   drawTable(ctx, sz, orient);  break;
    case "door":    drawDoor(ctx, sz, orient);   break;
    case "window":  drawWindow(ctx, sz, orient); break;
    case "phone":   drawPhone(ctx, sz, orient);  break;
    case "laptop":  drawLaptop(ctx, sz, orient); break;
    case "car":     drawCar(ctx, sz, orient);    break;
    default: {
      ctx.strokeRect(-sz*0.3, -sz*0.3, sz*0.6, sz*0.6);
      ctx.fillStyle = "#2A2825";
      ctx.font = `${sz * 0.12}px DM Mono, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(obj.type, 0, 0);
    }
  }
  ctx.restore();
}

function rect(ctx, x, y, w, h){ ctx.strokeRect(x, y, w, h); }
function fillRect(ctx, x, y, w, h){ ctx.fillRect(x, y, w, h); }
function line(ctx, x1, y1, x2, y2){ ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function drawBed(ctx, sz, orient){
  const w = sz * 0.8, h = sz * 0.5;
  if (orient === "front"){
    ctx.fillStyle = "#E8E4DC"; ctx.fillRect(-w/2, -h/2, w, h);
    rect(ctx, -w/2, -h/2, w, h);
    ctx.fillStyle = "#CFCBC2"; ctx.fillRect(-w/2, -h/2, w * 0.22, h);
    rect(ctx, -w/2, -h/2, w * 0.22, h);
    rect(ctx, -w/2 + w * 0.06, -h/2 + h * 0.15, w * 0.1, h * 0.7);
  } else {
    const bw = sz * 0.5, bh = sz * 0.75;
    ctx.fillStyle = "#E8E4DC"; ctx.fillRect(-bw/2, -bh/2, bw, bh);
    rect(ctx, -bw/2, -bh/2, bw, bh);
    ctx.fillStyle = "#CFCBC2"; ctx.fillRect(-bw/2, -bh/2, bw, bh * 0.22);
    rect(ctx, -bw/2, -bh/2, bw, bh * 0.22);
  }
}

function drawChair(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  if (side){
    const sx = orient === "right" ? -1 : 1;
    ctx.save(); ctx.scale(sx, 1);
    const sw = sz * 0.38, sh = sz * 0.28;
    ctx.fillStyle = "#E0DCD4"; ctx.fillRect(0, -sh, sw, sh);
    rect(ctx, 0, -sh, sw, sh);
    line(ctx, 0, -sh, 0, -sh - sz*0.3);
    line(ctx, 0, 0, 0, sz*0.22);
    line(ctx, sw * 0.85, 0, sw * 0.85, sz*0.22);
    ctx.restore();
  } else {
    const cw = sz * 0.38, ch = sz * 0.28;
    ctx.fillStyle = "#E0DCD4"; ctx.fillRect(-cw/2, -ch, cw, ch);
    rect(ctx, -cw/2, -ch, cw, ch);
    line(ctx, -cw/2 + cw*0.1, -ch, -cw/2 + cw*0.1, -ch - sz*0.3);
    line(ctx, cw/2 - cw*0.1, -ch, cw/2 - cw*0.1, -ch - sz*0.3);
    line(ctx, -cw/2 + cw*0.1, 0, -cw/2 + cw*0.1, sz*0.22);
    line(ctx, cw/2 - cw*0.1, 0, cw/2 - cw*0.1, sz*0.22);
  }
}

function drawSofa(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const w = side ? sz * 0.28 : sz * 0.8, h = sz * 0.28;
  ctx.fillStyle = "#DDD9D0"; ctx.fillRect(-w/2, -h/2, w, h);
  rect(ctx, -w/2, -h/2, w, h);
  const bh = h * 0.55;
  ctx.fillStyle = "#CCCAC0";
  if (side){
    ctx.fillRect(-w/2, -h/2 - bh, w * 0.25, h + bh);
    rect(ctx, -w/2, -h/2 - bh, w * 0.25, h + bh);
    line(ctx, w/2, -h/2, w/2, h*0.6);
  } else {
    ctx.fillRect(-w/2, -h/2 - bh, w, bh);
    rect(ctx, -w/2, -h/2 - bh, w, bh);
    ctx.fillRect(-w/2, -h/2, w*0.12, h);
    rect(ctx, -w/2, -h/2, w*0.12, h);
    ctx.fillRect(w/2 - w*0.12, -h/2, w*0.12, h);
    rect(ctx, w/2 - w*0.12, -h/2, w*0.12, h);
    line(ctx, -w/2, h/2, -w/2, h/2 + sz*0.1);
    line(ctx,  w/2, h/2,  w/2, h/2 + sz*0.1);
  }
}

function drawTable(ctx, sz, orient){
  if (orient === "front"){
    const tw = sz * 0.7, th = sz * 0.06;
    ctx.fillStyle = "#DDD8CE"; ctx.fillRect(-tw/2, -sz*0.15, tw, th);
    rect(ctx, -tw/2, -sz*0.15, tw, th);
    line(ctx, -tw/2 + tw*0.08, -sz*0.15 + th, -tw/2 + tw*0.08, sz*0.28);
    line(ctx,  tw/2 - tw*0.08, -sz*0.15 + th,  tw/2 - tw*0.08, sz*0.28);
  } else {
    const tw = sz * 0.5, td = sz * 0.45, th = sz * 0.06;
    const pts = [[-tw/2,-td/2],[tw/2,-td/2],[tw/2,td/2],[-tw/2,td/2]];
    ctx.fillStyle = "#DDD8CE";
    ctx.beginPath();
    pts.forEach((p,i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1]));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const corners = [[-tw/2,-td/2],[tw/2,-td/2],[tw/2,td/2],[-tw/2,td/2]];
    corners.forEach(([x,y]) => line(ctx, x, y, x, y + sz*0.32));
  }
}

function drawDoor(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const w = side ? sz * 0.14 : sz * 0.42, h = sz * 0.75;
  ctx.fillStyle = "#E5E0D8"; ctx.fillRect(-w/2, -h/2, w, h);
  rect(ctx, -w/2, -h/2, w, h);
  ctx.beginPath();
  ctx.arc(-w/2 + w * 0.72, -h * 0.04, h * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = "#8A8580"; ctx.fill();
  if (!side){
    const pw = w * 0.35, ph = h * 0.38;
    rect(ctx, -w*0.42, -h/2 + h*0.08, pw, ph);
    rect(ctx, w*0.07, -h/2 + h*0.08, pw, ph);
    rect(ctx, -w*0.42, -h/2 + h*0.08 + ph + h*0.03, pw, ph);
    rect(ctx, w*0.07, -h/2 + h*0.08 + ph + h*0.03, pw, ph);
  }
}

function drawWindow(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const w = side ? sz * 0.1 : sz * 0.6, h = sz * 0.5;
  ctx.fillStyle = "#D6E8F5"; ctx.fillRect(-w/2, -h/2, w, h);
  rect(ctx, -w/2, -h/2, w, h);
  if (!side){
    line(ctx, 0, -h/2, 0, h/2);
    line(ctx, -w/2, 0, w/2, 0);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(-w/2 + 2, -h/2 + 2, w/2 - 4, h/2 - 4);
  }
}

function drawPhone(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const w = side ? sz * 0.08 : sz * 0.22, h = side ? sz * 0.22 : sz * 0.38;
  const r = sz * 0.04;
  ctx.fillStyle = "#2A2825";
  ctx.beginPath();
  ctx.roundRect(-w/2, -h/2, w, h, r);
  ctx.fill();
  ctx.fillStyle = "#D6E8F5";
  ctx.beginPath();
  ctx.roundRect(-w/2 + w*0.08, -h/2 + h*0.07, w*0.84, h*0.76, r * 0.5);
  ctx.fill();
  ctx.fillStyle = "#2A2825";
  ctx.beginPath();
  ctx.arc(0, h/2 - h*0.06, sz*0.025, 0, Math.PI*2);
  ctx.fill();
}

function drawLaptop(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const bw = side ? sz * 0.12 : sz * 0.55, bh = sz * 0.32;
  const sw = side ? sz * 0.14 : sz * 0.6,  sh = sz * 0.04;
  ctx.fillStyle = "#CFCAC0"; ctx.fillRect(-bw/2, -bh/2, bw, bh);
  rect(ctx, -bw/2, -bh/2, bw, bh);
  ctx.fillStyle = "#1A3A5C"; ctx.fillRect(-bw/2 + bw*0.05, -bh/2 + bh*0.07, bw*0.9, bh*0.76);
  ctx.fillStyle = "#BCBAB5"; ctx.fillRect(-sw/2, bh/2, sw, sh);
  rect(ctx, -sw/2, bh/2, sw, sh);
}

function drawCar(ctx, sz, orient){
  const side = orient === "left" || orient === "right";
  const flip = orient === "right" ? -1 : 1;
  ctx.save();
  ctx.scale(flip, 1);

  if (side){
    const cw = sz * 0.8, ch = sz * 0.32;
    ctx.fillStyle = "#CCC8C0"; ctx.fillRect(-cw/2, -ch/2, cw, ch);
    rect(ctx, -cw/2, -ch/2, cw, ch);
    ctx.fillStyle = "#8AB0D0";
    ctx.beginPath();
    ctx.moveTo(-cw*0.2, -ch/2);
    ctx.quadraticCurveTo(-cw*0.05, -ch/2 - ch*0.6, cw*0.1, -ch/2 - ch*0.6);
    ctx.lineTo(cw*0.35, -ch/2 - ch*0.6);
    ctx.quadraticCurveTo(cw*0.45, -ch/2, cw*0.4, -ch/2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const wr = ch * 0.45;
    [-cw*0.3, cw*0.28].forEach(x => {
      ctx.beginPath(); ctx.arc(x, ch/2, wr, 0, Math.PI*2);
      ctx.fillStyle = "#4A4744"; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, ch/2, wr*0.4, 0, Math.PI*2);
      ctx.fillStyle = "#CCC8C0"; ctx.fill(); ctx.stroke();
    });
  } else {
    const cw = sz * 0.5, ch = sz * 0.24;
    ctx.fillStyle = "#CCC8C0"; ctx.fillRect(-cw/2, -ch/2, cw, ch);
    rect(ctx, -cw/2, -ch/2, cw, ch);
    ctx.fillStyle = "#8AB0D0";
    ctx.fillRect(-cw*0.28, -ch/2 - ch*0.4, cw*0.56, ch*0.4);
    rect(ctx, -cw*0.28, -ch/2 - ch*0.4, cw*0.56, ch*0.4);
    const wr = ch * 0.4;
    [[-cw*0.3, ch/2],[cw*0.3, ch/2]].forEach(([x,y]) => {
      ctx.beginPath(); ctx.arc(x, y, wr, 0, Math.PI*2);
      ctx.fillStyle = "#4A4744"; ctx.fill(); ctx.stroke();
    });
  }
  ctx.restore();
}

// ── CAMERA DIAGRAM ──────────────────────────────────────────

function drawCamDiagram(){
  const diag = document.getElementById("cam-diagram-canvas");
  const dc = diag.getContext("2d");
  const W = diag.width, H = diag.height;
  const shot = currentShot();
  const cam = shot ? shot.camera : { horizontal:"center", vertical:"eye-level" };

  dc.clearRect(0,0,W,H);
  dc.fillStyle = "#EDEAE2"; dc.fillRect(0,0,W,H);

  const hOpts = CFG.camera.horizontal;
  const vOpts = CFG.camera.vertical;
  const hi = hOpts.findIndex(o => o.id === cam.horizontal);
  const vi = vOpts.findIndex(o => o.id === cam.vertical);

  const padX = 18, padY = 14;
  const gW = W - padX * 2, gH = H - padY * 2;
  const dotX = padX + (hi / (hOpts.length - 1)) * gW;
  const dotY = padY + (vi / (vOpts.length - 1)) * gH;

  // grid lines
  dc.strokeStyle = "#D6D2C8"; dc.lineWidth = 0.8;
  hOpts.forEach((_, i) => {
    const x = padX + (i / (hOpts.length - 1)) * gW;
    dc.beginPath(); dc.moveTo(x, padY); dc.lineTo(x, padY + gH); dc.stroke();
  });
  vOpts.forEach((_, i) => {
    const y = padY + (i / (vOpts.length - 1)) * gH;
    dc.beginPath(); dc.moveTo(padX, y); dc.lineTo(padX + gW, y); dc.stroke();
  });

  // subject dot
  dc.fillStyle = "#D6D2C8"; dc.beginPath();
  dc.arc(W/2, H/2, 4, 0, Math.PI*2); dc.fill();

  // camera dot + arrow to center
  dc.strokeStyle = "#B91C1C"; dc.lineWidth = 1.2;
  dc.setLineDash([3,3]);
  dc.beginPath(); dc.moveTo(dotX, dotY); dc.lineTo(W/2, H/2); dc.stroke();
  dc.setLineDash([]);
  dc.fillStyle = "#B91C1C"; dc.beginPath();
  dc.arc(dotX, dotY, 5, 0, Math.PI*2); dc.fill();

  // label
  dc.fillStyle = "#8A8580";
  dc.font = "8px 'DM Mono', monospace";
  dc.textAlign = "center";
  dc.fillText("CAM", dotX, dotY - 8);
}

// ── UI BUILDERS ─────────────────────────────────────────────

function buildParamButtons(containerId, items, getter, setter){
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  items.forEach(item => {
    const b = document.createElement("button");
    b.className = "btn-param";
    b.dataset.id = item.id;
    b.textContent = item.label;
    b.addEventListener("click", () => {
      setter(item.id);
      refreshParamButtons(containerId, getter);
      refreshAll();
    });
    el.appendChild(b);
  });
  refreshParamButtons(containerId, getter);
}

function refreshParamButtons(containerId, getter){
  const el = document.getElementById(containerId);
  const val = getter();
  el.querySelectorAll(".btn-param").forEach(b => {
    b.classList.toggle("active", b.dataset.id === val);
  });
}

function buildCameraControls(){
  const shot = currentShot();
  if (!shot) return;
  buildParamButtons("ctrl-horizontal", CFG.camera.horizontal,
    () => currentShot().camera.horizontal,
    v => { currentShot().camera.horizontal = v; }
  );
  buildParamButtons("ctrl-vertical", CFG.camera.vertical,
    () => currentShot().camera.vertical,
    v => { currentShot().camera.vertical = v; }
  );
  buildParamButtons("ctrl-lens", CFG.camera.lens,
    () => currentShot().camera.lens,
    v => { currentShot().camera.lens = v; }
  );
  buildParamButtons("ctrl-shotscale", CFG.camera.shotScale,
    () => currentShot().camera.shotScale,
    v => { currentShot().camera.shotScale = v; }
  );
}

function buildObjControls(){
  const obj = currentObj();
  const objControls = document.getElementById("obj-controls");
  if (!obj){ objControls.style.display = "none"; return; }
  objControls.style.display = "";
  const def = CFG.objects.find(o => o.id === obj.type);
  document.getElementById("obj-ctrl-title").textContent =
    (def ? def.label : obj.type).toUpperCase();

  // position grid
  document.querySelectorAll(".grid-picker button").forEach(b => {
    b.classList.toggle("active", b.dataset.pos === obj.position);
    b.onclick = () => {
      obj.position = b.dataset.pos;
      buildObjControls();
      refreshAll();
    };
  });

  buildParamButtons("ctrl-depth", CFG.depth,
    () => currentObj()?.depth,
    v => { if(currentObj()) currentObj().depth = v; }
  );
  buildParamButtons("ctrl-scale", CFG.scale,
    () => currentObj()?.scale,
    v => { if(currentObj()) currentObj().scale = v; }
  );

  const orientOpts = (def?.orientations || ["front","back","left","right"]).map(id => ({
    id, label: CFG.orientationLabels[id] || id
  }));
  buildParamButtons("ctrl-orientation", orientOpts,
    () => currentObj()?.orientation,
    v => { if(currentObj()) currentObj().orientation = v; }
  );

  const isChar = def?.category === "character";
  document.getElementById("char-controls").style.display = isChar ? "" : "none";
  if (isChar){
    buildParamButtons("ctrl-pose",
      (def.poses || []).map(id => ({ id, label: CFG.poseLabels[id] || id })),
      () => currentObj()?.pose,
      v => { if(currentObj()) currentObj().pose = v; }
    );
    buildParamButtons("ctrl-arms",
      (def.arms || []).map(id => ({ id, label: CFG.armLabels[id] || id })),
      () => currentObj()?.arms,
      v => { if(currentObj()) currentObj().arms = v; }
    );
    buildParamButtons("ctrl-expression",
      (def.expressions || []).map(id => ({ id, label: CFG.expressionLabels[id] || id })),
      () => currentObj()?.expression,
      v => { if(currentObj()) currentObj().expression = v; }
    );
  }
}

function buildObjList(){
  const shot = currentShot();
  const list = document.getElementById("obj-list");
  list.innerHTML = "";

  if (!shot || shot.objects.length === 0){
    list.innerHTML = `<div class="empty-hint">No objects yet.<br>Click + Add Object below.</div>`;
    return;
  }

  shot.objects.forEach((obj, i) => {
    const def = CFG.objects.find(o => o.id === obj.type);
    const color = (def && def.color) || "#4A4744";
    const isChar = def?.category === "character";
    const meta = [obj.depth || "—", obj.position || "—", obj.scale || "—"].join(" · ");

    const item = document.createElement("div");
    item.className = "obj-item" + (state.selectedObj === i ? " active" : "");
    item.innerHTML = `
      <div class="obj-item-dot" style="background:${isChar ? color : '#4A4744'};"></div>
      <div class="obj-item-info">
        <div class="obj-item-name">${def ? def.label : obj.type}</div>
        <div class="obj-item-meta">${meta}</div>
      </div>
      <button class="obj-item-del" title="Remove">×</button>
    `;
    item.querySelector(".obj-item-del").addEventListener("click", e => {
      e.stopPropagation();
      shot.objects.splice(i, 1);
      if (state.selectedObj >= shot.objects.length) state.selectedObj = shot.objects.length - 1;
      if (shot.objects.length === 0) state.selectedObj = null;
      refreshAll();
    });
    item.addEventListener("click", () => {
      state.selectedObj = i;
      refreshAll();
    });
    list.appendChild(item);
  });

  document.getElementById("btn-add-obj").disabled = shot.objects.length >= 5;
}

function buildObjPicker(){
  const picker = document.getElementById("obj-picker");
  picker.innerHTML = "";
  CFG.objects.forEach(def => {
    const item = document.createElement("div");
    item.className = "obj-picker-item";
    item.innerHTML = `
      <span>${def.label}</span>
      <span class="obj-picker-cat">${def.category}</span>
    `;
    item.addEventListener("click", () => {
      addObject(def);
      picker.style.display = "none";
    });
    picker.appendChild(item);
  });
}

function addObject(def){
  const shot = currentShot();
  if (!shot || shot.objects.length >= 5) return;
  const isChar = def.category === "character";
  const newObj = {
    type: def.id,
    position: "center",
    depth: "midground",
    scale: "medium",
    orientation: (def.orientations && def.orientations[0]) || "front"
  };
  if (isChar){
    newObj.pose = "standing";
    newObj.arms = "both-down";
    newObj.expression = "neutral";
  }
  shot.objects.push(newObj);
  state.selectedObj = shot.objects.length - 1;
  refreshAll();
}

// ── TIMELINE ────────────────────────────────────────────────

function buildTimeline(){
  const strip = document.getElementById("timeline-strip");
  strip.innerHTML = "";

  state.shots.forEach((shot, i) => {
    const wrap = document.createElement("div");
    wrap.className = "shot-thumb" + (i === state.activeShot ? " active" : "");

    const tc = document.createElement("canvas");
    tc.className = "shot-thumb-canvas";
    tc.width = 172; tc.height = 97;

    const label = document.createElement("div");
    label.className = "shot-thumb-label";
    label.textContent = shot.label || shotNumLabel(i);

    const acts = document.createElement("div");
    acts.className = "shot-thumb-actions";
    acts.innerHTML = `
      <button class="shot-thumb-btn" data-action="dup" title="Duplicate">⧉</button>
      <button class="shot-thumb-btn" data-action="del" title="Delete">×</button>
    `;

    wrap.appendChild(tc);
    wrap.appendChild(label);
    wrap.appendChild(acts);
    strip.appendChild(wrap);

    // mini render for this shot
    renderShotToCanvas(shot, tc);

    wrap.addEventListener("click", e => {
      if (e.target.closest("[data-action]")) return;
      state.activeShot = i;
      state.selectedObj = null;
      refreshAll();
    });

    acts.querySelector("[data-action=dup]").addEventListener("click", e => {
      e.stopPropagation();
      duplicateShot(i);
    });
    acts.querySelector("[data-action=del]").addEventListener("click", e => {
      e.stopPropagation();
      deleteShot(i);
    });
  });
}

function renderShotToCanvas(shot, tc){
  const savedShot = state.shots[state.activeShot];
  const savedSelected = state.selectedObj;
  const savedActive = state.activeShot;

  // temporarily swap state for rendering
  const tempIdx = state.shots.indexOf(shot);
  state.activeShot = tempIdx >= 0 ? tempIdx : state.activeShot;
  state.selectedObj = null;

  const saved = { w: canvas.width, h: canvas.height };
  canvas.width = tc.width; canvas.height = tc.height;
  renderFrame();
  tc.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = saved.w; canvas.height = saved.h;

  state.activeShot = savedActive;
  state.selectedObj = savedSelected;
}

function duplicateShot(idx){
  const src = state.shots[idx];
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = Date.now();
  copy.label = "";
  state.shots.splice(idx + 1, 0, copy);
  state.activeShot = idx + 1;
  state.selectedObj = null;
  refreshAll();
}

function deleteShot(idx){
  if (state.shots.length === 1) return;
  state.shots.splice(idx, 1);
  if (state.activeShot >= state.shots.length) state.activeShot = state.shots.length - 1;
  state.selectedObj = null;
  refreshAll();
}

// ── SHOT LABEL ──────────────────────────────────────────────

function updateShotLabel(){
  const el = document.getElementById("shot-label");
  const shot = currentShot();
  el.textContent = (shot && shot.label) ? shot.label : shotNumLabel(state.activeShot);
  el.contentEditable = "true";
  el.title = "Click to rename";
  el.onblur = () => {
    if (currentShot()) currentShot().label = el.textContent.trim();
    refreshAll();
  };
  el.onkeydown = e => { if (e.key === "Enter"){ e.preventDefault(); el.blur(); } };
}

// ── REFRESH ─────────────────────────────────────────────────

function refreshAll(){
  if (!currentShot()) return;
  updateShotLabel();
  buildCameraControls();
  buildObjControls();
  buildObjList();
  buildTimeline();
  renderFrame();
  drawCamDiagram();
  saveToStorage();
}

// ── EXPORT ──────────────────────────────────────────────────

function exportPNG(){
  const link = document.createElement("a");
  link.download = (currentShot()?.label || shotNumLabel(state.activeShot)) + ".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function exportSheet(){
  const cols = Math.min(state.shots.length, 4);
  const rows = Math.ceil(state.shots.length / cols);
  const sw = 640, sh = 360, pad = 20, labelH = 24;
  const totalW = cols * (sw + pad) + pad;
  const totalH = rows * (sh + labelH + pad) + pad;
  const ec = document.createElement("canvas");
  ec.width = totalW; ec.height = totalH;
  const ec2 = ec.getContext("2d");
  ec2.fillStyle = "#F6F4EF"; ec2.fillRect(0,0,totalW,totalH);

  const savedActive = state.activeShot;
  const savedSelected = state.selectedObj;
  const savedW = canvas.width, savedH = canvas.height;
  canvas.width = sw; canvas.height = sh;

  state.shots.forEach((shot, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = pad + col * (sw + pad), y = pad + row * (sh + labelH + pad);
    state.activeShot = i; state.selectedObj = null;
    renderFrame();
    ec2.drawImage(canvas, x, y);
    ec2.strokeStyle = "#2A2825"; ec2.lineWidth = 1;
    ec2.strokeRect(x, y, sw, sh);
    ec2.fillStyle = "#1A1A1A";
    ec2.font = "bold 13px 'DM Mono', monospace";
    ec2.textAlign = "left";
    ec2.fillText(shot.label || shotNumLabel(i), x, y + sh + 18);
  });

  state.activeShot = savedActive;
  state.selectedObj = savedSelected;
  canvas.width = savedW; canvas.height = savedH;
  renderFrame();

  const link = document.createElement("a");
  link.download = "storyboard-sheet.png";
  link.href = ec.toDataURL("image/png");
  link.click();
}

// ── GRID TOGGLE ─────────────────────────────────────────────

document.getElementById("btn-toggle-grid").addEventListener("click", function(){
  state.showGrid = !state.showGrid;
  this.classList.toggle("active-grid", state.showGrid);
  renderFrame();
});

// ── OBJECT PICKER TOGGLE ────────────────────────────────────

document.getElementById("btn-add-obj").addEventListener("click", function(){
  const picker = document.getElementById("obj-picker");
  picker.style.display = picker.style.display === "none" ? "" : "none";
});

document.addEventListener("click", e => {
  if (!e.target.closest(".add-obj-wrap")){
    document.getElementById("obj-picker").style.display = "none";
  }
});

// ── SAVE / DUPLICATE ────────────────────────────────────────

document.getElementById("btn-save-shot").addEventListener("click", () => {
  saveToStorage();
  const btn = document.getElementById("btn-save-shot");
  btn.textContent = "Saved ✓";
  setTimeout(() => btn.textContent = "Save Shot", 1200);
});

document.getElementById("btn-duplicate-shot").addEventListener("click", () => {
  if (state.activeShot !== null) duplicateShot(state.activeShot);
});

// ── EXPORT BUTTONS ──────────────────────────────────────────

document.getElementById("btn-export-png").addEventListener("click", exportPNG);
document.getElementById("btn-export-sheet").addEventListener("click", exportSheet);

// ── INIT ────────────────────────────────────────────────────

function init(){
  loadFromStorage();
  if (state.shots.length === 0){
    state.shots.push(makeShot());
    state.activeShot = 0;
  }
  buildObjPicker();
  sizeCanvas();
  refreshAll();
}

init();
