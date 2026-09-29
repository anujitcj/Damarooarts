/* Damaroo Arts — authenticated production workspace */
const getPdfJs = () => window.DamarooPDF && window.DamarooPDF.getPdfJs ? window.DamarooPDF.getPdfJs() : Promise.reject(new Error('PDF viewer module failed to load.'));

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

const state = {
  user: null,
  project: null,
  comments: [],
  pdf: null,
  page: 1,
  scale: 1,
  fitScale: 1,
  commentMode: false,
  commentAnchor: null,
  commentSelectedText: '',
  suppressClick: false,
};

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
      showAccessError('Access not granted.', 'Your Google account is authenticated, but it is not authorised for Damaroo Arts.', false);
      return false;
    }
    state.user = data.user;
    $('#user-chip').hidden = false;
    $('#user-name').textContent = data.user.name || data.user.email;
    $('#user-role').textContent = String(data.user.role || '').replace('_', ' ');
    $('#upload-box').hidden = !['admin', 'script_editor'].includes(data.user.role);
    $('.admin-only').hidden = data.user.role !== 'admin';
    authGate.hidden = true;
    authGate.setAttribute('aria-hidden', 'true');
    authGate.style.display = 'none';
    document.body.classList.add('app-ready');
    window.DamarooArts.authenticated = true;
    return true;
  } catch (error) {
    if (error.status === 403 && error.data?.reason === 'not_authorized') {
      showAccessError('Access not granted.', 'Your Google account is signed in through Cloudflare Access, but this account has not been authorised in D1.', false, error.data.email ? `Signed-in account: ${error.data.email}` : 'Ask an existing Damaroo Arts admin to authorise this Google account.');
      return false;
    }
    if (error.status === 401) {
      showAccessError('Access session missing.', 'Cloudflare Access has not supplied an authenticated session to the application yet.', true, 'Refresh this page after completing the Google sign-in.');
      return false;
    }
    if (error.status === 403) {
      showAccessError('Account disabled.', 'This Damaroo Arts account has been disabled.', false);
      return false;
    }
    showAccessError('Unable to verify access.', 'The application could not reach its authorisation service.', true, error.message || 'Unknown error');
    return false;
  }
}

authRetry.addEventListener('click', () => location.reload());

// Expose a small diagnostic surface for the browser console.
// ES modules do not place top-level functions on window, so typeof verifyAccess
// would otherwise be "undefined" even when this file is loaded correctly.
window.DamarooArts = window.DamarooArts || {};
window.DamarooArts.verifyAccess = verifyAccess;
window.DamarooArts.boot = boot;
window.DamarooArts.version = '2026-09-29.5';

function availableTabs() {
  return TABS.filter(t => {
    const button = $(`#tab-${t}`);
    return button && !button.hidden;
  });
}
function moveInk() {
  const t = tabs.find(x => x.dataset.tab === cur && !x.hidden);
  if (!t) return;
  ink.style.width = `${t.offsetWidth}px`;
  ink.style.transform = `translateX(${t.offsetLeft}px)`;
}
addEventListener('resize', moveInk);
document.fonts?.ready?.then(moveInk);

const replay = el => { if (!el) return; el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); };
function show(tab) {
  if (!availableTabs().includes(tab)) tab = 'home';
  cur = tab;
  document.body.dataset.tab = tab;
  TABS.forEach(t => view(t)?.classList.toggle('active', t === tab));
  tabs.forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  moveInk();
  if (tab === 'home') replay($('#view-home')); else $('#view-home')?.classList.remove('play');
  if (tab === 'projects') replay($('#view-projects')); else $('#view-projects')?.classList.remove('play');
  if (tab === 'tool' && !toolLoaded) {
    toolLoaded = true;
    const f = $('#sb-frame');
    f.addEventListener('load', () => { f.classList.add('ready'); $('#tool-load')?.classList.add('done'); }, { once: true });
    f.src = new URL('./storyboard.html', location.href).href;
  }
  heroRun(tab === 'home');
}
async function go(tab, push = true) {
  if (!availableTabs().includes(tab) || busy) return;
  if (tab === 'projects' && document.body.classList.contains('project-open')) {
    closeProject(push);
    return;
  }
  if (tab === cur && !document.body.classList.contains('project-open')) return;
  if (push) { try { history.pushState(null, '', '#' + tab); } catch {} }
  if (reduce || cur === null) { show(tab); return; }
  busy = true;
  wipe.style.transformOrigin = 'left';
  const cover = (from, to, origin) => { wipe.style.transformOrigin = origin; return wipe.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }).finished; };
  await cover(0, 1, 'left');
  show(tab);
  await cover(1, 0, 'right');
  wipe.getAnimations().forEach(a => a.cancel());
  busy = false;
}
tabs.forEach(b => b.addEventListener('click', () => { if (!b.hidden) go(b.dataset.tab); }));
$('.mark').addEventListener('click', e => { e.preventDefault(); go('home'); });
$('.tabs').addEventListener('keydown', e => {
  const list = availableTabs();
  const i = list.indexOf(cur);
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d || i < 0) return;
  e.preventDefault();
  const n = list[(i + d + list.length) % list.length];
  go(n);
  $(`#tab-${n}`)?.focus();
});
addEventListener('popstate', () => handleRoute(false));

