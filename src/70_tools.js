/* =====================================================================
   70 TOOLS — camera presets + transitions, picking, measure, walk
   ===================================================================== */

/* ---------- camera presets (world). 'adm-st' reproduces photo IMG_1981
   (critic's calibrated camera: bearing 170°, pitch −11°, vFOV ≈ 54°). ---- */
function presetList() {
  const c = ESTATE_CENTRE;
  const fromBearing = (pos, bearing, pitch, dist) => {
    const d = new THREE.Vector3(Math.sin(bearing * DEG) * Math.cos(pitch * DEG), Math.sin(pitch * DEG), -Math.cos(bearing * DEG) * Math.cos(pitch * DEG));
    return { pos, target: pos.clone().addScaledVector(d, dist) };
  };
  const ww = SITE.mscp.westWing, mc = toWorld((ww.u0 + ww.u1) / 2, (ww.v0 + ww.v1) / 2);
  return [
    { id: 'adm-st', name: 'Admiralty St', hint: 'Matches photo 1 (north side)', key: '1', fov: 54, ...fromBearing(new THREE.Vector3(88, 110, -443), 170, -11, 380) },
    { id: 'adm-lane', name: 'Admiralty Lane', hint: 'From the south (photo 8)', key: '2', fov: 50, pos: new THREE.Vector3(c.x - 20, 85, c.z + 330), target: new THREE.Vector3(c.x - 10, 25, c.z - 10) },
    { id: 'woodlands', name: 'Woodlands Ave 10', hint: 'From the west, over the canal (photo 10)', key: '3', fov: 50, pos: new THREE.Vector3(-200, 70, -10), target: new THREE.Vector3(40, 30, -80) },
    { id: 'sembawang-dr', name: 'Sembawang Dr', hint: 'From the east (photo 9)', key: '4', fov: 50, pos: new THREE.Vector3(500, 75, -30), target: new THREE.Vector3(300, 32, -95) },
    { id: 'top', name: 'Top', hint: 'Plan view, north up', key: '5', fov: 45, pos: new THREE.Vector3(c.x, 520, c.z + 0.01), target: new THREE.Vector3(c.x, 0, c.z) },
    { id: 'roof436', name: 'Car-park roof', hint: 'Blk 436 roof garden', key: '6', fov: 50, pos: new THREE.Vector3(mc.x + 70, 85, mc.z + 60), target: new THREE.Vector3(mc.x, MSCP_H, mc.z) },
    ...areaPresets(),
    { id: 'iso', name: 'Overview', hint: 'Isometric overview', key: '7', fov: 45, pos: new THREE.Vector3(c.x - 260, 330, c.z + 330), target: new THREE.Vector3(c.x, 20, c.z),
      portrait: (() => { const a = toWorld(-175, -10), t = toWorld(190, -35); return { pos: new THREE.Vector3(a.x, 240, a.z), target: new THREE.Vector3(t.x, 10, t.z), fov: 62 }; })() },
  ];
}
let PRESETS = [];
/** area presets from the georeference (work before the area data is loaded) */
function areaPresets() {
  const P = osmProjector(SITE.georef), [S, W, N, E] = OSM_BBOX;
  const sw = P(S, W), ne = P(N, E), cx = (sw[0] + ne[0]) / 2, cz = (sw[1] + ne[1]) / 2;
  const park = P(1.46140, 103.83678); // Sembawang Park centre (from the OSM polygon's bounds)
  return [
    { id: 'area', name: 'Sembawang area', hint: 'Whole area from OpenStreetMap', key: '8', fov: 50, area: true, pos: new THREE.Vector3(cx - 900, 2600, cz + 3600), target: new THREE.Vector3(cx, 0, cz - 300) },
    { id: 'sembawang-park', name: 'Sembawang Park', hint: 'The park and the coast', key: '9', fov: 50, area: true, pos: new THREE.Vector3(park[0] - 420, 300, park[1] + 520), target: new THREE.Vector3(park[0], 0, park[1]) },
  ];
}
/** landscape screens open on the photo-1 view; portrait phones on the along-the-estate overview */
const defaultPreset = () => (viewAspect() < 1 ? 'iso' : 'adm-st');

