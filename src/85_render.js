/* ============================================================================================
   Photo-real render: path tracing of the current view (sunlight, sky light, bounced light,
   soft contact shadows). Not live: the image refines sample by sample; moving the camera or
   changing the time restarts it, and changing layers / the area / the selection rebuilds it.
   Libraries load only when used, from jsDelivr (see the importmap):
     three-gpu-pathtracer 0.0.23 + three-mesh-bvh 0.7.8 — both run on three r160 once the two
     Scene fields they read (added in r162) have defaults; see ptShimScene().
   ============================================================================================ */
// `var`, not const: other modules may ask renderInvalidate() during start-up, before this file has run
var RENDER = {
  on: false, busy: false, pt: null, lib: null, scene: null, sky: null, sun: null, owned: [],
  raf: 0, t0: 0, maxSamples: 0, rebuildTimer: 0, sunTimer: 0, token: 0, done: false, error: null,
};
const PT_SKY = { w: 512, h: 256 };

function ptPhone() { return document.body.classList.contains('mobile'); }
function ptSupported() {
  const gl = renderer.getContext();
  return renderer.capabilities.isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
}
function ptShimScene() {
  for (const k of ['backgroundRotation', 'environmentRotation']) {
    if (k in THREE.Scene.prototype) continue;
    Object.defineProperty(THREE.Scene.prototype, k, {
      configurable: true,
      get() { return this['_pt_' + k] || (this['_pt_' + k] = new THREE.Euler()); },
      set(v) { this['_pt_' + k] = v; },
    });
  }
}
async function ptLoad() {
  if (RENDER.lib) return RENDER.lib;
  const lib = await import('three-gpu-pathtracer');
  ptShimScene();
  RENDER.lib = lib;
  return lib;
}

/* ---------- the scene the path tracer sees ---------- */
// groups that are UI, not the world
const PT_SKIP = () => new Set([G.sunPath, G.tools, G.sky].filter(Boolean)); // the tracer has its own sky
function ptVisible(o, stop) {
  for (let c = o; c && c !== stop; c = c.parent) if (!c.visible) return false;
  return true;
}
/** instanced mesh → one ordinary mesh (instance colours become vertex colours) */
function ptExpandInstanced(o) {
  const n = o.count; if (!n) return null;
  const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv, vc = pos.count;
  const P = new Float32Array(n * vc * 3), N = nor ? new Float32Array(n * vc * 3) : null, U = uv ? new Float32Array(n * vc * 2) : null;
  const C = o.instanceColor ? new Float32Array(n * vc * 4) : null; // RGBA: see ptGeometry()
  const m = new THREE.Matrix4(), w = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    o.getMatrixAt(i, m); w.multiplyMatrices(o.matrixWorld, m); nm.getNormalMatrix(w);
    if (C) o.getColorAt(i, col);
    for (let j = 0; j < vc; j++) {
      const k = (i * vc + j);
      v.fromBufferAttribute(pos, j).applyMatrix4(w); P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
      if (N) { v.fromBufferAttribute(nor, j).applyMatrix3(nm).normalize(); N[k * 3] = v.x; N[k * 3 + 1] = v.y; N[k * 3 + 2] = v.z; }
      if (U) { U[k * 2] = uv.getX(j); U[k * 2 + 1] = uv.getY(j); }
      if (C) { C[k * 4] = col.r; C[k * 4 + 1] = col.g; C[k * 4 + 2] = col.b; C[k * 4 + 3] = 1; }
    }
  }
  if (src !== o.geometry) src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g.computeVertexNormals();
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  let mat = o.material;
  if (C) { g.setAttribute('color', new THREE.BufferAttribute(C, 4)); mat = o.material.clone(); mat.vertexColors = true; RENDER.owned.push(mat); }
  RENDER.owned.push(g);
  return new THREE.Mesh(g, mat); // world-space geometry: identity transform
}
/** The path tracer merges every mesh into one buffer and fills meshes without colours with RGBA (4 values per
 *  vertex). An RGB (3-value) colour attribute then gets read out of step: random speckled colours. So give it an
 *  RGBA copy (all other attributes shared; cached per geometry, never uploaded to the GPU). */