$$('.line').forEach(l => { l.innerHTML = [...l.dataset.t].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join(''); });
const hero = $('#hero'), glow = $('.glow'), title = $('.title'), dust = $('#dust'), dx = dust.getContext('2d'), tcEl = $('#tc');
let running = false, t0 = 0, mx = .5, my = .42, sx = .5, sy = .42, dots = [], DW = 0, DH = 0, lastF = -1;
const mote = init => ({ x: Math.random() * DW, y: init ? Math.random() * DH : DH + 10, r: .5 + Math.random() * 1.8, v: .15 + Math.random() * .4, s: Math.random() * 6.28, a: .15 + Math.random() * .45 });
function sizeDust() { const r = dust.getBoundingClientRect(), d = devicePixelRatio || 1; DW = r.width; DH = r.height; dust.width = DW * d; dust.height = DH * d; dx.setTransform(d, 0, 0, d, 0, 0); dots = Array.from({ length: 70 }, () => mote(true)); }
addEventListener('resize', sizeDust);
hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width; my = (e.clientY - r.top) / r.height; });
hero.addEventListener('pointerleave', () => { mx = .5; my = .42; });
const pad = (n, l = 2) => String(n).padStart(l, '0');
function tick(now) {
  if (!running) return;
  sx += (mx - sx) * .06; sy += (my - sy) * .06;
  glow.style.setProperty('--mx', sx * 100 + '%'); glow.style.setProperty('--my', sy * 100 + '%');
  title.style.setProperty('--px', (sx - .5) * -26 + 'px'); title.style.setProperty('--py', (sy - .42) * -16 + 'px');
  if (!reduce) { dx.clearRect(0, 0, DW, DH); for (const d of dots) { d.y -= d.v; d.s += .01; d.x += Math.sin(d.s) * .25; if (d.y < -10) Object.assign(d, mote(false)); dx.fillStyle = `rgba(255,255,255,${d.a})`; dx.beginPath(); dx.arc(d.x, d.y, d.r, 0, 6.283); dx.fill(); } }
  const t = (now - t0) / 1000, f = Math.floor(t * 24);
  if (f !== lastF) { lastF = f; tcEl.textContent = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(Math.floor(t) % 60)}:${pad(f % 24)}`; }
  requestAnimationFrame(tick);
}
function heroRun(on) { if (on && !running) { running = true; t0 = performance.now(); sizeDust(); requestAnimationFrame(tick); } else if (!on) running = false; }

const projectsHome = $('#projects-home');
const wbmDetail = $('#wbm-detail');
const openWbm = $('#open-wbm');
const backProjects = $('#back-projects');

async function openProject(push = true) {
  if (push) { try { history.pushState(null, '', '#projects/we-before-me'); } catch {} }
  show('projects');
  document.body.classList.add('project-open');
  projectsHome.hidden = true;
  wbmDetail.hidden = false;
  $('#view-projects').scrollTop = 0;
  replay(wbmDetail);
  await loadProject();
}
async function loadProject() {
  try {
    const projectResult = await api('projects/we-before-me');
    state.project = projectResult.data.project;
    await Promise.allSettled([loadScript(), loadComments()]);
    if (state.user?.role === 'admin') await loadAdmin();
  } catch (error) {
    setScriptMessage('Project unavailable.', error.data?.error || error.message || 'The project could not be loaded.');
  }
}

async function loadScript() {
  try {
    $('#script-empty').hidden = false;
    $('#pdf-viewer').hidden = true;
    $('h4', $('#script-empty')).textContent = 'Loading screenplay.';
    $('p', $('#script-empty')).textContent = 'Fetching the latest authorised screenplay...';
    const { response } = await api('projects/we-before-me/script');
    const version = response.headers.get('X-Script-Version');
    $('#script-version-label').textContent = version ? `· V${String(version).padStart(3, '0')}` : '';
    const buffer = await response.arrayBuffer();
    $('#status-version').textContent = version ? `Version ${String(version).padStart(3, '0')} loaded` : 'Latest version loaded';
    $('#status-meta').textContent = 'Private screenplay · current version only';
    await openPdf(buffer);
  } catch (error) {
    $('#pdf-viewer').hidden = true;
    setScriptMessage('Screenplay unavailable.', error.data?.error || error.message || 'The latest screenplay could not be loaded.');
  }
}
async function openPdf(buffer) {
  const pdfjs = await getPdfJs();
  if (state.pdf) { try { await state.pdf.destroy(); } catch {} }
  state.pdf = await pdfjs.getDocument({ data: buffer }).promise;
  state.page = 1;
  state.scale = 1;
  state.fitScale = 1;
  $('#script-empty').hidden = true;
  $('#pdf-viewer').hidden = false;
  await calculateFitScale();
  state.scale = state.fitScale;
  await renderPdfPage();
}
async function calculateFitScale() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1 });
  const stage = $('#pdf-stage');
  const availableWidth = Math.max(320, stage.clientWidth - 56);
  const availableHeight = Math.max(360, stage.clientHeight - 56);
  state.fitScale = Math.min(availableWidth / base.width, availableHeight / base.height, 1.6);
}
async function renderPdfPage() {
  if (!state.pdf) return;
  const pdfjs = await getPdfJs();
  const page = await state.pdf.getPage(state.page);
  const viewport = page.getViewport({ scale: state.scale });
  const canvas = $('#pdf-canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const textLayer = $('#pdf-text-layer');
  const pageWrap = $('#pdf-page-wrap');
  const outputScale = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  pageWrap.style.width = `${viewport.width}px`; pageWrap.style.height = `${viewport.height}px`;
  textLayer.innerHTML = ''; textLayer.style.width = `${viewport.width}px`; textLayer.style.height = `${viewport.height}px`;
  const renderTask = page.render({ canvasContext: context, viewport, transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null });
  const textContent = await page.getTextContent();
  await renderTask.promise;
  await pdfjs.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport }).promise;
  updatePdfControls();
  renderPdfMarkers();
}
function updatePdfControls() {
  if (!state.pdf) return;
  $('#pdf-page').textContent = state.page; $('#pdf-pages').textContent = state.pdf.numPages; $('#pdf-zoom-label').textContent = `${Math.round(state.scale * 100)}%`;
  $('#pdf-prev').disabled = state.page <= 1; $('#pdf-next').disabled = state.page >= state.pdf.numPages;
}
$('#pdf-prev').addEventListener('click', async () => { if (state.pdf && state.page > 1) { state.page--; await renderPdfPage(); } });
$('#pdf-next').addEventListener('click', async () => { if (state.pdf && state.page < state.pdf.numPages) { state.page++; await renderPdfPage(); } });
$('#pdf-zoom-out').addEventListener('click', async () => { if (state.pdf) { state.scale = Math.max(.5, state.scale - .1); await renderPdfPage(); } });
$('#pdf-zoom-in').addEventListener('click', async () => { if (state.pdf) { state.scale = Math.min(2.5, state.scale + .1); await renderPdfPage(); } });
$('#pdf-fit').addEventListener('click', async () => { if (state.pdf) { await calculateFitScale(); state.scale = state.fitScale; await renderPdfPage(); } });
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(async () => { if (!state.pdf) return; const oldFit = state.fitScale; await calculateFitScale(); if (Math.abs(state.scale - oldFit) < .06) { state.scale = state.fitScale; await renderPdfPage(); } }, 180); });

function setCommentMode(on) {
  state.commentMode = Boolean(on);
  const button = $('#comment-mode');
  button.setAttribute('aria-pressed', String(state.commentMode));
  button.textContent = `Comment mode: ${state.commentMode ? 'ON' : 'OFF'}`;
  button.classList.toggle('active', state.commentMode);
  $('#pdf-hint').textContent = state.commentMode ? 'COMMENT MODE ON · SELECT TEXT OR CLICK A LOCATION' : 'COMMENT MODE OFF · TURN IT ON TO ANCHOR A COMMENT';
  if (!state.commentMode) window.getSelection()?.removeAllRanges();
}
$('#comment-mode').addEventListener('click', () => setCommentMode(!state.commentMode));

$('#pdf-page-wrap').addEventListener('mouseup', () => {
  if (!state.commentMode || !state.pdf) return;
  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!text) return;
    const range = selection.getRangeAt(0);
    if (!$('#pdf-text-layer').contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    const pageRect = $('#pdf-page-wrap').getBoundingClientRect();
    state.commentAnchor = { page: state.page, x: Math.max(0, Math.min(1, (rect.left + rect.width / 2 - pageRect.left) / pageRect.width)), y: Math.max(0, Math.min(1, (rect.top + rect.height / 2 - pageRect.top) / pageRect.height)) };
    state.commentSelectedText = text;
    state.suppressClick = true;
    openCommentComposer();
  }, 0);
});
$('#pdf-page-wrap').addEventListener('click', event => {
  if (!state.commentMode || !state.pdf) return;
  if (event.target.closest('.pdf-comment-marker')) return;
  if (state.suppressClick) { state.suppressClick = false; return; }
  if (window.getSelection()?.toString().trim()) return;
  const rect = $('#pdf-page-wrap').getBoundingClientRect();
  state.commentAnchor = { page: state.page, x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  state.commentSelectedText = '';
  openCommentComposer();
});

function renderPdfMarkers() {
  const layer = $('#pdf-marker-layer');
  layer.innerHTML = '';
  for (const comment of state.comments) {
    let anchor; try { anchor = JSON.parse(comment.anchor_value || '{}'); } catch { continue; }
    if (Number(anchor.page) !== Number(state.page) || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') continue;
    const marker = document.createElement('button');
    marker.type = 'button'; marker.className = `pdf-comment-marker${Number(comment.resolved) === 1 ? ' resolved' : ''}`;
    marker.style.left = `${anchor.x * 100}%`; marker.style.top = `${anchor.y * 100}%`; marker.title = comment.body || 'Comment';
    marker.addEventListener('click', e => { e.stopPropagation(); openCommentDetails(comment); });
    layer.appendChild(marker);
  }
}

async function loadComments() {
  const list = $('#discussion-list');
  const empty = $('#discussion-empty');
  try {
    const { data } = await api('projects/we-before-me/comments');
    state.comments = data.comments || [];
    $('.comment-count').textContent = state.comments.length;
    if (!state.comments.length) { list.innerHTML = ''; empty.hidden = false; renderPdfMarkers(); return; }
    empty.hidden = true;
    list.innerHTML = '';
    state.comments.forEach(comment => list.appendChild(buildCommentCard(comment)));
    renderPdfMarkers();
  } catch (error) {
    state.comments = []; list.innerHTML = ''; empty.hidden = false; showToast(error.data?.error || 'Could not load comments.');
  }
}
function buildCommentCard(comment) {
  const article = document.createElement('article'); article.className = `comment-card${Number(comment.resolved) === 1 ? ' is-resolved' : ''}`; article.tabIndex = 0;
  const meta = document.createElement('div'); meta.className = 'comment-meta';
  const strong = document.createElement('strong'); strong.textContent = comment.author_name || comment.author_email || 'User';
  const date = document.createElement('span'); date.textContent = formatDate(comment.created_at); meta.append(strong, date);
  if (comment.selected_text) { const quote = document.createElement('blockquote'); quote.textContent = comment.selected_text; article.append(meta, quote); } else article.append(meta);
  const body = document.createElement('p'); body.textContent = comment.body; article.append(body);
  const footer = document.createElement('div'); footer.className = 'comment-footer';
  const page = document.createElement('button'); page.type = 'button'; page.className = 'comment-location'; page.textContent = `PAGE ${getCommentPage(comment)}`; page.addEventListener('click', e => { e.stopPropagation(); jumpToComment(comment); }); footer.appendChild(page);
  if (Number(comment.resolved) === 1) { const resolved = document.createElement('span'); resolved.className = 'resolved-label'; resolved.textContent = 'RESOLVED'; footer.appendChild(resolved); }
  if (['admin', 'script_editor'].includes(state.user?.role)) { const resolve = document.createElement('button'); resolve.type = 'button'; resolve.className = 'comment-resolve'; resolve.textContent = Number(comment.resolved) === 1 ? 'REOPEN' : 'RESOLVE'; resolve.addEventListener('click', async e => { e.stopPropagation(); await toggleComment(comment); }); footer.appendChild(resolve); }
  article.appendChild(footer);
  article.addEventListener('click', () => jumpToComment(comment));
  article.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToComment(comment); } });
  return article;
}
function getCommentPage(comment) { try { return JSON.parse(comment.anchor_value || '{}').page || '—'; } catch { return '—'; } }
async function jumpToComment(comment) {
  let anchor; try { anchor = JSON.parse(comment.anchor_value || '{}'); } catch { return; }
  if (!anchor.page) return;
  if (state.page !== Number(anchor.page)) { state.page = Number(anchor.page); await renderPdfPage(); }
  const stage = $('#pdf-stage');
  const pageRect = $('#pdf-page-wrap').getBoundingClientRect();
  if (typeof anchor.y === 'number') stage.scrollTop += pageRect.top + anchor.y * pageRect.height - stage.getBoundingClientRect().top - stage.clientHeight / 3;
  if (typeof anchor.x === 'number') stage.scrollLeft += pageRect.left + anchor.x * pageRect.width - stage.getBoundingClientRect().left - stage.clientWidth / 2;
  openCommentDetails(comment);
}
function openCommentDetails(comment) {
  state.commentAnchor = parseAnchor(comment);
  state.commentSelectedText = comment.selected_text || '';
  $('#comment-title').textContent = 'Production note';
  $('#comment-context').textContent = comment.selected_text ? `“${comment.selected_text}”` : `Page ${getCommentPage(comment)}`;
  $('#comment-anchor-label').textContent = `Page ${getCommentPage(comment)} · ${Number(comment.resolved) === 1 ? 'Resolved' : 'Open'}`;
  $('#comment-body').value = comment.body || '';
  $('#comment-body').readOnly = true;
  $('#save-comment').hidden = true;
  $('#comment-modal').hidden = false;
}
function parseAnchor(comment) { try { return JSON.parse(comment.anchor_value || '{}'); } catch { return null; } }
function openCommentComposer() {
  $('#comment-title').textContent = 'Add production note';
  $('#comment-context').textContent = state.commentSelectedText ? `“${state.commentSelectedText}”` : 'Comment anchored to a page location.';
  $('#comment-anchor-label').textContent = `Page ${state.commentAnchor?.page || '—'}`;
  $('#comment-body').readOnly = false; $('#comment-body').value = ''; $('#save-comment').hidden = false;
  $('#comment-modal').hidden = false;
  setTimeout(() => $('#comment-body').focus(), 20);
}
function closeCommentModal() { $('#comment-modal').hidden = true; $('#comment-body').value = ''; $('#comment-body').readOnly = false; $('#save-comment').hidden = false; state.commentAnchor = null; state.commentSelectedText = ''; }
$$('[data-close-comment]').forEach(el => el.addEventListener('click', closeCommentModal));
$('#save-comment').addEventListener('click', async () => {
  const body = $('#comment-body').value.trim();
  if (!body || !state.commentAnchor) { showToast('Write a comment before saving.'); return; }
  const button = $('#save-comment'); button.disabled = true;
  try {
    await api('projects/we-before-me/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anchor: state.commentAnchor, selected_text: state.commentSelectedText, body }) });
    closeCommentModal(); await loadComments(); showToast('Comment added.');
  } catch (error) { showToast(error.data?.error || 'Could not save comment.'); } finally { button.disabled = false; }
});
async function toggleComment(comment) {
  try { await api(`projects/we-before-me/comments/${comment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: Number(comment.resolved) !== 1 }) }); await loadComments(); showToast(Number(comment.resolved) === 1 ? 'Comment reopened.' : 'Comment resolved.'); } catch (error) { showToast(error.data?.error || 'Could not update comment.'); }
}

