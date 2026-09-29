/* Damaroo Arts private production application */
import { getPdfJs } from './pdf/pdf.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = ['home', 'tool', 'projects'];
const tabs = $$('.tab'), ink = $('.tab-ink'), wipe = $('.wipe');
const view = t => $('#view-' + t);
let cur = null, busy = false, toolLoaded = false;

const state = {
  user: null, project: null, comments: [],
  pdf: null, pdfBuffer: null, page: 1, scale: 1, fitScale: 1,
  selectedText: '', selectedRange: null, selectionAnchor: null,
};

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status; error.data = data; throw error;
  }
  return { response, data };
}

const authGate = $('#auth-gate'), authTitle = $('#auth-title'), authMessage = $('#auth-message'), authRetry = $('#auth-retry');
function showAccessError(title, message, retry = false) { authGate.hidden = false; authTitle.textContent = title; authMessage.textContent = message; authRetry.hidden = !retry; }
async function verifyAccess() {
  try {
    const { data } = await api('me');
    if (!data?.ok || !data.user) { showAccessError('Access denied.', 'Your Google account is authenticated, but it is not authorised for Damaroo Arts.'); return false; }
    state.user = data.user;
    $('#user-chip').hidden = false;
    $('#user-name').textContent = data.user.name || data.user.email;
    $('#user-role').textContent = data.user.role.replace('_', ' ');
    $('.admin-only').hidden = data.user.role !== 'admin';
    $$('.editor-only').forEach(x => x.hidden = !(data.user.role === 'admin' || data.user.role === 'script_editor'));
    authGate.hidden = true;
    return true;
  } catch (error) {
    showAccessError(error.status === 403 ? 'Account disabled.' : 'Unable to verify access.', error.status === 403 ? 'This Damaroo Arts account has been disabled.' : 'The application could not verify your D1 authorisation.', true); return false;
  }
}
authRetry.addEventListener('click', () => location.reload());

function moveInk() { const t = tabs.find(x => x.dataset.tab === cur); if (!t) return; ink.style.width = t.offsetWidth + 'px'; ink.style.transform = `translateX(${t.offsetLeft}px)`; }
addEventListener('resize', moveInk); document.fonts && document.fonts.ready.then(moveInk);
const replay = el => { el.classList.remove('play'); void el.offsetWidth; el.classList.add('play'); };
function show(tab) {
  cur = tab; document.body.dataset.tab = tab;
  TABS.forEach(t => view(t).classList.toggle('active', t === tab));
  tabs.forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }); moveInk();
  if (tab === 'home') replay($('#view-home')); else $('#view-home').classList.remove('play');
  if (tab === 'projects') replay($('#view-projects')); else $('#view-projects').classList.remove('play');
  if (tab === 'tool' && !toolLoaded) { toolLoaded = true; const f = $('#sb-frame'); f.addEventListener('load', () => { f.classList.add('ready'); $('#tool-load').classList.add('done'); }, { once: true }); f.src = 'storyboard.html'; }
  heroRun(tab === 'home');
}
async function go(tab, push = true) {
  if (tab === cur || busy || !TABS.includes(tab)) return;
  if (push) { try { history.pushState(null, '', '#' + tab); } catch {} }
  if (reduce || cur === null) { show(tab); return; }
  busy = true;
  const cover = (from, to, origin) => { wipe.style.transformOrigin = origin; return wipe.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' }).finished; };
  await cover(0, 1, 'left'); show(tab); await cover(1, 0, 'right'); wipe.getAnimations().forEach(a => a.cancel()); busy = false;
}
tabs.forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$('.mark').addEventListener('click', e => { e.preventDefault(); go('home'); });
$('.tabs').addEventListener('keydown', e => { const i = TABS.indexOf(cur), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; const n = TABS[(i + d + TABS.length) % TABS.length]; go(n); $('#tab-' + n).focus(); });
addEventListener('popstate', () => go(location.hash.slice(1) || 'home', false));
$$('.line').forEach(l => { l.innerHTML = [...l.dataset.t].map((c, i) => `<span class="ch" style="--i:${i}">${c}</span>`).join(''); });

/* Hero */
const hero = $('#hero'), glow = $('.glow'), title = $('.title'), dust = $('#dust'), dx = dust.getContext('2d'), tcEl = $('#tc');
let running = false, t0 = 0, mx = .5, my = .42, sx = .5, sy = .42, dots = [], DW = 0, DH = 0, lastF = -1;
const mote = init => ({ x: Math.random() * DW, y: init ? Math.random() * DH : DH + 10, r: .5 + Math.random() * 1.8, v: .15 + Math.random() * .4, s: Math.random() * 6.28, a: .15 + Math.random() * .45 });
function sizeDust() { const r = dust.getBoundingClientRect(), d = devicePixelRatio || 1; DW = r.width; DH = r.height; dust.width = DW * d; dust.height = DH * d; dx.setTransform(d,0,0,d,0,0); dots = Array.from({length:70},()=>mote(true)); }
addEventListener('resize', sizeDust); hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); mx=(e.clientX-r.left)/r.width; my=(e.clientY-r.top)/r.height; }); hero.addEventListener('pointerleave',()=>{mx=.5;my=.42;});
const pad=(n,l=2)=>String(n).padStart(l,'0');
function tick(now){ if(!running)return; sx+=(mx-sx)*.06;sy+=(my-sy)*.06;glow.style.setProperty('--mx',sx*100+'%');glow.style.setProperty('--my',sy*100+'%');title.style.setProperty('--px',(sx-.5)*-26+'px');title.style.setProperty('--py',(sy-.42)*-16+'px');if(!reduce){dx.clearRect(0,0,DW,DH);for(const d of dots){d.y-=d.v;d.s+=.01;d.x+=Math.sin(d.s)*.25;if(d.y<-10)Object.assign(d,mote(false));dx.fillStyle=`rgba(255,255,255,${d.a})`;dx.beginPath();dx.arc(d.x,d.y,d.r,0,6.283);dx.fill();}}const t=(now-t0)/1000,f=Math.floor(t*24);if(f!==lastF){lastF=f;tcEl.textContent=`${pad(Math.floor(t/3600))}:${pad(Math.floor(t/60)%60)}:${pad(Math.floor(t)%60)}:${pad(f%24)}`;}requestAnimationFrame(tick);}
function heroRun(on){if(on&&!running){running=true;t0=performance.now();sizeDust();requestAnimationFrame(tick);}else if(!on)running=false;}

