import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* =====================================================================
   00 CORE — data, coordinate frames, geometry helpers, state, persistence
   ===================================================================== */

const SITE_DEFAULT = /*__SITE_JSON__*/null;
/** optional private build-time preset {block, unit, storey}; public builds leave it null */
const PRESET_FLAT = /*__PRESET_FLAT__*/null;
let SITE = structuredClone(SITE_DEFAULT);

const APP_VERSION = '1.0.0';
const STORE_KEY = 'sembawang-brook-3d.settings.v1';
const DEG = Math.PI / 180;
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const DEBUG = /[?&]debug\b/.test(location.search);

/* ---------- estate frame ----------
   World: +X east, +Z south, +Y up (metres). Buildings live in a LOCAL frame
   (u = along block rows, bearing 64.5°; v = across, bearing 154.5°).
   A group with rotation.y = GRID maps local (x=u, z=v) → world.            */
let GRID = 0, GC = 1, GS = 0, EXT = 1.4;
function setFrame() {
  GRID = SITE.meta.gridDeg * DEG; GC = Math.cos(GRID); GS = Math.sin(GRID);
  EXT = SITE.meta.faceExtension_m;
}
setFrame();
const toWorld = (u, v) => ({ x: u * GC + v * GS, z: -u * GS + v * GC });
const toLocal = (x, z) => ({ u: x * GC - z * GS, v: x * GS + z * GC });
/** compass bearing (deg, clockwise from north) of a local face normal */
const FACE_BEARING = (face) => {
  const g = SITE.meta.gridDeg;
  return { N: 360 - g, S: 180 - g, E: 90 - g, W: 270 - g }[face];
};
const bearingName = (b) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((b % 360) + 360) % 360 / 22.5) % 16];

/* ---------- small utils ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = (x, d = 1) => Number(x).toFixed(d);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function distToPolyline(px, pz, line) {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distToSeg(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/* ---------- geometry buffer: quads with explicit normals + UVs ---------- */
class GeoBuf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  get empty() { return this.i.length === 0; }
  /** a,b,c,d = corners [x,y,z] (bottom-left, bottom-right, top-right, top-left seen from outside) */
  quad(a, b, c, d, nrm, u0, v0, u1, v1) {
    const o = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.n.push(nrm[0], nrm[1], nrm[2]);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
class MultiBuf {
  constructor() { this.map = new Map(); }
  get(k) { if (!this.map.has(k)) this.map.set(k, new GeoBuf()); return this.map.get(k); }
  /** → array of meshes, one per material key */
  meshes(matFor, opts = {}) {
    const out = [];
    for (const [k, buf] of this.map) {
      if (buf.empty) continue;
      const m = new THREE.Mesh(buf.toGeometry(), matFor(k));
      m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
      m.userData.matKey = k; out.push(m);
    }
    return out;
  }
}

/* face UV spec → [u0,v0,u1,v1]; w = face width (m), y-range for vertical faces */
function faceUV(spec, w, y0, y1) {
  const { f2f, vd } = hts();
  const mod = 4 * f2f; // facade textures hold 4 storeys
  switch (spec.mode) {
    case 'facade': return [0, (y0 - vd) / mod, spec.bays / 4, (y1 - vd) / mod];
    case 'end': return [0, (y0 - vd) / mod, w / 6, (y1 - vd) / mod];
    case 'full': return [0, (y0 - vd) / mod, 1, (y1 - vd) / mod];
    case 'tile': return [0, y0 / (spec.th || spec.tw), w / spec.tw, y1 / (spec.th || spec.tw)];
    default: return [0, 0, 1, 1];
  }
}
/** Axis-aligned box in the current (local) frame. faces: {N,S,E,W,T,B} → {mat, uv} */
function addBox(mb, x0, x1, y0, y1, z0, z1, faces) {
  const F = faces;
  if (F.N) { const [a, b, c, d] = faceUV(F.N.uv || {}, x1 - x0, y0, y1); mb.get(F.N.mat).quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], a, b, c, d); }
  if (F.S) { const [a, b, c, d] = faceUV(F.S.uv || {}, x1 - x0, y0, y1); mb.get(F.S.mat).quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], a, b, c, d); }
  if (F.E) { const [a, b, c, d] = faceUV(F.E.uv || {}, z1 - z0, y0, y1); mb.get(F.E.mat).quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], a, b, c, d); }
  if (F.W) { const [a, b, c, d] = faceUV(F.W.uv || {}, z1 - z0, y0, y1); mb.get(F.W.mat).quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], a, b, c, d); }
  if (F.T) { const t = F.T.uv && F.T.uv.tw || 10; mb.get(F.T.mat).quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], x0 / t, -z1 / t, x1 / t, -z0 / t); }
  if (F.B) { const t = 10; mb.get(F.B.mat).quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], x0 / t, z0 / t, x1 / t, z1 / t); }
}
const allSides = (mat, uv) => ({ N: { mat, uv }, S: { mat, uv }, E: { mat, uv }, W: { mat, uv } });