function setScriptMessage(title, message) { $('#script-empty').hidden = false; $('h4', $('#script-empty')).textContent = title; $('p', $('#script-empty')).textContent = message; }
function formatDate(value) {
  if (!value) return '';
  let input = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) input = input.replace(' ', 'T') + 'Z';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input)) input += 'Z';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/* ---------- upload ---------- */
$('#upload-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget; const fileInput = $('#script-file'); const status = $('#upload-status'); const button = $('button[type="submit"]', form);
  const file = fileInput.files?.[0];
  if (!file) return;
  button.disabled = true; status.textContent = 'Uploading screenplay…';
  try {
    const fd = new FormData(); fd.append('file', file); fd.append('notes', $('#upload-notes').value.trim());
    const { data } = await api('projects/we-before-me/script', { method: 'POST', body: fd });
    status.textContent = `Uploaded V${String(data.version).padStart(3, '0')}.`;
    form.reset();
    await Promise.allSettled([loadScript(), loadComments()]);
    if (state.user?.role === 'admin') await loadAdmin();
    showToast('New screenplay version uploaded.');
  } catch (error) { status.textContent = error.data?.error || error.message || 'Upload failed.'; }
  finally { button.disabled = false; }
});

/* ---------- admin ---------- */
$$('.workspace-tab').forEach(button => button.addEventListener('click', () => {
  if (button.hidden) return;
  const target = button.dataset.workspace;
  $$('.workspace-tab').forEach(b => b.classList.toggle('active', b === button));
  $$('[data-workspace-view]').forEach(v => { const active = v.dataset.workspaceView === target; v.hidden = !active; v.classList.toggle('active', active); });
  if (target === 'admin' && state.user?.role === 'admin') loadAdmin();
}));