const _ptRGBA = new WeakMap();
function ptGeometry(g) {
  const c = g.attributes.color; if (!c || c.itemSize === 4) return g;
  let out = _ptRGBA.get(g); if (out) return out;
  out = new THREE.BufferGeometry();
  for (const k in g.attributes) if (k !== 'color') out.setAttribute(k, g.attributes[k]);
  if (g.index) out.setIndex(g.index);
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  const a = new Float32Array(c.count * 4);
  for (let i = 0; i < c.count; i++) { a[i * 4] = c.getX(i); a[i * 4 + 1] = c.getY(i); a[i * 4 + 2] = c.getZ(i); a[i * 4 + 3] = c.itemSize > 3 ? c.getW(i) : 1; }
  out.setAttribute('color', new THREE.BufferAttribute(a, 4));
  _ptRGBA.set(g, out); return out;
}
function ptBuildScene() {
  for (const r of RENDER.owned) r.dispose();
  RENDER.owned = [];
  const ps = new THREE.Scene(), skip = PT_SKIP();
  let meshes = 0, tris = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || skip.has(o) || !ptVisible(o, scene)) return;
    for (let c = o.parent; c; c = c.parent) if (skip.has(c)) return;
    let m;
    if (o.isInstancedMesh) { m = ptExpandInstanced(o); if (!m) return; }
    else { m = new THREE.Mesh(ptGeometry(o.geometry), o.material); m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); }
    ps.add(m); meshes++;
    const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  // hazy far ground to the horizon, just under the model's own ground (the live view hides this edge with fog)
  const far = new THREE.Mesh(RENDER.farGeo || (RENDER.farGeo = new THREE.CircleGeometry(30000, 64).rotateX(-Math.PI / 2).translate(0, -0.8, 0)),
    RENDER.farMat || (RENDER.farMat = new THREE.MeshStandardMaterial({ color: '#A3AC94', roughness: 1 })));
  far.position.set(camera.position.x, 0, camera.position.z); far.updateMatrix(); far.matrixAutoUpdate = false;
  ps.add(far);
  RENDER.sun = new THREE.DirectionalLight('#ffffff', 1);
  ps.add(RENDER.sun, RENDER.sun.target);
  ps.environment = ps.background = RENDER.sky || (RENDER.sky = new RENDER.lib.ProceduralEquirectTexture(PT_SKY.w, PT_SKY.h));
  ptUpdateSun(ps, false);
  RENDER.scene = ps;
  return { meshes, tris: Math.round(tris) };
}

