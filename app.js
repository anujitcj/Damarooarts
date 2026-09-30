import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

const $ = s => document.querySelector(s);
const W = 16, H = 7, D = 12, FPS = 12, SEGMENT_SEC = 1, MAX_GOD = 5;
let CFG = null;
const history = [], future = [];
let playing = false, raf = 0, lastTime = 0;

const state = {
  stage:'camera',
  sceneName:'SCENE 001',
  room:{width:W,height:H,depth:D},
  camera:{
    position:{x:0,y:1.6,z:5.5},
    rotation:{pitch:0,yaw:180,roll:0},
    fov:42, speed:4,
    anchors:[],
    path:[]
  },
  godEntities:[],
  objects:[],
  selected:{type:null,id:null},
  shot:{fps:FPS,currentFrame:0,keyframes:[],durationFrames:0},
  freeCamera:true
};

const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
$('#viewport3d').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1014);
const camera = new THREE.PerspectiveCamera(42,1,.05,100);
camera.position.set(0,1.6,5.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = false; controls.target.set(0,1.4,0); controls.maxPolarAngle = Math.PI*.49;

const roomGroup = new THREE.Group(), pathGroup = new THREE.Group(), entityGroup = new THREE.Group(), objectGroup = new THREE.Group();
scene.add(roomGroup,pathGroup,entityGroup,objectGroup);
scene.add(new THREE.HemisphereLight(0xffffff,0x59606c,2.0));
const key = new THREE.DirectionalLight(0xffffff,2.2); key.position.set(4,7,5); key.castShadow=true; scene.add(key);

const floorMat = new THREE.MeshStandardMaterial({color:0xe8eaed,roughness:.9});
const wallMat = new THREE.MeshStandardMaterial({color:0xf3f4f6,roughness:1});
const gridMat = new THREE.LineBasicMaterial({color:0xc7ccd3,transparent:true,opacity:.45});
function buildRoom(){
  roomGroup.clear();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W,.12,D),floorMat); floor.position.y=-.06; floor.receiveShadow=true; roomGroup.add(floor);
  const walls=[
    [new THREE.BoxGeometry(W,H,.1),[0,H/2,-D/2]],
    [new THREE.BoxGeometry(W,H,.1),[0,H/2,D/2]],
    [new THREE.BoxGeometry(.1,H,D),[-W/2,H/2,0]],
    [new THREE.BoxGeometry(.1,H,D),[W/2,H/2,0]]
  ];
  for(const [geo,pos] of walls){const m=new THREE.Mesh(geo,wallMat);m.position.set(...pos);m.receiveShadow=true;roomGroup.add(m)}
  const grid = new THREE.GridHelper(Math.max(W,D),16,0xadb3bc,0xd5d8dd); grid.position.y=.01; grid.material.transparent=true;grid.material.opacity=.38;roomGroup.add(grid);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W,H,D)),new THREE.LineBasicMaterial({color:0x707784,transparent:true,opacity:.75}));
  edges.position.y=H/2;roomGroup.add(edges);
}
buildRoom();