async function loadAdmin() {
  if (state.user?.role !== 'admin') return;
  const jobs = [loadAdminUsers(), loadAdminVersions(), loadAdminLogs()];
  const results = await Promise.allSettled(jobs);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) showToast(failed.reason?.message || 'One or more admin panels could not be loaded.');
}
async function loadAdminUsers() {
  try {
    const { data } = await api('admin/users'); const list = $('#admin-user-list'); list.innerHTML = '';
    (data.users || []).forEach(user => list.appendChild(buildAdminUser(user)));
    $('#admin-user-status').textContent = `${data.users?.length || 0} authorised account(s).`;
  } catch (error) { $('#admin-user-status').textContent = error.data?.error || 'Could not load users.'; throw error; }
}
function buildAdminUser(user) {
  const row = document.createElement('div'); row.className = 'admin-user-row';
  const info = document.createElement('div'); info.innerHTML = `<strong></strong><small></small>`; $('strong', row).textContent = user.name || user.email; $('small', row).textContent = user.email;
  const controls = document.createElement('div'); controls.className = 'admin-user-controls';
  const role = document.createElement('select'); ['reader','script_editor','admin'].forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r.replace('_',' '); role.appendChild(o); }); role.value = user.role;
  const active = document.createElement('button'); active.type = 'button'; active.className = `mini-toggle${Number(user.active) ? ' on' : ''}`; active.textContent = Number(user.active) ? 'ACTIVE' : 'DISABLED';
  role.addEventListener('change', () => updateUser(user, { role: role.value })); active.addEventListener('click', () => updateUser(user, { active: !Number(user.active) }));
  controls.append(role, active); row.append(info, controls); return row;
}
async function updateUser(user, changes) { try { await api(`admin/users/${user.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(changes) }); await loadAdminUsers(); showToast('User updated.'); } catch (error) { showToast(error.data?.error || 'Could not update user.'); await loadAdminUsers(); } }
$('#admin-add-form').addEventListener('submit', async e => {
  e.preventDefault(); const status = $('#admin-user-status');
  try { await api('admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:$('#admin-email').value.trim(), name:$('#admin-name').value.trim(), role:$('#admin-role').value }) }); e.currentTarget.reset(); await loadAdminUsers(); showToast('User authorised.'); }
  catch (error) { status.textContent = error.data?.error || 'Could not authorise user.'; }
});
async function loadAdminVersions() {
  const list = $('#admin-version-list'); list.innerHTML = '<div class="admin-loading">Loading archive…</div>';
  try { const { data } = await api('admin/projects/we-before-me/versions'); list.innerHTML = ''; (data.versions || []).forEach(v => list.appendChild(buildVersionRow(v))); if (!data.versions?.length) list.innerHTML = '<div class="admin-loading">No versions stored.</div>'; }
  catch (error) { list.innerHTML = `<div class="admin-error">${escapeHtml(error.data?.error || 'Could not load archive.')}</div>`; throw error; }
}
function buildVersionRow(v) { const row=document.createElement('div'); row.className='admin-version-row'; row.innerHTML='<div><strong></strong><small></small></div><div class="admin-version-actions"><button type="button" class="btn-secondary">View</button></div>'; $('strong',row).textContent=`V${String(v.version_number).padStart(3,'0')} · ${v.file_name}`; $('small',row).textContent=`${v.uploaded_by_name || v.uploaded_by_email || 'Unknown'} · ${formatDate(v.created_at)}${v.notes ? ` · ${v.notes}` : ''}`; $('button',row).addEventListener('click',()=>openAdminVersion(v)); return row; }
async function openAdminVersion(v) {
  try {
    $$('.workspace-tab').forEach(b => b.classList.toggle('active', b.dataset.workspace === 'script'));
    $$('[data-workspace-view]').forEach(view => { const active = view.dataset.workspaceView === 'script'; view.hidden = !active; view.classList.toggle('active', active); });
    const { response } = await api(`admin/projects/we-before-me/versions/${v.id}`);
    const buffer = await response.arrayBuffer();
    await openPdf(buffer);
    $('#script-version-label').textContent = `· V${String(v.version_number).padStart(3,'0')} · ADMIN ARCHIVE`;
    $('#status-version').textContent = `Archived version ${String(v.version_number).padStart(3,'0')}`;
    $('#status-meta').textContent = 'Admin-only archive view';
    showToast(`Viewing V${v.version_number}.`);
  } catch(error) {
    showToast(error.data?.error || 'Could not open archived version.');
  }
}
async function loadAdminLogs() {
  const list=$('#admin-log-list'); list.innerHTML='<div class="admin-loading">Loading audit log…</div>';
  try { const {data}=await api('admin/projects/we-before-me/logs'); list.innerHTML=''; (data.logs||[]).forEach(log=>{ const row=document.createElement('div'); row.className='admin-log-row'; row.innerHTML='<strong></strong><span></span><small></small>'; $('strong',row).textContent=log.action.replaceAll('_',' '); $('span',row).textContent=log.description; $('small',row).textContent=formatDate(log.created_at); list.appendChild(row); }); if(!data.logs?.length) list.innerHTML='<div class="admin-loading">No audit entries yet.</div>'; }
  catch(error){ list.innerHTML=`<div class="admin-error">${escapeHtml(error.data?.error || 'Could not load audit log.')}</div>`; throw error; }
}

function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function showToast(message) { const toast=$('#toast'); toast.textContent=message; toast.hidden=false; clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.hidden=true,3200); }
function closeProject(push = true) {
  document.body.classList.remove('project-open');
  wbmDetail.hidden = true;
  projectsHome.hidden = false;
  replay(projectsHome);
  if (push) { try { history.pushState(null, '', '#projects'); } catch {} }
  show('projects');
}
function handleRoute(pushFallback = true) {
  const route = location.hash.slice(1) || 'home';
  if (route === 'projects/we-before-me') {
    if (cur !== 'projects') show('projects');
    if (!document.body.classList.contains('project-open')) openProject(false);
    return;
  }
  const tab = availableTabs().includes(route) ? route : 'home';
  if (document.body.classList.contains('project-open')) closeProject(false);
  if (tab !== cur) go(tab, false);
}
openWbm.addEventListener('click', () => openProject(true));
backProjects.addEventListener('click', () => closeProject(true));

authGate.hidden = false;
async function boot() {
  window.DamarooArts.bootStartedAt = new Date().toISOString();
  try {
    const allowed = await verifyAccess();
    if (!allowed) {
      window.DamarooArts.bootResult = 'denied';
      return;
    }
    handleRoute(false);
    window.DamarooArts.bootResult = 'ready';
  } catch (error) {
    window.DamarooArts.bootResult = 'error';
    console.error('[Damaroo Arts] startup error:', error);
    showAccessError('Application error.', 'The application failed during startup.', true, error?.message || 'Unknown startup error');
  }
}
window.DamarooArts.boot = boot;
boot();