/* Project workspace */
const projectsHome=$('#projects-home'), wbmDetail=$('#wbm-detail');
async function openProject(){projectsHome.hidden=true;wbmDetail.hidden=false;wbmDetail.scrollTop=0;replay(wbmDetail);await loadProject();}
async function loadProject(){try{const projectResult=await api('projects/we-before-me');state.project=projectResult.data.project;await Promise.all([loadScript(),loadComments()]);if(state.user.role==='admin')await loadAdmin();}catch(error){setScriptMessage('Project unavailable.',error.data?.error||'The project could not be loaded.');}}
function closeProject(){wbmDetail.hidden=true;projectsHome.hidden=false;replay(projectsHome);}
$('#open-wbm').addEventListener('click',openProject);$('#back-projects').addEventListener('click',closeProject);

/* Workspace tabs */
$$('.workspace-tab').forEach(btn=>btn.addEventListener('click',()=>{const name=btn.dataset.workspace;$$('.workspace-tab').forEach(x=>x.classList.toggle('active',x===btn));$$('.workspace-view').forEach(x=>{const on=x.id===`workspace-${name}`;x.classList.toggle('active',on);x.hidden=!on;});if(name==='discussion')renderDiscussion();if(name==='admin'&&state.user.role==='admin')loadAdmin();}));

