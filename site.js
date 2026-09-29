/* Damaroo Arts — site shell */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = ['home', 'tool', 'projects'];
const tabs = $$('.tab'), ink = $('.tab-ink'), wipe = $('.wipe');
const view = t => $('#view-' + t);
let cur = null, busy = false, toolLoaded = false;

/* ---------- authenticated API ---------- */
const state = { user: null, project: null, comments: [] };

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: 'same-origin',
    ...options
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { response, data };
}

const authGate = $('#auth-gate');
const authTitle = $('#auth-title');
const authMessage = $('#auth-message');
const authRetry = $('#auth-retry');

function showAccessError(title, message, retry = false) {
  authGate.hidden = false;
  authTitle.textContent = title;
  authMessage.textContent = message;
  authRetry.hidden = !retry;
}

async function verifyAccess() {
  try {
    const { data } = await api('me');

    if (!data?.ok || !data.user) {
      showAccessError(
        'Access denied.',
        'Your Google account is authenticated, but it is not authorised for Damaroo Arts.'
      );
      return false;
    }

    state.user = data.user;
    $('#user-chip').hidden = false;
    $('#user-name').textContent = data.user.name || data.user.email;
    $('#user-role').textContent = data.user.role.replace('_', ' ');
    authGate.hidden = true;
    return true;
  } catch (error) {
    showAccessError(
      error.status === 403 ? 'Account disabled.' : 'Unable to verify access.',
      error.status === 403
        ? 'This Damaroo Arts account has been disabled.'
        : 'The application could not verify your D1 authorisation.',
      true
    );
    return false;
  }
}

authRetry.addEventListener('click', () => location.reload());

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

async function openProject() {
  projectsHome.hidden = true;
  wbmDetail.hidden = false;
  wbmDetail.scrollTop = 0;
  wbmDetail.classList.remove('detail-play');
  void wbmDetail.offsetWidth;
  wbmDetail.classList.add('detail-play');
  await loadProject();
}

async function loadProject() {
  try {
    const projectResult = await api('projects/we-before-me');
    state.project = projectResult.data.project;
    await Promise.all([loadScript(), loadComments()]);
  } catch (error) {
    setScriptMessage(
      'Project unavailable.',
      error.data?.error || 'The project could not be loaded.'
    );
  }
}

async function loadScript() {
  const empty = $('#script-empty');
  const frame = $('#script-frame');

  try {
    empty.hidden = false;
    $('h4', empty).textContent = 'Loading screenplay.';
    $('p', empty).textContent = 'Fetching the latest authorised screenplay...';

    const { response } = await api('projects/we-before-me/script');
    const version = response.headers.get('X-Script-Version');

    $('#script-version-label').textContent =
      version ? `· V${String(version).padStart(3, '0')}` : '';

    /*
     * The PDF is served by the protected Pages Function.
     * No direct R2 URL is exposed to the browser.
     */
    frame.src = '/api/projects/we-before-me/script';
    frame.hidden = false;
    empty.hidden = true;
  } catch (error) {
    frame.hidden = true;
    setScriptMessage(
      'Screenplay unavailable.',
      error.data?.error || 'The latest screenplay could not be loaded.'
    );
  }
}

async function loadComments() {
  const list = $('#discussion-list');
  const empty = $('#discussion-empty');

  try {
    const { data } = await api('projects/we-before-me/comments');
    state.comments = data.comments || [];
    $('.comment-count').textContent = state.comments.length;

    if (!state.comments.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.innerHTML = state.comments.map(comment => `
      <article class="comment-card">
        <div class="comment-meta">
          <strong>${escapeHtml(comment.author_name || comment.author_email || 'User')}</strong>
          <span>${formatDate(comment.created_at)}</span>
        </div>
        <p>${escapeHtml(comment.body)}</p>
        <div class="comment-footer">
          <span>PAGE ${getCommentPage(comment)}</span>
          ${Number(comment.resolved) === 1 ? '<span class="resolved-label">RESOLVED</span>' : ''}
        </div>
      </article>
    `).join('');
  } catch {
    state.comments = [];
    list.innerHTML = '';
    empty.hidden = false;
  }
}

function getCommentPage(comment) {
  try {
    return JSON.parse(comment.anchor_value || '{}').page || '—';
  } catch {
    return '—';
  }
}

function setScriptMessage(title, message) {
  const empty = $('#script-empty');
  empty.hidden = false;
  $('h4', empty).textContent = title;
  $('p', empty).textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function closeProject() {
  wbmDetail.hidden = true;
  projectsHome.hidden = false;
  replay(projectsHome);
}

openWbm.addEventListener('click', openProject);
backProjects.addEventListener('click', closeProject);

/* ---------- boot ---------- */
async function boot() {
  const allowed = await verifyAccess();
  if (!allowed) return;

  const start = location.hash.slice(1);
  show(TABS.includes(start) ? start : 'home');
}

boot();