function v3(o){return new THREE.Vector3(o.x,o.y,o.z)}
function vecObj(v){return {x:+v.x.toFixed(4),y:+v.y.toFixed(4),z:+v.z.toFixed(4)}}
function deg(v){return THREE.MathUtils.radToDeg(v)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function lerp(a,b,t){return a+(b-a)*t}
function wrapDeg(v){return ((v+540)%360)-180}
function deep(o){return JSON.parse(JSON.stringify(o))}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function snapshot(){return deep({...state,selected:{type:null,id:null}})}
function pushHistory(){history.push(snapshot());if(history.length>80)history.shift();future.length=0}
function restore(s){Object.assign(state,deep(s));renderUI();syncScene();setStage(state.stage)}
function undo(){if(!history.length)return;future.push(snapshot());restore(history.pop());toast('Undo')}
function redo(){if(!future.length)return;history.push(snapshot());restore(future.pop());toast('Redo')}

function cameraDirection(c=state.camera){
  const e=new THREE.Euler(THREE.MathUtils.degToRad(c.rotation.pitch),THREE.MathUtils.degToRad(c.rotation.yaw),THREE.MathUtils.degToRad(c.rotation.roll),'YXZ');
  return new THREE.Vector3(0,0,-1).applyEuler(e).normalize();
}
function cameraFromState(c=state.camera){
  camera.position.copy(v3(c.position));
  camera.rotation.set(THREE.MathUtils.degToRad(c.rotation.pitch),THREE.MathUtils.degToRad(c.rotation.yaw),THREE.MathUtils.degToRad(c.rotation.roll),'YXZ');
  camera.fov=c.fov;camera.updateProjectionMatrix();
}
function stateFromCamera(){
  const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');
  state.camera.position=vecObj(camera.position);
  state.camera.rotation={pitch:+deg(e.x).toFixed(2),yaw:+wrapDeg(deg(e.y)).toFixed(2),roll:+deg(e.z).toFixed(2)};
  state.camera.fov=camera.fov;
}
function withinRoom(p){
  const m=.35;return p.x>-W/2+m&&p.x<W/2-m&&p.y>m&&p.y<H-m&&p.z>-D/2+m&&p.z<D/2-m;
}
function clampCamera(){
  camera.position.x=clamp(camera.position.x,-W/2+.35,W/2-.35);
  camera.position.y=clamp(camera.position.y,.35,H-.35);
  camera.position.z=clamp(camera.position.z,-D/2+.35,D/2-.35);
}
function anchorCamera(){
  stateFromCamera();
  return {position:deep(state.camera.position),rotation:deep(state.camera.rotation),fov:state.camera.fov,time:state.camera.anchors.length};
}
function releaseGod(){
  if(state.godEntities.length>=MAX_GOD){toast('Maximum 5 God Entities');return}
  pushHistory();stateFromCamera();
  const id='god-'+Date.now();
  state.godEntities.push({id,label:`God ${String(state.godEntities.length+1).padStart(2,'0')}`,position:deep(state.camera.position),rotation:deep(state.camera.rotation),fov:state.camera.fov,objectId:null});
  state.selected={type:'god',id};syncScene();renderUI();toast('God Entity released. Position locked.');
}
function addAnchor(){
  stateFromCamera();
  const a=anchorCamera();
  const arr=state.camera.anchors;
  if(arr.length){
    const p=arr[arr.length-1].position,q=a.position;
    const d=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z);
    const min=.5,max=5;
    if(d<min||d>max){toast(`Anchor distance must be ${min}–${max} units`);return}
  }
  pushHistory();
  a.label=`A${String(arr.length+1).padStart(2,'0')}`;
  arr.push(a);
  rebuildPath();syncScene();renderUI();toast(`${a.label} added · 1.000s segment`);
}
function rebuildPath(){
  state.camera.path=[];
  const a=state.camera.anchors;
  for(let i=0;i<a.length-1;i++)state.camera.path.push({from:a[i].label,to:a[i+1].label,duration:1});
  state.shot.durationFrames=Math.max(0,(a.length-1)*FPS);
  state.shot.currentFrame=Math.min(state.shot.currentFrame,state.shot.durationFrames);
}
function removeAnchor(id){
  const i=state.camera.anchors.findIndex(a=>a.label===id);if(i<0)return;
  pushHistory();state.camera.anchors.splice(i,1);rebuildPath();syncScene();renderUI();
}

