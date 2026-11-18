/* =====================================================================
   20 SCENE — renderer, camera, controls, lights, layer groups
   ===================================================================== */

const viewportEl = document.getElementById('viewport');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fatal').hidden = false;
  throw e;
}
const MAX_DPR = IS_TOUCH ? 1.5 : 2;
let dprCap = MAX_DPR;
renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
viewportEl.appendChild(renderer.domElement);
renderer.domElement.id = 'gl';
renderer.domElement.setAttribute('aria-label', '3D view of Sembawang Brook');

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.id = 'labels';
viewportEl.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color('#E3E9EE');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 1100, 3200);

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.maxPolarAngle = 88 * DEG; controls.minDistance = 8; controls.maxDistance = 1600;
controls.screenSpacePanning = false; // pan across the ground plane
controls.zoomToCursor = true;
// r160 OrbitControls never settle by themselves: every update re-clamps the target around `cursor` (normalise and
// rescale, ~1e-14 m of rounding, compared exactly), and damping shrinks pan/rotate deltas geometrically without
// reaching zero for ~2 minutes. Either way they report 'change' every frame and the scene redraws while idle.
// Pin the (unused: infinite radius) cursor to the target so the clamp is exact, and decide "the view changed"
// ourselves with tolerances far below anything visible.
const _ocUpdate = controls.update.bind(controls);
controls.update = (...a) => { controls.cursor.copy(controls.target); const r = _ocUpdate(...a); clampPan(); return r; };

/* Navigation. Map style (default): drag moves the map across the ground; right-drag, or Ctrl/⌘/Shift + drag,
   rotates and tilts; the wheel zooms towards the pointer. Touch: one finger moves the map, two fingers pinch
   to zoom and rotate/tilt. "Drag rotates" (⋯ menu) swaps drag back to rotating. */
function applyDragMode(rotate) {
  controls.mouseButtons = rotate
    ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = rotate ? { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1;
}
applyDragMode(false);
/** drop the controls' leftover glide (damping): one undamped update applies and clears it */
function stopInertia() { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
/** keep what you look at on the model: estate ±900 m, or the whole area map (set by the area view) */
const PAN_BOUNDS = { box: null };
function clampPan() {
  const b = PAN_BOUNDS.box; if (!b) return;
  const t = controls.target, x = clamp(t.x, b[0], b[2]), z = clamp(t.z, b[1], b[3]);
  if (x === t.x && z === t.z) return;
  camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z;
}
/** returns a function answering "has the view visibly changed since you last asked?" (pose, fov, projection/offset) */
function viewWatcher() {
  const p = new THREE.Vector3(NaN, NaN, NaN), t = new THREE.Vector3(), q = new THREE.Quaternion(), m = new Float64Array(16);
  return () => {
    let moved = !(camera.position.distanceToSquared(p) <= 1e-10) || controls.target.distanceToSquared(t) > 1e-10 || 1 - Math.abs(camera.quaternion.dot(q)) > 1e-12;
    const e = camera.projectionMatrix.elements;
    for (let i = 0; i < 16 && !moved; i++) if (Math.abs(e[i] - m[i]) > 1e-9) moved = true;
    if (moved) { p.copy(camera.position); t.copy(controls.target); q.copy(camera.quaternion); m.set(e); }
    return moved;
  };
}
const loopView = viewWatcher();

/* lights */
const hemi = new THREE.HemisphereLight('#DCE8F3', '#8C917C', 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#FFF4E2', 2.6);
sun.castShadow = true;
const SHADOW_SIZE = IS_TOUCH ? 2048 : 4096;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
Object.assign(sun.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 10, far: 2200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
scene.add(sun); scene.add(sun.target);

/* layer groups (world frame) and the estate group (local frame) */
const G = {
  ground: new THREE.Group(), context: new THREE.Group(), roads: new THREE.Group(), canal: new THREE.Group(),
  estate: new THREE.Group(), // rotated: buildings in local u/v
  linkways: new THREE.Group(), landscape: new THREE.Group(), facilities: new THREE.Group(),
  overlays: new THREE.Group(), tools: new THREE.Group(), sunPath: new THREE.Group(),
};
for (const k of Object.keys(G)) { G[k].name = k; scene.add(G[k]); }
// sub-groups in the local frame
const L = {
  buildings: new THREE.Group(), roofProps: new THREE.Group(), typeOverlay: new THREE.Group(),
  storeyBand: new THREE.Group(), unitMark: new THREE.Group(), pick: new THREE.Group(), selection: new THREE.Group(),
};
for (const k of Object.keys(L)) { L[k].name = 'L.' + k; G.estate.add(L[k]); }

function applyGroupFrame() { G.estate.rotation.set(0, GRID, 0); G.estate.updateMatrixWorld(true); }
applyGroupFrame();

/* width (px) hidden by the open left panel on desktop; the view is re-centred on the free area */
function panelOffset() {
  const left = document.getElementById('left');
  if (document.body.classList.contains('mobile') || !left.classList.contains('open')) return 0;
  return left.getBoundingClientRect().right + 12;
}
function viewAspect() { const w = viewportEl.clientWidth, h = Math.max(1, viewportEl.clientHeight); return (w - panelOffset()) / h; }
function resize() {
  const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  labelRenderer.setSize(w, h);
  const P = panelOffset();
  if (P > 0 && w - P > 200) { camera.aspect = (w + P) / Math.max(1, h); camera.setViewOffset(w + P, h, 0, 0, w, h); }
  else { camera.aspect = w / Math.max(1, h); camera.clearViewOffset(); }
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(viewportEl);

/* dispose a group's children (geometries; materials are shared/cached) */
function clearGroup(g, disposeMaterials = false) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const o = g.children[i];
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (disposeMaterials && c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => { if (m.map && m.userData.ownMap) m.map.dispose(); m.dispose(); });
      if (c.isCSS2DObject && c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element);
    });
    g.remove(o);
  }
}