/* PDF viewer */
async function loadScript(){try{const {response}=await api('projects/we-before-me/script');const version=response.headers.get('X-Script-Version');$('#script-version-label').textContent=version?`· V${String(version).padStart(3,'0')}`:'';const buffer=await response.arrayBuffer();await openPdf(buffer);}catch(error){$('#pdf-viewer').hidden=true;setScriptMessage('Screenplay unavailable.',error.data?.error||error.message);}}
async function openPdf(buffer){const pdfjs=await getPdfJs();if(state.pdf){try{await state.pdf.destroy();}catch{}}state.pdfBuffer=buffer;state.pdf=await pdfjs.getDocument({data:buffer}).promise;state.page=1;state.scale=1;state.fitScale=1;$('#script-empty').hidden=true;$('#pdf-viewer').hidden=false;await calculateFitScale();state.scale=state.fitScale;await renderPdfPage();}
async function calculateFitScale(){if(!state.pdf)return;const page=await state.pdf.getPage(state.page),base=page.getViewport({scale:1}),stage=$('#pdf-stage');const aw=Math.max(320,stage.clientWidth-56),ah=Math.max(360,stage.clientHeight-56);state.fitScale=Math.min(aw/base.width,ah/base.height,1.6);}
async function renderPdfPage(){if(!state.pdf)return;const pdfjs=await getPdfJs(),page=await state.pdf.getPage(state.page),viewport=page.getViewport({scale:state.scale}),canvas=$('#pdf-canvas'),ctx=canvas.getContext('2d',{alpha:false}),textLayer=$('#pdf-text-layer'),wrap=$('#pdf-page-wrap'),outputScale=Math.min(devicePixelRatio||1,2);canvas.width=Math.floor(viewport.width*outputScale);canvas.height=Math.floor(viewport.height*outputScale);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;wrap.style.width=`${viewport.width}px`;wrap.style.height=`${viewport.height}px`;textLayer.innerHTML='';textLayer.style.width=`${viewport.width}px`;textLayer.style.height=`${viewport.height}px`;const renderTask=page.render({canvasContext:ctx,viewport,transform:outputScale!==1?[outputScale,0,0,outputScale,0,0]:null});const textContent=await page.getTextContent();await renderTask.promise;await pdfjs.renderTextLayer({textContentSource:textContent,container:textLayer,viewport}).promise;updatePdfControls();renderPdfMarkers();}
function updatePdfControls(){if(!state.pdf)return;$('#pdf-page').textContent=state.page;$('#pdf-pages').textContent=state.pdf.numPages;$('#pdf-zoom-label').textContent=`${Math.round(state.scale*100)}%`;$('#pdf-prev').disabled=state.page<=1;$('#pdf-next').disabled=state.page>=state.pdf.numPages;}
$('#pdf-prev').addEventListener('click',async()=>{if(state.pdf&&state.page>1){state.page--;await renderPdfPage();}});$('#pdf-next').addEventListener('click',async()=>{if(state.pdf&&state.page<state.pdf.numPages){state.page++;await renderPdfPage();}});$('#pdf-zoom-out').addEventListener('click',async()=>{if(state.pdf){state.scale=Math.max(.5,state.scale-.1);await renderPdfPage();}});$('#pdf-zoom-in').addEventListener('click',async()=>{if(state.pdf){state.scale=Math.min(2.5,state.scale+.1);await renderPdfPage();}});$('#pdf-fit').addEventListener('click',async()=>{if(state.pdf){await calculateFitScale();state.scale=state.fitScale;await renderPdfPage();}});
let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(!state.pdf)return;await calculateFitScale();if(Math.abs(state.scale-state.fitScale)<.06){state.scale=state.fitScale;await renderPdfPage();}},180);});