/** Vertical walls along a closed polygon [[x,z],...] with outward normals. */
function addWalls(mb, pts, y0, y1, mat, tw = 8, th = 6) {
  const ccw = polyArea(pts) > 0;
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    const n = ccw ? [dz / len, 0, -dx / len] : [-dz / len, 0, dx / len];
    // geometric normal of (p→q, up) is (-dz, dx); swap ends if it disagrees with outward n
    const swap = (-dz * n[0] + dx * n[2]) < 0;
    const A = swap ? q : p, Bq = swap ? p : q;
    mb.get(mat).quad([A[0], y0, A[1]], [Bq[0], y0, Bq[1]], [Bq[0], y1, Bq[1]], [A[0], y1, A[1]], n, run / tw, y0 / th, (run + len) / tw, y1 / th);
    run += len;
  }
}
/** Flat polygon (in XZ) at height y as a mesh. pts [[x,z],...] */
function flatPoly(pts, y, mat) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
/** Ribbon along a polyline (XZ), width w, at height y. */
function ribbonGeometry(line, w, y, closed = false) {
  const pos = [], uv = [], idx = []; let run = 0;
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const p = line[i];
    const prev = line[Math.max(0, i - 1)], next = line[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // miter: average of adjacent segment normals
    let nx = -dz, nz = dx, scale = 1;
    if (i > 0 && i < n - 1) {
      const a = [p[0] - prev[0], p[1] - prev[1]], b = [next[0] - p[0], next[1] - p[1]];
      const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1;
      const na = [-a[1] / la, a[0] / la], nb = [-b[1] / lb, b[0] / lb];
      nx = na[0] + nb[0]; nz = na[1] + nb[1]; const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
      scale = 1 / Math.max(0.35, nx * na[0] + nz * na[1]);
    }
    if (i > 0) run += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    const hw = w / 2 * scale;
    pos.push(p[0] + nx * hw, y, p[1] + nz * hw, p[0] - nx * hw, y, p[1] - nz * hw);
    uv.push(0, run / w, 1, run / w);
    if (i < n - 1) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // ensure normals point up (winding may flip with direction)
  const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) { if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i)); }
  return g;
}

/* ---------- heights (user-editable assumptions) ---------- */
function hts() {
  const h = state.settings.heights;
  return { f2f: h.floorToFloor, vd: h.voidDeck, par: SITE.heights.parapet };
}
/** floor level (m) of storey n; storey 1 = ground/void deck */
function floorY(n) { const { f2f, vd } = hts(); return n <= 1 ? 0 : vd + (n - 2) * f2f; }
function roofY(storeys) { const { f2f, vd } = hts(); return vd + (storeys - 1) * f2f; }

