/* =====================================================================
   50 SUN — NOAA solar position, Singapore time (UTC+8, no DST),
   light placement, sun path, per-flat direct-sun estimate
   ===================================================================== */

const SGT_OFFSET_MIN = 8 * 60;
/** UTC instant for a Singapore local date ('YYYY-MM-DD') + minutes after midnight */
function sgtDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (minutes - SGT_OFFSET_MIN) * 60000);
}
function todaySGT() {
  const t = new Date(Date.now() + SGT_OFFSET_MIN * 60000);
  return t.toISOString().slice(0, 10);
}
/** NOAA solar position (spreadsheet algorithm). Returns degrees: az (from N, clockwise), el (incl. refraction) */
function sunPosition(date, lat, lon) {
  const rad = DEG, d2r = (x) => x * rad, r2d = (x) => x / rad;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(d2r(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(d2r(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(d2r(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(d2r(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(d2r(omega));
  const decl = r2d(Math.asin(Math.sin(d2r(eps)) * Math.sin(d2r(lambda))));
  const y = Math.tan(d2r(eps / 2)) ** 2;
  const eqTime = 4 * r2d(y * Math.sin(2 * d2r(L0)) - 2 * e * Math.sin(d2r(M)) + 4 * e * y * Math.sin(d2r(M)) * Math.cos(2 * d2r(L0)) - 0.5 * y * y * Math.sin(4 * d2r(L0)) - 1.25 * e * e * Math.sin(2 * d2r(M)));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let tst = (utcMin + eqTime + 4 * lon) % 1440; if (tst < 0) tst += 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cosZ = Math.sin(d2r(lat)) * Math.sin(d2r(decl)) + Math.cos(d2r(lat)) * Math.cos(d2r(decl)) * Math.cos(d2r(ha));
  const zen = r2d(Math.acos(clamp(cosZ, -1, 1)));
  let el = 90 - zen;
  // atmospheric refraction (NOAA)
  let refr = 0;
  if (el > 85) refr = 0;
  else if (el > 5) refr = (58.1 / Math.tan(d2r(el)) - 0.07 / Math.tan(d2r(el)) ** 3 + 0.000086 / Math.tan(d2r(el)) ** 5) / 3600;
  else if (el > -0.575) refr = (1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))) / 3600;
  else refr = (-20.772 / Math.tan(d2r(el))) / 3600;
  el += refr;
  const azDen = Math.cos(d2r(lat)) * Math.sin(d2r(zen));
  let az;
  if (Math.abs(azDen) < 1e-9) az = lat > decl ? 180 : 0;
  else {
    const cosAz = clamp(((Math.sin(d2r(lat)) * Math.cos(d2r(zen))) - Math.sin(d2r(decl))) / azDen, -1, 1);
    az = ha > 0 ? (r2d(Math.acos(cosAz)) + 180) % 360 : (540 - r2d(Math.acos(cosAz))) % 360;
  }
  return { az, el, elGeo: 90 - zen, decl, eqTime };
}
const LATLON = () => SITE.meta.latlon;
const sunAt = (dateStr, minutes) => sunPosition(sgtDate(dateStr, minutes), LATLON()[0], LATLON()[1]);
/** unit vector toward the sun in world space (+X east, +Y up, +Z south) */
function sunDir(az, el, out = new THREE.Vector3()) {
  return out.set(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
}
/** sunrise / sunset / solar noon in SGT minutes (1-minute scan) */
function sunTimes(dateStr) {
  // rise/set: geometric centre at -0.833° (standard refraction + semi-diameter), linearly interpolated
  const H = -0.833;
  let rise = null, set = null, noon = 0, best = -99, prev = sunAt(dateStr, 0).elGeo;
  for (let m = 1; m < 1440; m++) {
    const p = sunAt(dateStr, m), el = p.elGeo;
    if (prev < H && el >= H && rise === null) rise = m - 1 + (H - prev) / (el - prev);
    if (prev >= H && el < H) set = m - 1 + (prev - H) / (prev - el);
    if (p.el > best) { best = p.el; noon = m; }
    prev = el;
  }
  return { rise, set, noon, maxEl: best };
}
const hhmm = (m) => { if (m == null) return '—'; const t = Math.round(m); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

const _sd = new THREE.Vector3();
let lastSun = null;
function updateSun() {
  const s = state.settings.sun; const dateStr = s.date || todaySGT();
  const p = sunAt(dateStr, s.minutes); lastSun = { ...p, dateStr, minutes: s.minutes };
  sunDir(p.az, p.el, _sd);
  const c = ESTATE_CENTRE;
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  sun.position.copy(c).addScaledVector(_sd, 900);
  const day = clamp((p.el + 2) / 10, 0, 1);
  sun.intensity = 2.6 * day; sun.castShadow = state.settings.layers.shadows && p.el > 0;
  hemi.intensity = 0.45 + 0.75 * day;
  sun.color.setHSL(0.1, 0.6 * (1 - clamp(p.el / 40, 0, 1)) + 0.15, 0.94);
  buildSunPath(dateStr);
  state.shadowsDirty = true; requestRender();
  emit('sun', lastSun);
}
function buildSunPath(dateStr) {
  clearGroup(G.sunPath, true);
  G.sunPath.visible = state.settings.layers.sunPath;
  if (!state.settings.layers.sunPath) return;
  const R = 420, c = ESTATE_CENTRE, pts = [];
  for (let m = 0; m < 1440; m += 10) { const p = sunAt(dateStr, m); if (p.el > 0) pts.push(sunDir(p.az, p.el).multiplyScalar(R).add(c)); }
  if (pts.length > 1) G.sunPath.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#F5A623' })));
  if (lastSun && lastSun.el > 0) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 12), new THREE.MeshBasicMaterial({ color: '#FFC83D' }));
    ball.position.copy(sunDir(lastSun.az, lastSun.el).multiplyScalar(R).add(c)); G.sunPath.add(ball);
  }
  // hour ticks
  for (let h = 7; h <= 19; h++) {
    const p = sunAt(dateStr, h * 60); if (p.el <= 0) continue;
    const el = document.createElement('div'); el.className = 'hour'; el.textContent = h;
    const o = new CSS2DObject(el); o.position.copy(sunDir(p.az, p.el).multiplyScalar(R + 18).add(c)); G.sunPath.add(o);
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
  for (let m = 6 * 60; m <= 20 * 60; m += step) {
    const p = sunAt(dateStr, m); if (p.el <= 0.5) continue;
    sunDir(p.az, p.el, d); const dot = d.dot(nw);
    if (dot <= 0.02) { if (trace) trace.push([m, +p.az.toFixed(1), +p.el.toFixed(1), +dot.toFixed(3), 'behind facade']); continue; }
    _ray.set(pw, d); _ray.far = 2000;
    const hit = _ray.intersectObjects(REG.pick, false);
    if (trace) trace.push([m, +p.az.toFixed(1), +p.el.toFixed(1), +dot.toFixed(3), hit.length ? 'blocked by ' + hit[0].object.userData.owner + ' @' + hit[0].distance.toFixed(0) + 'm' : 'SUN']);
    if (hit.length) continue;
    lit += step; if (m < 12 * 60) before12 += step; if (m >= 15 * 60) after15 += step;
  }
  return { hours: lit / 60, before12: before12 / 60, after15: after15 / 60 };
}