function makeLabel(text,color=0xf5b301){
  const c=document.createElement('canvas');c.width=256;c.height=64;const x=c.getContext('2d');
  x.fillStyle='rgba(10,12,16,.8)';x.roundRect(2,8,252,48,8);x.fill();x.fillStyle='#fff';x.font='bold 20px monospace';x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,32);
  const tex=new THREE.CanvasTexture(c);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sp.scale.set(1.9,.47,1);return sp;
}
function makeGodMesh(g){
  const group=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0xc9cdd3,roughness:.8});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.3,.8,5,10),mat);body.position.y=.75;group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.27,16,12),mat);head.position.y=1.45;group.add(head);
  const dir=new THREE.ArrowHelper(cameraDirection(g),new THREE.Vector3(0,1.3,0),1.0,0xf5b301,.2,.12);group.add(dir);
  const label=makeLabel(g.label);label.position.y=2.0;group.add(label);
  group.position.copy(v3(g.position));group.userData.id=g.id;group.userData.kind='god';return group;
}
function colorFor(type){return CFG?.objects?.find(x=>x.id===type)?.color||'#94a3b8'}
function buildObjectMesh(o){
  const group=new THREE.Group();
  const color=new THREE.Color(colorFor(o.type));
  const mat=new THREE.MeshStandardMaterial({color,roughness:.7});
  let geo;
  if(o.type==='man'||o.type==='woman'){geo=new THREE.CapsuleGeometry(.3,.95,5,10);const body=new THREE.Mesh(geo,mat);body.position.y=.85;group.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.27,16,12),new THREE.MeshStandardMaterial({color:0xe8c39e}));head.position.y=1.65;group.add(head)}
  else if(o.type==='table'){const top=new THREE.Mesh(new THREE.BoxGeometry(1.6,.12,.9),mat);top.position.y=.85;group.add(top);for(const x of [-.65,.65])for(const z of [-.3,.3]){const l=new THREE.Mesh(new THREE.BoxGeometry(.1,.8,.1),mat);l.position.set(x,.4,z);group.add(l)}}
  else if(o.type==='chair'){const seat=new THREE.Mesh(new THREE.BoxGeometry(.7,.12,.7),mat);seat.position.y=.55;group.add(seat);const back=new THREE.Mesh(new THREE.BoxGeometry(.7,.9,.1),mat);back.position.set(0,1,.28);group.add(back)}
  else {geo=new THREE.BoxGeometry(o.type==='car'?2:1,o.type==='door'?2:1,o.type==='bed'?2:1);const mesh=new THREE.Mesh(geo,mat);mesh.position.y=(o.type==='door'?1:.5);group.add(mesh)}
  const label=makeLabel(o.label||o.type.toUpperCase());label.position.y=2.2;group.add(label);
  group.position.copy(v3(o.position));group.rotation.y=THREE.MathUtils.degToRad(o.rotation||0);group.userData={id:o.id,kind:'object'};return group;
}
function syncScene(){
  roomGroup.visible=true;entityGroup.clear();objectGroup.clear();pathGroup.clear();
  for(const g of state.godEntities){const m=makeGodMesh(g);if(state.selected.id===g.id&&state.selected.type==='god')m.traverse(x=>{if(x.material?.color)x.material.color.set(0xffc928)});entityGroup.add(m)}
  for(const o of state.objects){const m=buildObjectMesh(o);if(state.selected.id===o.id&&state.selected.type==='object')m.traverse(x=>{if(x.material?.color)x.material.color.offsetHSL(0,.15,.1)});objectGroup.add(m)}
  const pts=state.camera.anchors.map(a=>v3(a.position));
  if(pts.length){
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xf5b301}));
    pathGroup.add(line);
    pts.forEach((p,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),new THREE.MeshBasicMaterial({color:0xf5b301}));s.position.copy(p);pathGroup.add(s);const l=makeLabel(state.camera.anchors[i].label);l.position.copy(p).add(new THREE.Vector3(0,.35,0));l.scale.set(.9,.22,1);pathGroup.add(l)})
  }
  $('#scene-count').textContent=state.godEntities.length+state.objects.length;
}
function setStage(stage){
  state.stage=stage;
  document.querySelectorAll('.step-tab').forEach(b=>b.classList.toggle('active',b.dataset.stage===stage));
  document.querySelectorAll('.mode-panel').forEach(p=>p.hidden=true);
  $(`#${stage}-panel`).hidden=false;
  $('#mode-title').textContent=stage==='camera'?'CAMERA PATH':stage==='object'?'OBJECT':'SHOT';
  if(stage==='camera'){state.freeCamera=true;controls.enabled=true;cameraFromState()}
  if(stage==='object'){renderUI();cameraFromState()}
  if(stage==='shot'){state.freeCamera=false;controls.enabled=false;applyShotFrame(state.shot.currentFrame)}
  renderUI();
}
function panelButton(label,action,active=false){return `<button class="param ${active?'active':''}" data-action="${action}">${label}</button>`}
function cameraPanel(){
  const a=state.camera.anchors;
  return `<div class="section-title">Camera Path <span>${a.length} anchors</span></div>
    <div class="group"><div class="label">Flight controls</div><div class="hint"><span class="kbd">W A S D</span> fly · <span class="kbd">Q E</span> vertical · mouse look · <span class="kbd">Shift</span> fast</div></div>
    <div class="group"><div class="label">Movement speed</div><input id="speed" type="range" min="1" max="10" step=".5" value="${state.camera.speed}"><div class="hint">${state.camera.speed.toFixed(1)} units/s</div></div>
    <div class="group"><button class="action" data-action="release-god">Release God Entity (${a.length?state.godEntities.length:state.godEntities.length}/5)</button><div class="hint">Captures the current camera position, rotation and look direction. World position becomes locked.</div></div>
    <div class="group"><button class="action" data-action="add-anchor">Add Camera Anchor</button><div class="hint">Every segment is exactly 1.000 second. Next anchor must be 0.5–5.0 units from the previous.</div></div>
    <div class="group"><button class="action secondary" data-action="play-path">▶ Play Camera Path</button></div>
    <div class="group"><div class="label">Camera state</div><div class="readout">
      <div>X ${state.camera.position.x.toFixed(2)}</div><div>Y ${state.camera.position.y.toFixed(2)}</div><div>Z ${state.camera.position.z.toFixed(2)}</div><div>FOV ${state.camera.fov.toFixed(0)}°</div></div></div>
    <div class="divider"></div><div class="section-title">Anchors</div>
    ${a.length?a.map((x,i)=>`<div class="entity ${state.selected.id===x.label?'active':''}"><div class="name">${x.label}</div><div class="meta">${x.position.x.toFixed(2)}, ${x.position.y.toFixed(2)}, ${x.position.z.toFixed(2)} · 1.000s${i?'':' · START'}</div><button class="param" data-action="delete-anchor" data-id="${x.label}">Delete</button></div>`).join(''):'<div class="hint">No anchors yet. Fly to a position and add the first anchor.</div>'}`;
}
function objectPanel(){
  const selected=state.objects.find(o=>o.id===state.selected.id);
  const god=state.godEntities.find(g=>g.id===state.selected.id);
  return `<div class="section-title">Objects <span>${state.objects.length}</span></div>
    <div class="group"><button class="action" data-action="add-object">+ Assign Object</button><div class="hint">Locked objects inherit their God Entity world position. Additional free objects are allowed.</div></div>
    <div class="group"><button class="action secondary" data-action="toggle-camera">${state.freeCamera?'Free Camera':'Camera Path'}</button></div>
    ${selected?objectEditor(selected):god?godEditor(god):'<div class="hint">Select a God Entity or object from the scene/list.</div>'}`;
}
function objectEditor(o){
  return `<div class="group"><div class="label">${o.label}</div><div class="small-grid"><div class="mini">POSITION<br>LOCKED</div><div class="mini">GOD<br>${o.godId?'YES':'NO'}</div></div></div>
  <div class="group"><div class="label">Rotation</div><input id="obj-rot" class="field" type="number" step="1" value="${o.rotation||0}"></div>
  <div class="group"><div class="label">Scale</div><input id="obj-scale" type="range" min=".55" max="1.2" step=".05" value="${o.scale||.85}"></div>
  ${o.character?`<div class="group"><div class="label">Pose</div><div class="btn-row">${['standing','sitting','sleeping','crouching'].map(x=>panelButton(x,x===o.pose?'pose-'+x:'',x===o.pose)).join('')}</div></div>`:''}
  <div class="group"><button class="action danger" data-action="delete-object">Delete Object</button></div>`;
}
function godEditor(g){return `<div class="group"><div class="label">God Entity</div><input id="god-label" class="field" value="${g.label}"></div><div class="small-grid"><div class="mini">X ${g.position.x.toFixed(2)}</div><div class="mini">Y ${g.position.y.toFixed(2)}</div><div class="mini">Z ${g.position.z.toFixed(2)}</div><div class="mini">LOCKED</div></div><div class="hint">The world position is authoritative and cannot be edited here.</div>`}
function shotPanel(){
  const total=state.shot.durationFrames;
  return `<div class="section-title">Shot <span>12 FPS</span></div>
    <div class="group"><div class="label">Timeline</div><div class="hint">${total} frames · ${(total/FPS).toFixed(2)} seconds</div></div>
    <div class="group"><button class="action" data-action="keyframe">Set Object Keyframe</button><div class="hint">Select an object, choose a frame, then capture its editable attributes. Position remains locked.</div></div>
    <div class="group"><button class="action secondary" data-action="play-shot">▶ Play Shot</button></div>
    <div class="group"><div class="label">Current frame</div><div class="readout"><div>FRAME ${state.shot.currentFrame}</div><div>TIME ${(state.shot.currentFrame/FPS).toFixed(3)}s</div></div></div>
    <div class="divider"></div><div class="section-title">Export</div>
    <div class="group"><button class="action secondary" data-action="png-seq">Export PNG Sequence</button></div>
    <div class="group"><button class="action secondary" data-action="contact-sheet">Export Contact Sheet</button></div>
    <div class="group"><button class="action secondary" data-action="mp4">Export MP4 · 12 FPS</button><div class="hint">Uses MediaRecorder when supported by the browser.</div></div>
    <div class="group"><button class="action secondary" data-action="json-export">Export Scene JSON</button></div>`;
}
function renderUI(){
  $('#scene-name').textContent=state.sceneName;
  $('#camera-panel').innerHTML=cameraPanel();
  $('#object-panel').innerHTML=objectPanel();
  $('#shot-panel').innerHTML=shotPanel();
  $('#frame-readout').textContent=`FRAME ${state.shot.currentFrame} / ${state.shot.durationFrames} · ${FPS} FPS`;
  $('#timeline').max=state.shot.durationFrames;$('#timeline').value=state.shot.currentFrame;
  $('#camera-readout').textContent=`X ${state.camera.position.x.toFixed(2)} · Y ${state.camera.position.y.toFixed(2)} · Z ${state.camera.position.z.toFixed(2)} · P ${state.camera.rotation.pitch.toFixed(0)}° · Y ${state.camera.rotation.yaw.toFixed(0)}° · R ${state.camera.rotation.roll.toFixed(0)}°`;
  const list=[...state.godEntities.map(g=>({id:g.id,name:g.label,meta:'GOD ENTITY · POSITION LOCKED',type:'god'})),...state.objects.map(o=>({id:o.id,name:o.label,meta:o.godId?'OBJECT · LOCKED POSITION':'FREE OBJECT',type:'object'}))];
  $('#entity-list').innerHTML=list.length?list.map(x=>`<div class="entity ${state.selected.id===x.id?'active':''} ${x.type==='god'?'locked':''}" data-entity="${x.id}" data-type="${x.type}"><div class="name">${x.name}</div><div class="meta">${x.meta}</div></div>`).join(''):'<div class="hint" style="padding:12px">No God Entities or objects yet.</div>';
}
function selectEntity(type,id){state.selected={type,id};renderUI();syncScene()}