/* ---------- sun + sky (same sun as the live view: direction, colour, strength) ---------- */
const _ptDir = new THREE.Vector3(), _ptSunDir = new THREE.Vector3();
function ptSkyColor(dir, sunDirV, el, out) {
  const warm = 1 - clamp(el / 25, 0, 1), day = clamp((el + 2) / 10, 0, 1);
  if (dir.y < 0) { // ground beyond the model: ~20% reflectance under sun + sky
    const k = 0.18 * (0.35 + 0.65 * day); return out.setRGB(0.95 * k, 0.92 * k, 0.82 * k);
  }
  // Singapore's humid clear sky: hazy blue overhead, pale horizon. Tuned so diffuse light is ~37% of the total on
  // a horizontal surface at mid-morning (numerically integrated; typical clear-day values there are ~30–50%)
  const h = Math.pow(1 - dir.y, 3); // 0 at the zenith → 1 at the horizon
  const zen = [0.16, 0.28, 0.50], hor = [0.60 + 0.25 * warm, 0.66 + 0.08 * warm, 0.72 - 0.15 * warm];
  const cosA = clamp(dir.dot(sunDirV), -1, 1), a = Math.acos(cosA); // angle to the sun
  const glow = 0.9 * Math.exp(-a / 0.09) + 0.35 * Math.exp(-a / 0.45);
  const gc = [1.0, 0.86 - 0.2 * warm, 0.68 - 0.3 * warm];
  const k = 0.9 * (0.2 + 0.8 * day);
  return out.setRGB(
    k * (zen[0] + (hor[0] - zen[0]) * h + glow * gc[0]),
    k * (zen[1] + (hor[1] - zen[1]) * h + glow * gc[1]),
    k * (zen[2] + (hor[2] - zen[2]) * h + glow * gc[2]));
}
function ptUpdateSun(ps = RENDER.scene, reset = true) {
  if (!ps || !RENDER.sun) return;
  const p = lastSun || sunAt(state.settings.sun.date || todaySGT(), state.settings.sun.minutes);
  sunDir(p.az, p.el, _ptSunDir);
  RENDER.sun.color.copy(sun.color); RENDER.sun.intensity = p.el > 0 ? sun.intensity : 0;
  RENDER.sun.position.copy(_ptSunDir).multiplyScalar(1000); RENDER.sun.target.position.set(0, 0, 0);
  RENDER.sun.updateMatrixWorld(); RENDER.sun.target.updateMatrixWorld();
  const sky = RENDER.sky;
  // NB the path tracer's equirect convention is dir = (sinφ·cosθ, cosφ, sinφ·sinθ), NOT three's setFromSpherical
  // (sinφ·sinθ, cosφ, sinφ·cosθ): using three's mirrors the sky across x = z and puts the sun's glow in the wrong place
  sky.generationCallback = (polar, uv, coord, color) => {
    const sp = Math.sin(polar.phi); _ptDir.set(sp * Math.cos(polar.theta), Math.cos(polar.phi), sp * Math.sin(polar.theta));
    ptSkyColor(_ptDir, _ptSunDir, p.el, color);
  };
  sky.update();
  ps.backgroundIntensity = 1.15; // the visible sky reads a touch brighter than the light it gives (tone mapping)
  if (reset && RENDER.pt) { RENDER.pt.updateLights(); RENDER.pt.updateEnvironment(); RENDER.pt.reset(); ptRestartClock(); }
}