let tween = null;
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function flyTo(pos, target, fov = camera.fov, dur = 0.9) {
  if (state.tool === 'walk') exitWalk();
  stopInertia(); // a drag's leftover glide would otherwise carry on after arriving and drift off the chosen view
  tween = { t0: performance.now(), dur: dur * 1000, p0: camera.position.clone(), t0v: controls.target.clone(), f0: camera.fov, p1: pos.clone(), t1: target.clone(), f1: fov };
  requestRender();
}
function stepTween(now) {
  if (!tween) return false;
  const k = clamp((now - tween.t0) / tween.dur, 0, 1), e = ease(k);
  camera.position.lerpVectors(tween.p0, tween.p1, e);
  controls.target.lerpVectors(tween.t0v, tween.t1, e);
  camera.fov = tween.f0 + (tween.f1 - tween.f0) * e; camera.updateProjectionMatrix();
  if (k >= 1) { tween = null; saveView(); }
  return true;
}
/** keep a preset's horizontal coverage on portrait screens: widen the FOV up to 75°, then step back */
function fitPreset(p) {
  const aspect = viewAspect(), ref = 1.6;
  if (aspect >= ref * 0.9) return { pos: p.pos.clone(), target: p.target.clone(), fov: p.fov };
  if (aspect < 1 && p.portrait) return { pos: p.portrait.pos.clone(), target: p.portrait.target.clone(), fov: p.portrait.fov }; // look along the estate's long axis
  const halfH = Math.tan(p.fov / 2 * DEG) * ref * 0.62;      // keep ~60% of the landscape width
  const need = halfH / aspect, maxT = Math.tan(35 * DEG);     // vertical tan needed vs cap
  const fov = Math.max(p.fov, Math.min(70, 2 * Math.atan(need) / DEG)), k = Math.max(1, need / maxT);
  return { pos: p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(k)), target: p.target.clone(), fov };
}
function goPreset(id, instant = false) {
  const p0 = PRESETS.find((x) => x.id === id); if (!p0) return;
  if (p0.area && !state.settings.layers.area) { setAreaOn(true, false); }
  const p = fitPreset(p0);
  if (instant) { camera.position.copy(p.pos); controls.target.copy(p.target); camera.fov = p.fov; camera.updateProjectionMatrix(); controls.update(); requestRender(); return; }
  flyTo(p.pos, p.target, p.fov);
  document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
}
/** frame a local-frame anchor {u,y,v,size} */
function focusAnchor(a, fromDir) {
  if (!a) return;
  const w = toWorld(a.u, a.v), t = new THREE.Vector3(w.x, a.y, w.z);
  const dir = fromDir || camera.position.clone().sub(controls.target).setY(0).normalize();
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  const dist = a.size * 2.2;
  const pos = t.clone().addScaledVector(dir, dist); pos.y = a.y + dist * 0.55;
  flyTo(pos, t, 50);
}
function focusFlat(info, storey) {
  const y = floorY(storey) + 1.4;
  const um = (info.u0 + info.u1) / 2, vm = (info.v0 + info.v1) / 2;
  const off = info.face === 'N' ? [0, -70] : info.face === 'S' ? [0, 70] : [70, 0];
  const t = toWorld(um, vm), p = toWorld(um + off[0], vm + off[1]);
  flyTo(new THREE.Vector3(p.x, y + 12, p.z), new THREE.Vector3(t.x, y, t.z), 50);
}
let viewTimer = 0;
function saveView() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => { state.settings.view = { pos: camera.position.toArray().map((x) => +x.toFixed(2)), target: controls.target.toArray().map((x) => +x.toFixed(2)), fov: camera.fov }; saveSettings(); }, 400);
}
controls.addEventListener('end', saveView);
controls.addEventListener('start', () => document.querySelectorAll('.preset.on').forEach((b) => b.classList.remove('on')));

/* ---------- picking ---------- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setNdc(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function pickAt(ev) {
  if (RENDER && RENDER.on) return; // no selecting while the ray tracer is running
  setNdc(ev); raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(REG.pick, false);
  const ah = areaPick(raycaster);
  if (ah && (!hits.length || ah.dist < hits[0].distance)) return ah;
  if (hits.length) return { kind: 'building', id: hits[0].object.userData.owner, point: hits[0].point };
  const roads = state.settings.layers.roads ? raycaster.intersectObjects(G.roads.children.filter((o) => o.userData.kind === 'road'), false) : [];
  if (roads.length) return { kind: 'road', id: roads[0].object.userData.owner.slice(5) };
  if (state.settings.layers.context) {
    const h2 = raycaster.intersectObjects(G.context.children.filter((o) => o.userData.kind === 'reserved'), false);
    if (h2.length) return { kind: 'reserved', id: h2[0].object.userData.name };
  }
  return null;
}
/** ground/building point under the pointer (for measuring) */
function surfacePoint(ev) {
  setNdc(ev); raycaster.setFromCamera(ndc, camera);
  const targets = [...REG.pick, G.ground.getObjectByName('groundPlane')].filter(Boolean);
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0].point.clone() : null;
}

/* Labels and pins let the pointer through (so a drag that starts on one still moves the map); a tap on one is
   matched here by its on-screen box instead, topmost first. */
