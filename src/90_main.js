/* =====================================================================
   90 MAIN — rebuilds, render loop (on demand), init
   ===================================================================== */

function validateSite() {
  const issues = [];
  const tot = SITE.blocks.reduce((a, b) => a + b.total, 0);
  if (tot !== 1360) issues.push(`unit total ${tot} ≠ 1360`);
  for (const b of SITE.blocks) {
    const s = Object.values(b.mix).reduce((a, n) => a + n, 0);
    if (s !== b.total) issues.push(`Blk ${b.id}: mix ${s} ≠ total ${b.total}`);
    if (b.unitsPerFloor * (b.storeys - 1) !== b.total) issues.push(`Blk ${b.id}: ${b.unitsPerFloor}×${b.storeys - 1} ≠ ${b.total}`);
    if (b.kind === 'sale') {
      const st = UNITS.stacks.get(b.id) || [];
      if (st.length !== b.unitsPerFloor) issues.push(`Blk ${b.id}: ${st.length} stacks ≠ ${b.unitsPerFloor}/floor`);
      const per = {}; st.forEach((x) => { per[x.type] = (per[x.type] || 0) + 1; });
      for (const [t, n] of Object.entries(per)) if (n * (b.storeys - 1) !== b.mix[t]) issues.push(`Blk ${b.id} ${t}: ${n} stacks × ${b.storeys - 1} ≠ ${b.mix[t]}`);
    }
  }
  return issues;
}

function rebuildBuildings() {
  UNITS = buildUnitIndex();
  buildAllBuildings(); buildTypeOverlay(); buildStoreyBand(); buildUnitMark();
  if (state.selection && state.selection.stack) state.selection.stack = UNITS.idx.get(state.selection.stack.unit) || null;
  buildSelection(); applyLayers(); storeyReadout(); renderMyFlat();
  if (state.selection) renderInfo();
  state.shadowsDirty = true; requestRender();
  toast(`Heights applied: ${state.settings.heights.floorToFloor} m storeys, ${state.settings.heights.voidDeck} m void deck`);
}
function rebuildEverything() {
  UNITS = buildUnitIndex();
  buildAllBuildings(); buildContext(); buildLinkways(); buildLandscape();
  buildTypeOverlay(); buildStoreyBand(); buildUnitMark();
  state.selection = null; buildSelection(); renderInfo();
  PRESETS = presetList(); renderPresets(); buildSearchIndex(); applyLayers(); updateSun();
  $('#dataCheck').textContent = (validateSite().join('; ') || 'all brochure totals reproduced (1,360 flats)');
}

/* facility pins only when the camera is near enough to read them */
const _pp = new THREE.Vector3();
function updatePinVisibility() {
  const on = state.settings.layers.facilities, far = 200;
  for (const o of G.facilities.children) if (o.isCSS2DObject) o.visible = on && o.getWorldPosition(_pp).distanceTo(camera.position) < far;
  const lab = state.settings.layers.labels; // small (low-rise) labels only when near
  for (const o of REG.labels) o.visible = lab && (!o.element.classList.contains('small') || o.getWorldPosition(_pp).distanceTo(camera.position) < 380);
}
const _occRay = new THREE.Raycaster(), _lp = new THREE.Vector3(), _dir = new THREE.Vector3();
let occlFrame = 0;
function updateOcclusion() {
  if (state.tool === 'walk' || (occlFrame++ % 3)) return; // every 3rd rendered frame is enough
  const objs = [...REG.labels, ...L.unitMark.children.filter((o) => o.isCSS2DObject), ...G.facilities.children.filter((o) => o.isCSS2DObject)];
  for (const o of objs) {
    if (!o.visible) continue;
    o.getWorldPosition(_lp); _dir.copy(_lp).sub(camera.position); const d = _dir.length(); _dir.divideScalar(d);
    _occRay.set(camera.position, _dir); _occRay.far = d - 3;
    const hit = _occRay.intersectObjects(REG.pick, false).length > 0;
    o.element.classList.toggle('occl', hit);
  }
}
function render() {
  updatePinVisibility(); updateOcclusion();
  if (state.shadowsDirty) { renderer.shadowMap.needsUpdate = true; state.shadowsDirty = false; }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  updateCompass();
  state.needsRender = false;
}

/* render only when something changed; adaptive pixel ratio on slow devices */
let last = performance.now(), slow = 0, fast = 0;
function loop(now) {
  const dt = Math.min(state.tool === 'walk' ? 0.25 : 0.1, (now - last) / 1000); last = now;
  let active = stepTween(now);
  if (state.tool === 'walk') { if (stepWalk(dt)) active = true; }
  else if (controls.update()) active = true;
  if (stepSun(dt)) active = true;
  if (!(active || state.needsRender)) return;
  render();
  if (active) {
    if (dt > 0.045) { slow++; fast = 0; } else { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 25 && dprCap > 1) { dprCap = Math.max(1, dprCap - 0.25); slow = 0; resize(); }
  }
}

function init() {
  makeTextures(renderer.capabilities.getMaxAnisotropy());
  makeBaseMaterials();
  buildAllBuildings(); buildContext(); buildLinkways(); buildLandscape();
  buildTypeOverlay(); buildStoreyBand(); buildUnitMark();
  PRESETS = presetList(); renderPresets(); buildSearchIndex();
  bindLayers(); syncControls(); applyMobile(); applyLayers(); updateSun();
  resize();
  const v = state.settings.view;
  if (v) { camera.position.fromArray(v.pos); controls.target.fromArray(v.target); camera.fov = v.fov || 50; camera.updateProjectionMatrix(); controls.update(); }
  else goPreset(defaultPreset(), true);
  renderInfo();
  const issues = validateSite();
  $('#dataCheck').textContent = issues.join('; ') || 'all brochure totals reproduced (1,360 flats)';
  if (issues.length) toast('Data check: ' + issues[0], true);
  renderer.setAnimationLoop(loop);
  document.body.classList.add('ready');
  if (DEBUG) {
    window.__sb = { state, SITE: () => SITE, REG, UNITS: () => UNITS, sunAt, sunPosition, sunTimes, flatSunHours, goPreset, select, setTool, camera, controls, scene, renderer, render, G, L, validateSite, runSearch, floorY, roofY, toWorld, toLocal, info: () => renderer.info, walk, measure };
  }
}
init();