/* ---------- lifecycle ---------- */
function ptStatus(html, kind = '') { const s = $('#renderStatus'); s.innerHTML = html; s.dataset.kind = kind; }
function ptRestartClock() { RENDER.t0 = performance.now(); RENDER.done = false; }
async function renderStart() {
  if (RENDER.on || RENDER.busy) return;
  document.body.classList.add('render-open'); $('#btnRender').setAttribute('aria-pressed', 'true');
  if (!ptSupported()) { ptStatus('This device can’t run the ray tracer (it needs WebGL 2 with float render targets).', 'bad'); return; }
  RENDER.busy = true; RENDER.error = null;
  const tok = ++RENDER.token; // Stop pressed while loading → this start is abandoned
  try {
    if (state.tool !== 'orbit') setTool('orbit');
    ptStatus('Loading the ray tracer…');
    const lib = await ptLoad();
    if (tok !== RENDER.token) return;
    ptStatus('Preparing the scene…');
    await new Promise((r) => setTimeout(r, 30)); // let the status paint before the (blocking) BVH build
    if (tok !== RENDER.token) return;
    if (!RENDER.pt) {
      const pt = RENDER.pt = new lib.WebGLPathTracer(renderer);
      pt.rasterizeSceneCallback = () => { renderer.render(scene, camera); }; // the live view shows until the first samples land
      pt.minSamples = 2; pt.fadeDuration = 400; pt.renderDelay = 0;
    }
    const pt = RENDER.pt, phone = ptPhone();
    pt.bounces = phone ? 3 : 5;
    pt.tiles.set(phone ? 3 : 2, phone ? 3 : 2);
    pt.renderScale = RENDER.scaleOverride || (phone ? 0.6 : 1) / Math.max(1, renderer.getPixelRatio());
    RENDER.maxSamples = phone ? 160 : 400;
    const info = ptBuildScene();
    pt.setScene(RENDER.scene, camera);
    RENDER.info = info;
    labelRenderer.domElement.style.visibility = 'hidden';
    ptView(); // the image starts from the current view
    RENDER.on = true; ptRestartClock();
    ptStatus('Ray tracing… the first image appears after the shaders compile.');
    cancelAnimationFrame(RENDER.raf); RENDER.raf = requestAnimationFrame(ptTick);
  } catch (e) {
    console.warn('render failed', e);
    RENDER.error = String(e && e.message || e);
    ptStatus('Couldn’t start the ray tracer: ' + esc(RENDER.error), 'bad');
    renderStop(true);
  } finally { RENDER.busy = false; }
}
function ptTick() {
  if (!RENDER.on) return;
  try { ptStep(); } catch (e) { // e.g. the GPU context was lost: say so instead of freezing on "Ray tracing…"
    console.warn('render stopped', e); RENDER.error = String(e && e.message || e);
    renderStop(true); ptStatus('The ray tracer stopped: ' + esc(RENDER.error), 'bad'); return;
  }
  RENDER.raf = requestAnimationFrame(ptTick);
}
function ptStep() {
  const pt = RENDER.pt;
  if (ptView()) { pt.updateCamera(); ptRestartClock(); }
  if (pt.samples < RENDER.maxSamples) {
    pt.renderSample();
    const n = Math.floor(pt.samples), sec = Math.round((performance.now() - RENDER.t0) / 1000);
    if (pt.isCompiling) ptStatus('Compiling the ray tracer… (first time only)');
    else ptStatus(`Ray tracing · <b>${n}</b> / ${RENDER.maxSamples} samples · ${sec} s`);
    $('#renderProg').value = n / RENDER.maxSamples;
  } else if (!RENDER.done) {
    RENDER.done = true;
    ptStatus(`Done · ${RENDER.maxSamples} samples · ${Math.round((performance.now() - RENDER.t0) / 1000)} s`, 'ok');
    $('#renderProg').value = 1;
  }
}
function renderStop(keepMessage = false) {
  const was = RENDER.on;
  RENDER.token++; RENDER.on = false; cancelAnimationFrame(RENDER.raf); clearTimeout(RENDER.rebuildTimer); clearTimeout(RENDER.sunTimer); RENDER.sunTimer = 0;
  labelRenderer.domElement.style.visibility = '';
  if (!keepMessage) { document.body.classList.remove('render-open'); $('#btnRender').setAttribute('aria-pressed', 'false'); }
  if (was && RENDER.pt) RENDER.pt.setScene(new THREE.Scene(), camera); // free the merged scene copy
  for (const r of RENDER.owned) r.dispose(); RENDER.owned = []; RENDER.scene = null;
  state.shadowsDirty = true; requestRender();
}
/** something in the world changed (layers, area, selection, my flat): rebuild the traced scene */
function renderInvalidate() {
  if (!RENDER || !RENDER.on) return;
  clearTimeout(RENDER.rebuildTimer);
  RENDER.rebuildTimer = setTimeout(() => {
    if (!RENDER.on) return;
    ptStatus('Updating the scene…');
    setTimeout(() => { if (!RENDER.on) return; RENDER.info = ptBuildScene(); RENDER.pt.setScene(RENDER.scene, camera); ptRestartClock(); }, 30);
  }, 250);
}
function renderSave() {
  if (!RENDER.on || !RENDER.pt) return;
  RENDER.pt.renderSample(); // draw the current result into the canvas, then read it in the same task
  renderer.domElement.toBlob((blob) => {
    if (!blob) { toast('Could not capture the image', true); return; }
    saveFile('sembawang-brook-render.png', blob, () => {
      $('#saveTitle').textContent = 'Rendered image';
      $('#saveNote').textContent = 'Downloads are not available in this view. Long-press or right-click the image to save it.';
      $('#saveBody').innerHTML = `<img alt="Ray-traced render of the 3D view" src="${URL.createObjectURL(blob)}">`;
      $('#saveDlg').showModal();
    });
  }, 'image/png');
}

const ptView = viewWatcher(); // camera moved (or the panel changed the view offset) → restart the image
// sun changes (incl. "Play day") rebuild the sky texture: at most ~8 times a second
on('sun', () => { if (!RENDER.on || RENDER.sunTimer) return; RENDER.sunTimer = setTimeout(() => { RENDER.sunTimer = 0; if (RENDER.on) ptUpdateSun(); }, 120); });
$('#btnRender').addEventListener('click', () => { if (RENDER.on || document.body.classList.contains('render-open')) renderStop(); else renderStart(); });
$('#renderStop').addEventListener('click', () => renderStop());
$('#renderSave').addEventListener('click', renderSave);