function labelAt(x, y) {
  const els = document.querySelectorAll('#labels .lbl, #labels .pin');
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i]; if (el.classList.contains('mine') || el.classList.contains('measure')) continue;
    if (el.closest('[style*="display: none"]') || el.offsetParent === null) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < 0.35) continue;
    const r = el.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt) return;
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y), dt = performance.now() - downAt.t; downAt = null;
  if (moved > 6 || dt > 500 || state.tool === 'walk') return;
  if (state.tool === 'measure') { measureClick(ev); return; }
  const lab = labelAt(ev.clientX, ev.clientY); if (lab) { lab.click(); return; }
  const hit = pickAt(ev);
  if (!hit) { select(null); return; }
  if (hit.kind === 'building') {
    // a tap on a sale block's facade also identifies the stack under the pointer
    const b = blockById(hit.id); let stack = null;
    if (b && b.kind === 'sale') {
      const lp = G.estate.worldToLocal(hit.point.clone());
      let best = null, bd = 3.5;
      for (const info of UNITS.stacks.get(b.id)) {
        const du = Math.max(info.u0 - lp.x, 0, lp.x - info.u1), dv = Math.max(info.v0 - lp.z, 0, lp.z - info.v1), d = Math.hypot(du, dv);
        if (d < bd) { bd = d; best = info; }
      }
      stack = best;
    }
    select({ kind: 'building', id: hit.id, stack, storeyHint: stack ? storeyAtY(hit.point.y) : null });
  } else select(hit);
});
function storeyAtY(y) { const { f2f, vd } = hts(); return y < vd ? 1 : Math.floor((y - vd) / f2f) + 2; }

/* ---------- measure ---------- */
const measure = { pts: [], objs: [] };
function setTool(t) {
  if (state.tool === 'walk' && t !== 'walk') exitWalk();
  state.tool = t;
  document.body.dataset.tool = t;
  document.getElementById('btnMeasure').setAttribute('aria-pressed', t === 'measure');
  document.getElementById('btnWalk').setAttribute('aria-pressed', t === 'walk');
  const hint = document.getElementById('toolHint');
  if (t === 'measure') { hint.hidden = false; hint.querySelector('span').textContent = 'Tap two points to measure. Tap again to start a new measurement.'; }
  else if (t === 'walk') { hint.hidden = false; hint.querySelector('span').textContent = IS_TOUCH ? 'Left pad to move · drag elsewhere to look' : 'Drag to look · W A S D / arrows to move · Shift = faster'; }
  else hint.hidden = true;
  if (t === 'walk') enterWalk();
  requestRender();
}
function clearMeasure() { for (const o of measure.objs) { G.tools.remove(o); o.traverse?.((c) => { if (c.geometry) c.geometry.dispose(); }); } measure.objs.length = 0; measure.pts.length = 0; requestRender(); }
function measureClick(ev) {
  const p = surfacePoint(ev); if (!p) return;
  if (measure.pts.length >= 2) clearMeasure();
  measure.pts.push(p);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: '#FF2D55', depthTest: false }));
  dot.position.copy(p); dot.renderOrder = 10; G.tools.add(dot); measure.objs.push(dot);
  if (measure.pts.length === 2) {
    const [a, b] = measure.pts;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#FF2D55', depthTest: false }));
    line.renderOrder = 10; G.tools.add(line); measure.objs.push(line);
    const el = document.createElement('div'); el.className = 'lbl measure';
    const dh = Math.abs(b.y - a.y), dxz = Math.hypot(b.x - a.x, b.z - a.z);
    el.innerHTML = `<b>${fmt(a.distanceTo(b))} m</b><small>plan ${fmt(dxz)} m · height Δ ${fmt(dh)} m</small>`;
    const o = new CSS2DObject(el); o.position.copy(a).add(b).multiplyScalar(0.5); G.tools.add(o); measure.objs.push(o);
    document.getElementById('measureOut').textContent = `${fmt(a.distanceTo(b))} m (plan ${fmt(dxz)} m, height Δ ${fmt(dh)} m)`;
  }
  requestRender();
}