/* Comment anchoring */
function pagePointFromEvent(event){const rect=$('#pdf-page-wrap').getBoundingClientRect();return {page:state.page,x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};}
$('#pdf-page-wrap').addEventListener('mouseup',()=>{const selection=window.getSelection();const text=selection?.toString().trim()||'';if(text){const range=selection.getRangeAt(0);const rect=range.getBoundingClientRect();const pageRect=$('#pdf-page-wrap').getBoundingClientRect();state.selectedText=text;state.selectionAnchor={page:state.page,x:Math.max(0,Math.min(1,(rect.left+rect.width/2-pageRect.left)/pageRect.width)),y:Math.max(0,Math.min(1,(rect.top+rect.height/2-pageRect.top)/pageRect.height))};setTimeout(()=>openCommentModal(),20);} });
$('#pdf-page-wrap').addEventListener('click',event=>{if(event.target.closest('.pdf-comment-marker')||window.getSelection()?.toString().trim())return;state.selectedText='';state.selectionAnchor=pagePointFromEvent(event);openCommentModal();});
function openCommentModal(){if(!state.selectionAnchor)return;const ctx=$('#comment-context');ctx.innerHTML=state.selectedText?`<span class="context-label">SELECTED TEXT · PAGE ${state.selectionAnchor.page}</span><blockquote>${escapeHtml(state.selectedText)}</blockquote>`:`<span class="context-label">LOCATION · PAGE ${state.selectionAnchor.page}</span><p>Comment attached to the selected point on page ${state.selectionAnchor.page}.</p>`;$('#comment-body').value='';$('#comment-modal').hidden=false;setTimeout(()=>$('#comment-body').focus(),50);}
async function saveComment(){const body=$('#comment-body').value.trim();if(!body||!state.selectionAnchor)return;const btn=$('#save-comment');btn.disabled=true;try{await api('projects/we-before-me/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({anchor:state.selectionAnchor,selected_text:state.selectedText,body})});$('#comment-modal').hidden=true;state.selectionAnchor=null;state.selectedText='';window.getSelection()?.removeAllRanges();await loadComments();renderDiscussion();renderPdfMarkers();}catch(error){alert(error.data?.error||error.message);}finally{btn.disabled=false;}}
$('#save-comment').addEventListener('click',saveComment);
function renderPdfMarkers(){const layer=$('#pdf-marker-layer');layer.innerHTML='';for(const comment of state.comments){let anchor;try{anchor=JSON.parse(comment.anchor_value||'{}');}catch{continue;}if(Number(anchor.page)!==Number(state.page)||typeof anchor.x!=='number'||typeof anchor.y!=='number')continue;const marker=document.createElement('button');marker.type='button';marker.className=`pdf-comment-marker${Number(comment.resolved)===1?' resolved':''}`;marker.style.left=`${anchor.x*100}%`;marker.style.top=`${anchor.y*100}%`;marker.title=comment.body||'Comment';marker.addEventListener('click',e=>{e.stopPropagation();focusComment(comment.id);});layer.appendChild(marker);}}

/* Discussion */
async function loadComments(){try{const {data}=await api('projects/we-before-me/comments');state.comments=data.comments||[];$('.comment-count').textContent=state.comments.length;$('#workspace-comment-count').textContent=state.comments.length;renderDiscussion();renderPdfMarkers();}catch{state.comments=[];renderDiscussion();}}
function renderDiscussion(){const list=$('#discussion-list'),empty=$('#discussion-empty');if(!state.comments.length){list.innerHTML='';empty.hidden=false;return;}empty.hidden=true;list.innerHTML=state.comments.map(c=>`<article class="comment-card ${Number(c.resolved)===1?'is-resolved':''}" data-comment-id="${c.id}"><div class="comment-meta"><strong>${escapeHtml(c.author_name||c.author_email||'User')}</strong><span>${formatDate(c.created_at)}</span></div>${c.selected_text?`<blockquote>${escapeHtml(c.selected_text)}</blockquote>`:''}<p>${escapeHtml(c.body)}</p><div class="comment-footer"><button class="comment-location" data-focus-comment="${c.id}">PAGE ${getCommentPage(c)}</button>${Number(c.resolved)===1?'<span class="resolved-label">RESOLVED</span>':'<span>OPEN</span>'}${canResolve()?`<button class="resolve-btn" data-resolve-comment="${c.id}">${Number(c.resolved)===1?'Reopen':'Resolve'}</button>`:''}</div></article>`).join('');$$('[data-focus-comment]').forEach(b=>b.addEventListener('click',()=>focusComment(Number(b.dataset.focusComment))));$$('[data-resolve-comment]').forEach(b=>b.addEventListener('click',()=>toggleComment(Number(b.dataset.resolveComment))));}
function canResolve(){return state.user&&(state.user.role==='admin'||state.user.role==='script_editor');}
function getCommentPage(c){try{return JSON.parse(c.anchor_value||'{}').page||'—';}catch{return '—';}}
async function focusComment(id){const c=state.comments.find(x=>Number(x.id)===Number(id));if(!c)return;let a;try{a=JSON.parse(c.anchor_value||'{}');}catch{return;}if(!a.page)return;state.page=Number(a.page);if(state.pdf){await renderPdfPage();const stage=$('#pdf-stage');const marker=$$('.pdf-comment-marker').find(m=>m.title===c.body);if(marker)marker.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});}$$('.workspace-tab').find(x=>x.dataset.workspace==='script')?.click();}
async function toggleComment(id){const c=state.comments.find(x=>Number(x.id)===Number(id));if(!c)return;try{await api(`projects/we-before-me/comments/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resolved:Number(c.resolved)!==1})});await loadComments();}catch(error){alert(error.data?.error||error.message);}}

/* Upload */
$('#open-upload').addEventListener('click',()=>{if(isEditor()){$('#upload-modal').hidden=false;$('#upload-status').textContent='';}});
$('#script-file').addEventListener('change',e=>{$('#file-name').textContent=e.target.files[0]?.name||'Choose screenplay PDF';});
$('#upload-form').addEventListener('submit',async e=>{e.preventDefault();const file=$('#script-file').files[0];if(!file)return;const btn=$('#upload-submit');btn.disabled=true;$('#upload-status').textContent='Uploading...';try{const fd=new FormData();fd.append('file',file);fd.append('notes',$('#upload-notes').value.trim());const {data}=await api('projects/we-before-me/script',{method:'POST',body:fd});$('#upload-status').textContent=`Version ${data.version} uploaded. Reloading screenplay...`;$('#upload-modal').hidden=true;await loadScript();await loadComments();if(state.user.role==='admin')await loadAdmin();}catch(error){$('#upload-status').textContent=error.data?.error||error.message;}finally{btn.disabled=false;}});
function isEditor(){return state.user&&(state.user.role==='admin'||state.user.role==='script_editor');}

/* Admin */
async function loadAdmin(){if(state.user.role!=='admin')return;await Promise.all([loadAdminUsers(),loadAdminVersions(),loadAdminLogs()]);}
async function loadAdminUsers(){const {data}=await api('admin/users');const list=$('#admin-users');list.innerHTML=data.users.map(u=>`<article class="admin-row"><div><strong>${escapeHtml(u.name||u.email)}</strong><small>${escapeHtml(u.email)}</small></div><span class="role-pill">${escapeHtml(u.role.replace('_',' '))}</span><span class="active-pill ${u.active?'on':'off'}">${u.active?'ACTIVE':'DISABLED'}</span><button class="icon-btn edit-user" data-id="${u.id}">Edit</button></article>`).join('');$$('.edit-user').forEach(b=>b.addEventListener('click',()=>editUser(Number(b.dataset.id),data.users)));}
async function loadAdminVersions(){const {data}=await api('admin/versions');$('#admin-versions').innerHTML=data.versions.length?data.versions.map(v=>`<article class="admin-row"><div><strong>V${String(v.version_number).padStart(3,'0')} · ${escapeHtml(v.file_name)}</strong><small>${escapeHtml(v.notes||'No version note')} · ${formatDate(v.created_at)}</small></div><span class="admin-uploader">${escapeHtml(v.uploaded_by_name||v.uploaded_by_email)}</span><button class="icon-btn" data-open-version="${v.id}">Open</button></article>`).join(''):'<div class="admin-empty">No screenplay versions.</div>';$$('[data-open-version]').forEach(b=>b.addEventListener('click',()=>window.open(`/api/admin/versions/${b.dataset.openVersion}/script`,'_blank','noopener')));}
async function loadAdminLogs(){const {data}=await api('admin/logs');$('#admin-logs').innerHTML=data.logs.length?data.logs.map(l=>`<article class="log-row"><span class="log-time">${formatDate(l.created_at)}</span><div><strong>${escapeHtml(l.action.replaceAll('_',' '))}</strong><p>${escapeHtml(l.description)}</p></div></article>`).join(''):'<div class="admin-empty">No update log entries.</div>';}
$('#add-user-btn').addEventListener('click',()=>openUserModal());
function openUserModal(user=null){$('#user-modal-title').textContent=user?'Edit authorised user':'Add authorised user';$('#user-edit-id').value=user?.id||'';$('#user-email-input').value=user?.email||'';$('#user-email-input').disabled=!!user;$('#user-name-input').value=user?.name||'';$('#user-role-input').value=user?.role||'reader';$('#user-active-input').checked=user?!!user.active:true;$('#user-status').textContent='';$('#user-modal').hidden=false;}
function editUser(id,users){const u=users.find(x=>x.id===id);if(u)openUserModal(u);}
$('#user-form').addEventListener('submit',async e=>{e.preventDefault();const id=$('#user-edit-id').value;const payload={name:$('#user-name-input').value.trim(),role:$('#user-role-input').value,active:$('#user-active-input').checked};if(!id)payload.email=$('#user-email-input').value.trim();try{if(id)await api(`admin/users/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});else await api('admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});$('#user-modal').hidden=true;await loadAdmin();}catch(error){$('#user-status').textContent=error.data?.error||error.message;}});

/* Modals */
$$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.closeModal;$('#'+id).hidden=true;}));
$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));

function setScriptMessage(title,message){const empty=$('#script-empty');empty.hidden=false;$('h4',empty).textContent=title;$('p',empty).textContent=message;}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function formatDate(value){if(!value)return '';const d=new Date(value.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?value:d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}

async function boot(){const allowed=await verifyAccess();if(!allowed)return;const start=location.hash.slice(1);show(TABS.includes(start)?start:'home');}
boot();
