/* Damaroo Arts — site shell */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = ['home', 'tool', 'projects'];
const tabs = $$('.tab'), ink = $('.tab-ink'), wipe = $('.wipe');
const view = t => $('#view-' + t);
let cur = null, busy = false, toolLoaded = false;

/* ---------- tab indicator ---------- */
function moveInk() {
  const t = tabs.find(x => x.dataset.tab === cur); if (!t) return;
  ink.style.width = t.offsetWidth + 'px';
  ink.style.transform = `translateX(${t.offsetLeft}px)`;
}
addEventListener('resize', moveInk);
document.fonts && document.fonts.ready.then(moveInk);

/* ---------- switching ---------- */
const replay = el => { el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); };
function show(tab) {
  cur = tab; document.body.dataset.tab = tab;
  TABS.forEach(t => view(t).classList.toggle('active', t === tab));
  tabs.forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  moveInk();
  if (tab === 'home') replay($('#view-home')); else $('#view-home').classList.remove('play');
  if (tab === 'projects') replay($('#view-projects')); else $('#view-projects').classList.remove('play');
  if (tab === 'tool' && !toolLoaded) {
    toolLoaded = true; const f = $('#sb-frame');
    f.addEventListener('load', () => { f.classList.add('ready'); $('#tool-load').classList.add('done'); }, { once: true });
    f.src = 'storyboard.html';
  }
  heroRun(tab === 'home');
}
async function go(tab, push = true) {
  if (tab === cur || busy || !TABS.includes(tab)) return;
  if (push) { try { history.pushState(null, '', '#' + tab); } catch (e) {} }
  if (reduce || cur === null) { show(tab); return; }
  busy = true;
  const cover = (from, to, origin) => { wipe.style.transformOrigin = origin;
    return wipe.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }).finished; };
  await cover(0, 1, 'left');
  show(tab);
  await cover(1, 0, 'right');
  wipe.getAnimations().forEach(a => a.cancel());
  busy = false;
}
tabs.forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$('.mark').addEventListener('click', e => { e.preventDefault(); go('home'); });
$('.tabs').addEventListener('keydown', e => {          // arrow keys move between tabs
  const i = TABS.indexOf(cur), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
  const n = TABS[(i + d + TABS.length) % TABS.length]; go(n); $('#tab-' + n).focus();
});
addEventListener('popstate', () => go(location.hash.slice(1) || 'home', false));

/* ---------- hero: title letters ---------- */
$$('.line').forEach(l => { l.innerHTML = [...l.dataset.t].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join(''); });

/* ---------- hero: light follows the cursor, title drifts, dust, timecode ---------- */
const hero = $('#hero'), glow = $('.glow'), title = $('.title'), dust = $('#dust'), dx = dust.getContext('2d'), tcEl = $('#tc');
let running = false, t0 = 0, mx = .5, my = .42, sx = .5, sy = .42, dots = [], DW = 0, DH = 0, lastF = -1;
const mote = init => ({ x: Math.random() * DW, y: init ? Math.random() * DH : DH + 10, r: .5 + Math.random() * 1.8, v: .15 + Math.random() * .4, s: Math.random() * 6.28, a: .15 + Math.random() * .45 });
function sizeDust() {
  const r = dust.getBoundingClientRect(), d = devicePixelRatio || 1; DW = r.width; DH = r.height;
  dust.width = DW * d; dust.height = DH * d; dx.setTransform(d, 0, 0, d, 0, 0);
  dots = Array.from({ length: 70 }, () => mote(true));
}
addEventListener('resize', sizeDust);
hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width; my = (e.clientY - r.top) / r.height; });
hero.addEventListener('pointerleave', () => { mx = .5; my = .42; });
const pad = (n, l = 2) => String(n).padStart(l, '0');
function tick(now) {
  if (!running) return;
  sx += (mx - sx) * .06; sy += (my - sy) * .06;
  glow.style.setProperty('--mx', sx * 100 + '%'); glow.style.setProperty('--my', sy * 100 + '%');
  title.style.setProperty('--px', (sx - .5) * -26 + 'px'); title.style.setProperty('--py', (sy - .42) * -16 + 'px');
  if (!reduce) {
    dx.clearRect(0, 0, DW, DH);
    for (const d of dots) {
      d.y -= d.v; d.s += .01; d.x += Math.sin(d.s) * .25; if (d.y < -10) Object.assign(d, mote(false));
      dx.fillStyle = `rgba(255,255,255,${d.a})`; dx.beginPath(); dx.arc(d.x, d.y, d.r, 0, 6.283); dx.fill();
    }
  }
  const t = (now - t0) / 1000, f = Math.floor(t * 24);
  if (f !== lastF) { lastF = f; tcEl.textContent = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(Math.floor(t) % 60)}:${pad(f % 24)}`; }
  requestAnimationFrame(tick);
}
function heroRun(on) {
  if (on && !running) { running = true; t0 = performance.now(); sizeDust(); requestAnimationFrame(tick); }
  else if (!on) running = false;
}

/* ---------- projects: project workspace ---------- */
const projectsHome = $('#projects-home');
const wbmDetail = $('#wbm-detail');
const openWbm = $('#open-wbm');
const backProjects = $('#back-projects');

function openProject() {
  projectsHome.hidden = true;
  wbmDetail.hidden = false;
  wbmDetail.scrollTop = 0;
  wbmDetail.classList.remove('detail-play');
  void wbmDetail.offsetWidth;
  wbmDetail.classList.add('detail-play');
}

function closeProject() {
  wbmDetail.hidden = true;
  projectsHome.hidden = false;
  replay(projectsHome);
}

openWbm.addEventListener('click', openProject);
backProjects.addEventListener('click', closeProject);

/* ---------- boot ---------- */
const start = location.hash.slice(1);
show(TABS.includes(start) ? start : 'home');