/* ---------- state + persistence ---------- */
const DEFAULT_SETTINGS = () => ({
  v: 1,
  layers: { labels: true, facilities: true, roads: true, landscape: true, linkways: true, context: true, canal: true, shadows: true, sunPath: false, sky: true, area: false, areaEstimated: false },
  heights: { floorToFloor: SITE_DEFAULT.heights.floorToFloor, voidDeck: SITE_DEFAULT.heights.voidDeck },
  colourByType: false,
  dragRotate: false, // false: drag moves the map (default); true: drag rotates the view
  typeFilter: [],
  storey: { on: false, n: PRESET_FLAT ? PRESET_FLAT.storey : 10 },
  myUnit: PRESET_FLAT ? { ...PRESET_FLAT } : null,

  sun: { date: null, minutes: 600 },
  view: null,
});
function loadSettings() {
  const d = DEFAULT_SETTINGS();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!raw || raw.v !== 1) return d;
    return sanitizeSettings(raw, d);
  } catch (e) { return d; }
}
function sanitizeSettings(raw, d = DEFAULT_SETTINGS()) {
  const s = d;
  if (raw.layers) for (const k of Object.keys(s.layers)) if (typeof raw.layers[k] === 'boolean') s.layers[k] = raw.layers[k];
  if (raw.heights) {
    const f = Number(raw.heights.floorToFloor), v = Number(raw.heights.voidDeck);
    if (f >= 2.4 && f <= 3.6) s.heights.floorToFloor = f;
    if (v >= 2.4 && v <= 6) s.heights.voidDeck = v;
  }
  s.colourByType = !!raw.colourByType;
  s.dragRotate = !!raw.dragRotate;
  if (Array.isArray(raw.typeFilter)) s.typeFilter = raw.typeFilter.filter((t) => typeof t === 'string');
  if (raw.storey) { s.storey.on = !!raw.storey.on; const n = parseInt(raw.storey.n, 10); if (n >= 2 && n <= 30) s.storey.n = n; }
  if ('myUnit' in raw) { // null = user cleared it; keep that choice
    const mu = raw.myUnit;
    s.myUnit = (mu && typeof mu.block === 'string' && typeof mu.unit === 'string' && Number.isInteger(mu.storey)) ? { block: mu.block, unit: mu.unit, storey: mu.storey } : null;
  }
  if (raw.sun) {
    if (typeof raw.sun.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.sun.date)) s.sun.date = raw.sun.date;
    const m = Number(raw.sun.minutes); if (m >= 0 && m < 1440) s.sun.minutes = m;
  }
  if (raw.view && Array.isArray(raw.view.pos) && Array.isArray(raw.view.target)) s.view = raw.view;
  return s;
}
let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.settings)); } catch (e) { /* storage unavailable */ } }, 250);
}

const state = {
  settings: null,
  selection: null,           // {kind, id, ...}
  tool: 'orbit',             // orbit | measure | walk
  sunOpen: false,
  sunPlaying: false,
  needsRender: true,
  shadowsDirty: true,
};
state.settings = loadSettings();

/* tiny event bus */
const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));
function requestRender() { state.needsRender = true; }

/* ---------- derived data: unit index (sale blocks) ---------- */
function buildUnitIndex() {
  const idx = new Map();         // unitNo → info
  const stacks = new Map();      // blockId → [info]
  for (const b of SITE.blocks) {
    if (b.kind !== 'sale') continue;
    const list = [];
    const addPad = (p, ext0, ext1, tower, part) => {
      const u0 = p.u - p.lu / 2 - ext0, u1 = p.u + p.lu / 2 + ext1;
      const n = p.units.length;
      p.unitsWE.forEach((no, k) => {
        let a = u0, c = u1;
        if (p.face === 'N' || p.face === 'S') { a = u0 + (u1 - u0) * k / n; c = u0 + (u1 - u0) * (k + 1) / n; }
        const info = {
          block: b.id, unit: no, type: p.type, face: p.face, tower, part,
          u0: a, u1: c, v0: p.v - p.lv / 2, v1: p.v + p.lv / 2,
          bearing: FACE_BEARING(p.face), storeys: b.storeys,
        };
        idx.set(no, info); list.push(info);
      });
    };
    for (const t of b.towers) for (const row of t.rows) {
      const sorted = [...row.pads].sort((a, c) => a.u - c.u);
      sorted.forEach((p, i) => addPad(p, i === 0 ? EXT : 0, i === sorted.length - 1 ? EXT : 0, t.side, 'tower'));
    }
    for (const p of b.link) addPad(p, 0, 0, 'link', 'link');
    if (b.tip) { // tip slab is stretched flush with the east tower's end face
      let eastU1 = -Infinity;
      for (const t of b.towers) if (t.side === 'E') for (const row of t.rows) for (const p of row.pads) eastU1 = Math.max(eastU1, p.u + p.lu / 2 + EXT);
      addPad(b.tip, 0, Math.max(0, eastU1 - (b.tip.u + b.tip.lu / 2)), 'E', 'tip');
    }
    list.sort((a, c) => Number(a.unit) - Number(c.unit));
    stacks.set(b.id, list);
  }
  return { idx, stacks };
}
let UNITS = buildUnitIndex();
const blockById = (id) => SITE.blocks.find((b) => b.id === id);
