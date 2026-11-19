/* =====================================================================
   50 SUN — NOAA solar position, Singapore time (UTC+8, no DST),
   light placement, sun path, per-flat direct-sun estimate
   ===================================================================== */

/* sgtDate, todaySGT and sunPosition live in 01_suncalc.js (shared with the Singapore map) */
const LATLON = () => SITE.meta.latlon;
const sunAt = (dateStr, minutes) => sunPosition(sgtDate(dateStr, minutes), LATLON()[0], LATLON()[1]);
/** unit vector toward the sun in world space (+X east, +Y up, +Z south) */
function sunDir(az, el, out = new THREE.Vector3()) {
  return out.set(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
}
/** sunrise / sunset / solar noon at the estate (sunTimesAt and hhmm live in 01_suncalc.js) */
const sunTimes = (dateStr) => sunTimesAt(dateStr, LATLON()[0], LATLON()[1]);

const _sd = new THREE.Vector3();
let lastSun = null;
/* Where the sunlight and the sun-path dome are centred, and how big they are.
   The sun is ~150 million km away, so its direction is the same for every building in Sembawang;
   the frame only decides WHICH buildings get shadows and how large the dome is drawn.
   Estate only: tight around the estate (sharpest shadows). Area view: follows what you are looking at,
   sized to the view, moving in half-frame steps so small pans don't re-render the shadow map. */
const SUN_FRAMES = [[400, 330], [700, 600], [1300, 1100], [2400, 2000], [Infinity, 4000]]; // camera distance → half-size (m); 4 km covers the whole ground extent
let sunFrame = { x: NaN, z: NaN, half: 0, area: false };
function sunFrameFor() {
  if (!(state.settings.layers.area && AREA.status === 'ready')) return { x: ESTATE_CENTRE.x, z: ESTATE_CENTRE.z, half: 330, area: false };
  const d = camera.position.distanceTo(controls.target);
  const half = SUN_FRAMES.find((f) => d < f[0])[1], snap = half / 2;
  return { x: Math.round(controls.target.x / snap) * snap, z: Math.round(controls.target.z / snap) * snap, half, area: true };
}
const sunFrameChanged = (f) => f.x !== sunFrame.x || f.z !== sunFrame.z || f.half !== sunFrame.half || f.area !== sunFrame.area;
function updateSun() {
  const s = state.settings.sun; const dateStr = s.date || todaySGT();
  const p = sunAt(dateStr, s.minutes); lastSun = { ...p, dateStr, minutes: s.minutes };
  sunDir(p.az, p.el, _sd);
  const f = sunFrame = sunFrameFor(), c = new THREE.Vector3(f.x, 0, f.z), D = f.half * 1.5 + 600;
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  sun.position.copy(c).addScaledVector(_sd, D);
  Object.assign(sun.shadow.camera, { left: -f.half, right: f.half, top: f.half, bottom: -f.half, near: 10, far: 2 * D });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = Math.max(0.5, 1.2 * 2 * f.half / SHADOW_SIZE); // coarser texels in the wide frames need more bias
  const day = clamp((p.el + 2) / 10, 0, 1);
  sun.intensity = 2.6 * day; sun.castShadow = state.settings.layers.shadows && p.el > 0;
  hemi.intensity = 0.45 + 0.75 * day;
  sun.color.setHSL(0.1, 0.6 * (1 - clamp(p.el / 40, 0, 1)) + 0.15, 0.94);
  buildSunPath(dateStr);
  updateSky();
  state.shadowsDirty = true; requestRender();
  emit('sun', lastSun);
}
function buildSunPath(dateStr) {
  clearGroup(G.sunPath, true);
  G.sunPath.visible = state.settings.layers.sunPath;
  if (!state.settings.layers.sunPath) return;
  // dome over the estate, or (area view) over whatever part of the map is in view — same sun directions either way
  const { c, R, k } = sunDome(), pts = [];
  for (let m = 0; m < 1440; m += 10) { const p = sunAt(dateStr, m); if (p.el > 0) pts.push(sunDir(p.az, p.el).multiplyScalar(R).add(c)); }
  if (pts.length > 1) G.sunPath.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#F5A623', fog: false })));
  if (lastSun && lastSun.el > 0 && !state.settings.layers.sky) { // with Sun & sky on, the 3D sun sits on this arc
    const ball = new THREE.Mesh(new THREE.SphereGeometry(9 * k, 20, 12), new THREE.MeshBasicMaterial({ color: '#FFC83D', fog: false }));
    ball.position.copy(sunDir(lastSun.az, lastSun.el).multiplyScalar(R).add(c)); G.sunPath.add(ball);
  }
  // hour ticks
  for (let h = 7; h <= 19; h++) {
    const p = sunAt(dateStr, h * 60); if (p.el <= 0) continue;
    const el = document.createElement('div'); el.className = 'hour'; el.textContent = h;
    const o = new CSS2DObject(el); o.position.copy(sunDir(p.az, p.el).multiplyScalar(R + 18 * k).add(c)); G.sunPath.add(o);
  }
}

/* ---------- direct-sun estimate on a flat's main facade ---------- */
const _ray = new THREE.Raycaster();
/** returns {hours, before12, after15, samples} — geometric estimate, 5-min steps */
function flatSunHours(info, storey, dateStr, trace = null) {
  G.estate.updateMatrixWorld(true);
  const { f2f } = hts(); const y = floorY(storey) + f2f * 0.55;
  const um = (info.u0 + info.u1) / 2, vm = (info.v0 + info.v1) / 2;
  let pl, nl;
  if (info.face === 'N') { pl = new THREE.Vector3(um, y, info.v0 - 0.9); nl = new THREE.Vector3(0, 0, -1); }
  else if (info.face === 'S') { pl = new THREE.Vector3(um, y, info.v1 + 0.9); nl = new THREE.Vector3(0, 0, 1); }
  else { pl = new THREE.Vector3(info.u1 + 0.9, y, vm); nl = new THREE.Vector3(1, 0, 0); }
  const pw = pl.applyMatrix4(G.estate.matrixWorld), nw = nl.applyAxisAngle(new THREE.Vector3(0, 1, 0), GRID);
  let lit = 0, before12 = 0, after15 = 0; const step = 5, d = new THREE.Vector3();
  const occs = areaOccludersNear(pw.x, pw.z); // surrounding OSM buildings, if the area is loaded
  for (let m = 6 * 60; m <= 20 * 60; m += step) {
    const p = sunAt(dateStr, m); if (p.el <= 0.5) continue;
    sunDir(p.az, p.el, d); const dot = d.dot(nw);
    if (dot <= 0.02) { if (trace) trace.push([m, +p.az.toFixed(1), +p.el.toFixed(1), +dot.toFixed(3), 'behind facade']); continue; }
    _ray.set(pw, d); _ray.far = 2000;
    const hit = _ray.intersectObjects(REG.pick, false);
    if (trace) trace.push([m, +p.az.toFixed(1), +p.el.toFixed(1), +dot.toFixed(3), hit.length ? 'blocked by ' + hit[0].object.userData.owner + ' @' + hit[0].distance.toFixed(0) + 'm' : 'SUN']);
    if (hit.length) continue;
    if (occs.length && areaRayBlocked(pw, d, occs)) { if (trace) trace[trace.length - 1][4] = 'blocked by OSM building'; continue; }
    lit += step; if (m < 12 * 60) before12 += step; if (m >= 15 * 60) after15 += step;
  }
  return { hours: lit / 60, before12: before12 / 60, after15: after15 / 60, withArea: occs.length > 0 };
}