/* ---------- walk mode (eye level 1.6 m, collision with building footprints + canal) ---------- */
const walk = { yaw: 0, pitch: 0, keys: new Set(), joy: { x: 0, y: 0 }, saved: null, look: null };
function enterWalk() {
  walk.saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  controls.enabled = false;
  // start at the orbit target; if that is inside a building, take the nearest open spot ≥ 6 m from walls, facing the building
  const t0 = controls.target.clone(); let start = null;
  if (!walkBlocked(t0.x, t0.z, 0.4)) start = t0;
  for (let r = 4; r <= 160 && !start; r += 3) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = t0.x + Math.cos(a) * r, z = t0.z + Math.sin(a) * r;
    if (!walkBlocked(x, z, 6)) { start = new THREE.Vector3(x, 0, z); break; }
  }
  start = start || t0; start.y = 1.6; camera.position.copy(start);
  const d = start === t0 ? walk.saved.target.clone().sub(walk.saved.pos) : t0.clone().sub(start);
  walk.yaw = Math.atan2(-d.x, -d.z); walk.pitch = start === t0 ? 0.05 : 0.35;
  document.getElementById('info').classList.remove('open'); if (document.body.classList.contains('mobile')) document.getElementById('left').classList.remove('open');
  camera.fov = 70; camera.near = 0.1; camera.updateProjectionMatrix();
  document.getElementById('joy').hidden = !IS_TOUCH;
  applyWalkCam(); requestRender();
}
function exitWalk() {
  if (!walk.saved) return;
  controls.enabled = true; camera.near = 0.5;
  camera.position.copy(walk.saved.pos); controls.target.copy(walk.saved.target); camera.fov = walk.saved.fov; camera.updateProjectionMatrix();
  walk.saved = null; walk.keys.clear(); walk.joy.x = walk.joy.y = 0;
  document.getElementById('joy').hidden = true;
  if (state.tool === 'walk') { state.tool = 'orbit'; document.body.dataset.tool = 'orbit'; document.getElementById('btnWalk').setAttribute('aria-pressed', 'false'); document.getElementById('toolHint').hidden = true; }
  controls.update(); requestRender();
}
function walkBlocked(x, z, pad = 0.4) {
  const { u, v } = toLocal(x, z);
  for (const b of REG.walk) if (u > b.u0 - pad && u < b.u1 + pad && v > b.v0 - pad && v < b.v1 + pad) return true;
  if (pointInPoly(x, z, canalPolygon().poly)) return true;
  return false;
}
function applyWalkCam() {
  walk.pitch = clamp(walk.pitch, -1.2, 1.2);
  const d = new THREE.Vector3(-Math.sin(walk.yaw) * Math.cos(walk.pitch), Math.sin(walk.pitch), -Math.cos(walk.yaw) * Math.cos(walk.pitch));
  camera.lookAt(camera.position.clone().add(d));
}
function stepWalk(dt) {
  if (state.tool !== 'walk') return false;
  let f = 0, s = 0;
  const k = walk.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) f += 1; if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) s += 1; if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
  f += -walk.joy.y; s += walk.joy.x;
  if (Math.abs(f) + Math.abs(s) < 0.01) return false;
  const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 12 : 4.5) * dt;
  const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), sx = Math.cos(walk.yaw), sz = -Math.sin(walk.yaw);
  const nx = camera.position.x + (fx * f + sx * s) * speed, nz = camera.position.z + (fz * f + sz * s) * speed;
  if (!walkBlocked(nx, camera.position.z)) camera.position.x = nx;   // slide along walls
  if (!walkBlocked(camera.position.x, nz)) camera.position.z = nz;
  applyWalkCam();
  return true;
}
addEventListener('keydown', (e) => { if (state.tool === 'walk' && !e.target.closest('input,select,textarea')) { walk.keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); } });
addEventListener('keyup', (e) => walk.keys.delete(e.code));
addEventListener('blur', () => walk.keys.clear());
// look by dragging the view
renderer.domElement.addEventListener('pointerdown', (e) => { if (state.tool !== 'walk') return; walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (state.tool !== 'walk' || !walk.look || walk.look.id !== e.pointerId) return;
  walk.yaw -= (e.clientX - walk.look.x) * 0.004; walk.pitch -= (e.clientY - walk.look.y) * 0.004;
  walk.look.x = e.clientX; walk.look.y = e.clientY; applyWalkCam(); requestRender();
});
renderer.domElement.addEventListener('pointerup', (e) => { if (walk.look && walk.look.id === e.pointerId) walk.look = null; });
// touch joystick
(function joystick() {
  const pad = document.getElementById('joy'), knob = pad.querySelector('i'); let id = null, c = null;
  pad.addEventListener('pointerdown', (e) => { id = e.pointerId; pad.setPointerCapture(id); const r = pad.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; move(e); e.stopPropagation(); });
  const move = (e) => { if (e.pointerId !== id) return; let dx = (e.clientX - c.x) / c.R, dy = (e.clientY - c.y) / c.R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } walk.joy.x = dx; walk.joy.y = dy; knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; };
  pad.addEventListener('pointermove', move);
  const end = (e) => { if (e.pointerId !== id) return; id = null; walk.joy.x = walk.joy.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
})();