function addObject(){
  const free=state.godEntities.filter(g=>!g.objectId);
  if(!free.length && state.godEntities.length>=MAX_GOD){
    // free object allowed after all God slots are used
  }
  const type=CFG?.objects?.find(x=>x.category==='character')?.id || 'man';
  const god=free[0];
  pushHistory();
  const id='obj-'+Date.now();
  const pos=god?deep(god.position):{x:0,y:0,z:0};
  const o={id,type,label:(CFG.objects.find(x=>x.id===type)?.label||type),position:pos,rotation:0,scale:.85,godId:god?.id||null,character:CFG.objects.find(x=>x.id===type)?.category==='character',pose:'standing',arms:'both-down',expression:'neutral'};
  state.objects.push(o);if(god)god.objectId=id;state.selected={type:'object',id};syncScene();renderUI();toast(god?`${o.label} assigned to ${god.label}`:'Free object added');
}
function deleteObject(){const i=state.objects.findIndex(o=>o.id===state.selected.id);if(i<0)return;pushHistory();const o=state.objects[i];const g=state.godEntities.find(x=>x.id===o.godId);if(g)g.objectId=null;state.objects.splice(i,1);state.selected={type:null,id:null};syncScene();renderUI()}
function applyShotFrame(frame){
  if(state.camera.anchors.length<2){cameraFromState();return}
  const total=state.shot.durationFrames;if(!total){cameraFromState();return}
  const t=clamp(frame/total,0,1)*(state.camera.anchors.length-1);
  const i=Math.min(Math.floor(t),state.camera.anchors.length-2),u=t-i;
  const a=state.camera.anchors[i],b=state.camera.anchors[i+1];
  const p={x:lerp(a.position.x,b.position.x,u),y:lerp(a.position.y,b.position.y,u),z:lerp(a.position.z,b.position.z,u)};
  const r={pitch:lerp(a.rotation.pitch,b.rotation.pitch,u),yaw:a.rotation.yaw+wrapDeg(b.rotation.yaw-a.rotation.yaw)*u,roll:lerp(a.rotation.roll,b.rotation.roll,u)};
  cameraFromState({position:p,rotation:r,fov:lerp(a.fov,b.fov,u)});
  applyObjectKeyframes(frame);
  renderUI();
}
function applyObjectKeyframes(frame){
  for(const o of state.objects){
    const keys=state.shot.keyframes.filter(k=>k.objectId===o.id).sort((a,b)=>a.frame-b.frame);
    if(!keys.length)continue;
    let before=keys[0],after=keys[keys.length-1];
    for(const k of keys){if(k.frame<=frame)before=k;if(k.frame>=frame){after=k;break}}
    const t=after.frame===before.frame?0:(frame-before.frame)/(after.frame-before.frame);
    o.rotation=lerp(before.rotation,after.rotation,t);o.scale=lerp(before.scale,after.scale,t);
  }
  syncScene();
}
function setFrame(f){state.shot.currentFrame=clamp(Math.round(f),0,state.shot.durationFrames);if(state.stage==='shot')applyShotFrame(state.shot.currentFrame);else renderUI()}
function animatePlayback(kind){
  if(playing)return;playing=true;lastTime=performance.now();
  const step=()=>{if(!playing)return;const now=performance.now();if(now-lastTime>=1000/FPS){lastTime=now;setFrame(state.shot.currentFrame+1);if(state.shot.currentFrame>=state.shot.durationFrames){playing=false;return}}raf=requestAnimationFrame(step)};raf=requestAnimationFrame(step);
}
function stopPlayback(){playing=false;cancelAnimationFrame(raf)}
function playPath(){if(state.camera.anchors.length<2){toast('Add at least two anchors');return}state.shot.currentFrame=0;setStage('shot');animatePlayback('path')}
function keyframe(){
  const o=state.objects.find(x=>x.id===state.selected.id);if(!o){toast('Select an object first');return}
  pushHistory();const i=state.shot.keyframes.findIndex(k=>k.objectId===o.id&&k.frame===state.shot.currentFrame);
  const k={objectId:o.id,frame:state.shot.currentFrame,rotation:o.rotation||0,scale:o.scale||.85,pose:o.pose,visible:o.visible!==false};
  if(i>=0)state.shot.keyframes[i]=k;else state.shot.keyframes.push(k);renderUI();toast(`Keyframe set at frame ${state.shot.currentFrame}`);
}
function renderFrameData(frame){
  applyShotFrame(frame);
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL('image/png');
}
async function pngSequence(){
  if(!state.shot.durationFrames){toast('Build at least two camera anchors first');return}
  const zipParts=[];
  for(let f=0;f<=state.shot.durationFrames;f++){const url=renderFrameData(f);zipParts.push({f,url})}
  // Browser-only ZIP without a dependency is not sensible. Export a contact-ready frame manifest plus individual downloads.
  for(const x of zipParts){const a=document.createElement('a');a.href=x.url;a.download=`frame_${String(x.f+1).padStart(4,'0')}.png`;a.click();await new Promise(r=>setTimeout(r,35))}
  toast(`${zipParts.length} PNG frames exported individually`);
}
function contactSheet(){
  if(!state.shot.durationFrames){toast('No shot frames to export');return}
  const thumbs=[];for(let f=0;f<=state.shot.durationFrames;f++){const url=renderFrameData(f);thumbs.push(url)}
  const cols=4,cw=320,ch=180,pad=18,head=48,rows=Math.ceil(thumbs.length/cols);
  const c=document.createElement('canvas');c.width=cols*cw+(cols+1)*pad;c.height=head+rows*ch+(rows+1)*pad;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='bold 15px monospace';x.fillText(state.sceneName+' · 12 FPS',pad,30);
  let done=0;thumbs.forEach((u,i)=>{const im=new Image();im.onload=()=>{const px=pad+(i%cols)*(cw+pad),py=head+pad+Math.floor(i/cols)*(ch+pad);x.drawImage(im,px,py,cw,ch);x.fillStyle='#111';x.font='10px monospace';x.fillText(String(i+1).padStart(4,'0'),px,py+ch+12);done++;if(done===thumbs.length){const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='storyboard-contact-sheet.png';a.click()}};im.src=u});
}
async function exportMp4(){
  if(!window.MediaRecorder){toast('MediaRecorder is not supported in this browser');return}
  const canvas=renderer.domElement, stream=canvas.captureStream(FPS), chunks=[];
  const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
  rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>{const b=new Blob(chunks,{type:'video/webm'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${state.sceneName.replace(/\s+/g,'-')}-12fps.webm`;a.click();toast('Video exported as WebM. Browser-native MP4 encoding is not guaranteed.')};
  rec.start();for(let f=0;f<=state.shot.durationFrames;f++){setFrame(f);renderer.render(scene,camera);await new Promise(r=>setTimeout(r,1000/FPS))}
  rec.stop();
}
function saveJSON(){const blob=new Blob([JSON.stringify({...state,selected:{type:null,id:null}},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${state.sceneName.replace(/\s+/g,'-')}.json`;a.click()}
function loadJSON(file){const r=new FileReader();r.onload=()=>{try{const s=JSON.parse(r.result);pushHistory();Object.assign(state,s);syncScene();setStage(state.stage);toast('Scene loaded')}catch(e){toast('Invalid scene JSON')}};r.readAsText(file)}
function newScene(){if(!confirm('Reset the entire scene?'))return;pushHistory();state.camera.anchors=[];state.camera.path=[];state.godEntities=[];state.objects=[];state.shot={fps:FPS,currentFrame:0,keyframes:[],durationFrames:0};state.selected={type:null,id:null};state.sceneName='SCENE 001';syncScene();setStage('camera');toast('New scene')}
function saveLocal(){localStorage.setItem('damaroo-storyboard-scene',JSON.stringify({...state,selected:{type:null,id:null}}));toast('Scene saved locally')}
function loadLocal(){const s=localStorage.getItem('damaroo-storyboard-scene');if(!s){toast('No local scene saved');return}pushHistory();Object.assign(state,JSON.parse(s));syncScene();setStage(state.stage);toast('Local scene loaded')}

document.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click',()=>{$('#landing').classList.add('hidden');setStage(b.dataset.stage)}));
$('#undo').onclick=undo;$('#redo').onclick=redo;$('#new-scene').onclick=newScene;$('#save-scene').onclick=saveLocal;$('#load-scene').onclick=()=>$('#load-input').click();$('#load-input').onchange=e=>e.target.files[0]&&loadJSON(e.target.files[0]);
$('#scene-name').addEventListener('input',e=>state.sceneName=e.target.textContent.trim()||'SCENE 001');
$('#timeline').oninput=e=>setFrame(+e.target.value);
$('#play').onclick=()=>animatePlayback('shot');$('#pause').onclick=stopPlayback;$('#restart').onclick=()=>setFrame(0);$('#prev-frame').onclick=()=>setFrame(state.shot.currentFrame-1);$('#next-frame').onclick=()=>setFrame(state.shot.currentFrame+1);
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,[contenteditable]'))return;
  if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='z'){e.shiftKey?redo():undo();e.preventDefault()}return}
  if(state.stage!=='camera'||!controls.enabled)return;
  const speed=state.camera.speed*(e.shiftKey?3:1)*.05, dir=cameraDirection();const right=new THREE.Vector3().crossVectors(dir,new THREE.Vector3(0,1,0)).normalize();
  const move=new THREE.Vector3();
  if(e.key.toLowerCase()==='w')move.add(dir);if(e.key.toLowerCase()==='s')move.sub(dir);if(e.key.toLowerCase()==='a')move.sub(right);if(e.key.toLowerCase()==='d')move.add(right);if(e.key.toLowerCase()==='q')move.y-=1;if(e.key.toLowerCase()==='e')move.y+=1;
  if(move.lengthSq()){move.normalize().multiplyScalar(speed);camera.position.add(move);clampCamera();stateFromCamera();renderUI()}
});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
  if(a==='release-god')releaseGod();else if(a==='add-anchor')addAnchor();else if(a==='delete-anchor')removeAnchor(b.dataset.id);else if(a==='add-object')addObject();else if(a==='delete-object')deleteObject();else if(a==='toggle-camera'){state.freeCamera=!state.freeCamera;controls.enabled=state.freeCamera;if(!state.freeCamera)applyShotFrame(state.shot.currentFrame);renderUI()}else if(a==='play-path')playPath();else if(a==='keyframe')keyframe();else if(a==='play-shot'){setStage('shot');animatePlayback('shot')}else if(a==='png-seq')pngSequence();else if(a==='contact-sheet')contactSheet();else if(a==='mp4')exportMp4();else if(a==='json-export')saveJSON();
});
document.addEventListener('input',e=>{
  if(e.target.id==='speed'){state.camera.speed=+e.target.value;renderUI()}
  if(e.target.id==='obj-rot'){const o=state.objects.find(x=>x.id===state.selected.id);if(o){o.rotation=+e.target.value;syncScene()}}
  if(e.target.id==='obj-scale'){const o=state.objects.find(x=>x.id===state.selected.id);if(o){o.scale=+e.target.value;syncScene()}}
  if(e.target.id==='god-label'){const g=state.godEntities.find(x=>x.id===state.selected.id);if(g){g.label=e.target.value;syncScene()}}
});
$('#entity-list').addEventListener('click',e=>{const x=e.target.closest('[data-entity]');if(x)selectEntity(x.dataset.type,x.dataset.entity)});

