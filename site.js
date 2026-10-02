/* Damaroo Arts — main site shell only.
 * Projects and Storyboard are separate HTML applications.
 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = ['home', 'tool', 'projects'];
const tabs = $$('.tab');
const ink = $('.tab-ink');
const wipe = $('.wipe');
const view = t => $('#view-' + t);
let cur = null;
let busy = false;
let toolLoaded = false;
let projectsLoaded = false;

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.headers || {}),
      'Cache-Control': 'no-cache',
    },
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
const authDetail = $('#auth-detail');
const authRetry = $('#auth-retry');

function showAccessError(title, message, retry = false, detail = '') {
  authGate.hidden = false;
  authGate.removeAttribute('aria-hidden');
  authGate.style.display = 'grid';
  document.body.classList.remove('app-ready');
  authTitle.textContent = title;
  authMessage.textContent = message;
  authRetry.hidden = !retry;
  authDetail.hidden = !detail;
  authDetail.textContent = detail;
}

async function verifyAccess() {
  try {
    const { data } = await api('me');
    if (!data?.ok || !data.user) {
      showAccessError('Access not granted.', 'Your Google account is authenticated, but it is not authorised for Damaroo Arts.');
      return false;
    }
    window.DamarooArts.user = data.user;
    $('#user-chip').hidden = false;
    $('#user-name').textContent = data.user.name || data.user.email;
    $('#user-role').textContent = String(data.user.role || '').replace('_', ' ');
    authGate.hidden = true;
    authGate.setAttribute('aria-hidden', 'true');
    authGate.style.display = 'none';
    document.body.classList.add('app-ready');
    window.DamarooArts.authenticated = true;
    return true;
  } catch (error) {
    if (error.status === 401) {
      showAccessError('Access session missing.', 'Cloudflare Access has not supplied an authenticated session to the application yet.', true, 'Refresh this page after completing the Google sign-in.');
      return false;
    }
    if (error.status === 403) {
      showAccessError('Account not authorised.', error.data?.error || 'This Damaroo Arts account is not authorised or has been disabled.', false, error.data?.email ? `Signed-in account: ${error.data.email}` : 'Ask an existing Damaroo Arts admin to authorise this Google account.');
      return false;
    }
    showAccessError('Unable to verify access.', 'The application could not reach its authorisation service.', true, error.message || 'Unknown error');
    return false;
  }
}

authRetry.addEventListener('click', () => location.reload());

window.DamarooArts = window.DamarooArts || {};
window.DamarooArts.verifyAccess = verifyAccess;
window.DamarooArts.version = '2026-10-02-project-shell-1';

function availableTabs() {
  return TABS.filter(t => {
    const button = $(`#tab-${t}`);
    return button && !button.hidden;
  });
}

function moveInk() {
  const t = tabs.find(x => x.dataset.tab === cur && !x.hidden);
  if (!t || !ink) return;
  ink.style.width = `${t.offsetWidth}px`;
  ink.style.transform = `translateX(${t.offsetLeft}px)`;
}

addEventListener('resize', moveInk);
document.fonts?.ready?.then(moveInk);

const replay = el => {
  if (!el) return;
  el.classList.remove('play');
  void el.offsetWidth;
  el.classList.add('play');
};

function loadStoryboard() {
  if (toolLoaded) return;
  toolLoaded = true;
  const frame = $('#sb-frame');
  if (!frame) return;
  frame.addEventListener('load', () => {
    frame.classList.add('ready');
    $('#tool-load')?.classList.add('done');
  }, { once: true });
  frame.src = new URL('./storyboard.html', location.href).href;
}

function loadProjects() {
  if (projectsLoaded) return;
  projectsLoaded = true;
  const frame = $('#projects-frame');
  if (!frame) return;
  frame.addEventListener('load', () => {
    frame.classList.add('ready');
    $('#projects-load')?.classList.add('done');
  }, { once: true });
  frame.src = new URL('./projects.html', location.href).href;
}

function show(tab) {
  if (!availableTabs().includes(tab)) tab = 'home';
  cur = tab;
  document.body.dataset.tab = tab;
  TABS.forEach(t => view(t)?.classList.toggle('active', t === tab));
  tabs.forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
  });
  moveInk();
  if (tab === 'home') replay($('#view-home')); else $('#view-home')?.classList.remove('play');
  if (tab === 'projects') {
    replay($('#view-projects'));
    loadProjects();
  } else {
    $('#view-projects')?.classList.remove('play');
  }
  if (tab === 'tool') {
    replay($('#view-tool'));
    loadStoryboard();
  } else {
    $('#view-tool')?.classList.remove('play');
  }
  heroRun(tab === 'home');
}

async function go(tab, push = true) {
  if (!availableTabs().includes(tab) || busy) return;
  if (tab === cur) return;
  if (push) {
    try { history.pushState(null, '', '#' + tab); } catch {}
  }
  if (reduce || cur === null || !wipe) {
    show(tab);
    return;
  }
  busy = true;
  const cover = (from, to, origin) => {
    wipe.style.transformOrigin = origin;
    return wipe.animate(
      [{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
      { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }
    ).finished;
  };
  await cover(0, 1, 'left');
  show(tab);
  await cover(1, 0, 'right');
  wipe.getAnimations().forEach(a => a.cancel());
  busy = false;
}

tabs.forEach(b => b.addEventListener('click', () => {
  if (!b.hidden) go(b.dataset.tab);
}));

$('.mark')?.addEventListener('click', e => {
  e.preventDefault();
  go('home');
});

$('.tabs')?.addEventListener('keydown', e => {
  const list = availableTabs();
  const i = list.indexOf(cur);
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d || i < 0) return;
  e.preventDefault();
  const n = list[(i + d + list.length) % list.length];
  go(n);
  $(`#tab-${n}`)?.focus();
});

addEventListener('popstate', () => handleRoute());

$$('.line').forEach(l => {
  l.innerHTML = [...l.dataset.t].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join('');
});

const hero = $('#hero');
const glow = $('.glow');
const title = $('.title');
const dust = $('#dust');
const dx = dust?.getContext('2d');
const tcEl = $('#tc');
let running = false, t0 = 0, mx = .5, my = .42, sx = .5, sy = .42, dots = [], DW = 0, DH = 0, lastF = -1;
const mote = init => ({ x: Math.random() * DW, y: init ? Math.random() * DH : DH + 10, r: .5 + Math.random() * 1.8, v: .15 + Math.random() * .4, s: Math.random() * 6.28, a: .15 + Math.random() * .45 });
function sizeDust() {
  if (!dust || !dx) return;
  const r = dust.getBoundingClientRect(), d = devicePixelRatio || 1;
  DW = r.width; DH = r.height;
  dust.width = DW * d; dust.height = DH * d;
  dx.setTransform(d, 0, 0, d, 0, 0);
  dots = Array.from({ length: 70 }, () => mote(true));
}
addEventListener('resize', sizeDust);
hero?.addEventListener('pointermove', e => {
  const r = hero.getBoundingClientRect();
  mx = (e.clientX - r.left) / r.width;
  my = (e.clientY - r.top) / r.height;
});
hero?.addEventListener('pointerleave', () => { mx = .5; my = .42; });
const pad = (n, l = 2) => String(n).padStart(l, '0');
function tick(now) {
  if (!running) return;
  sx += (mx - sx) * .06; sy += (my - sy) * .06;
  glow?.style.setProperty('--mx', sx * 100 + '%'); glow?.style.setProperty('--my', sy * 100 + '%');
  title?.style.setProperty('--px', (sx - .5) * -26 + 'px'); title?.style.setProperty('--py', (sy - .42) * -16 + 'px');
  if (!reduce && dx) {
    dx.clearRect(0, 0, DW, DH);
    for (const d of dots) {
      d.y -= d.v; d.s += .01; d.x += Math.sin(d.s) * .25;
      if (d.y < -10) Object.assign(d, mote(false));
      dx.fillStyle = `rgba(255,255,255,${d.a})`;
      dx.beginPath(); dx.arc(d.x, d.y, d.r, 0, 6.283); dx.fill();
    }
  }
  if (tcEl) {
    const t = (now - t0) / 1000, f = Math.floor(t * 24);
    if (f !== lastF) {
      lastF = f;
      tcEl.textContent = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(Math.floor(t) % 60)}:${pad(f % 24)}`;
    }
  }
  requestAnimationFrame(tick);
}
function heroRun(on) {
  if (on && !running) {
    running = true; t0 = performance.now(); sizeDust(); requestAnimationFrame(tick);
  } else if (!on) running = false;
}

function handleRoute() {
  const route = location.hash.slice(1) || 'home';
  const tab = availableTabs().includes(route) ? route : 'home';
  if (tab !== cur) go(tab, false);
}

async function boot() {
  window.DamarooArts.bootStartedAt = new Date().toISOString();
  try {
    const allowed = await verifyAccess();
    if (!allowed) {
      window.DamarooArts.bootResult = 'denied';
      return;
    }
    handleRoute();
    window.DamarooArts.bootResult = 'ready';
  } catch (error) {
    window.DamarooArts.bootResult = 'error';
    console.error('[Damaroo Arts] startup error:', error);
    showAccessError('Application error.', 'The application failed during startup.', true, error?.message || 'Unknown startup error');
  }
}

window.DamarooArts.boot = boot;
authGate.hidden = false;
boot();