renderer.domElement.addEventListener('click',e=>{
  if(state.stage==='camera')return;
  const rect=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);
  const hits=ray.intersectObjects([...entityGroup.children,...objectGroup.children],true);
  if(!hits.length)return;let o=hits[0].object;while(o.parent&&o.userData.kind==null)o=o.parent;if(o.userData.id){selectEntity(o.userData.kind,o.userData.id)}
});

function resize(){const r=$('#viewport3d').getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
window.addEventListener('resize',resize);
function loop(){controls.update();if(state.stage==='camera'){clampCamera();stateFromCamera();$('#camera-readout').textContent=`X ${state.camera.position.x.toFixed(2)} · Y ${state.camera.position.y.toFixed(2)} · Z ${state.camera.position.z.toFixed(2)} · P ${state.camera.rotation.pitch.toFixed(0)}° · Y ${state.camera.rotation.yaw.toFixed(0)}° · R ${state.camera.rotation.roll.toFixed(0)}°`}renderer.render(scene,camera);requestAnimationFrame(loop)}
async function init(){
  try{CFG=await fetch('./config.json',{cache:'no-store'}).then(r=>r.json())}catch(e){toast('config.json could not be loaded');return}
  resize();cameraFromState();renderUI();syncScene();setStage('camera');loop();
}
init();
