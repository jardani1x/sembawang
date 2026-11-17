/* =====================================================================
   40 OVERLAYS — flat-type colouring, storey band, my-flat marker,
   stack highlight, selection outline
   ===================================================================== */

const typeColor = (t) => new THREE.Color(`rgb(${(SITE.flatTypes[t] || { rgb: [200, 200, 200] }).rgb.join(',')})`);
const typeMeshes = new Map();

function buildTypeOverlay() {
  clearGroup(L.typeOverlay); typeMeshes.clear();
  const { vd } = hts(); const per = new Map();
  const mbFor = (t) => { if (!per.has(t)) per.set(t, new MultiBuf()); return per.get(t); };
  const IN_V = 0.75, IN_U = 0.05; // cover frame fins (0.6 m proud) without overlapping neighbours
  for (const b of SITE.blocks) {
    const top = roofY(b.storeys);
    if (b.kind === 'sale') {
      for (const info of UNITS.stacks.get(b.id)) {
        const inU = info.face === 'E' ? 0.75 : IN_U, inV = info.face === 'E' ? 0.05 : IN_V;
        addBox(mbFor(info.type), info.u0 - inU, info.u1 + inU, vd, top + 0.2, info.v0 - inV, info.v1 + inV, { ...allSides('x'), T: { mat: 'x' } });
      }
    } else {
      for (const pt of b.points) addBox(mbFor('1R-RENT'), pt.u - pt.lu / 2 - EXT - 0.7, pt.u + pt.lu / 2 + EXT + 0.7, vd, top + 0.2, pt.v - pt.lv / 2 - 0.7, pt.v + pt.lv / 2 + 0.7, { ...allSides('x'), T: { mat: 'x' } });
    }
  }
  for (const [t, mb] of per) {
    const c = typeColor(t);
    const [m] = mb.meshes(() => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, emissive: c, emissiveIntensity: 0.12 }));
    m.userData.type = t; m.castShadow = false; L.typeOverlay.add(m); typeMeshes.set(t, m);
  }
  updateTypeOverlay();
}
/** types present in a block (brochure mix keys) */
const blockTypes = (b) => Object.keys(b.mix);
function typeMatches(t) {
  const f = state.settings.typeFilter;
  if (!f.length) return true;
  return f.includes(t) || (f.includes('RENT') && /RENT/.test(t)) || (f.includes('2RF') && /^2RF/.test(t));
}
function updateTypeOverlay() {
  const s = state.settings;
  L.typeOverlay.visible = s.colourByType;
  for (const [t, m] of typeMeshes) m.visible = typeMatches(t);
  // dim buildings that hold none of the filtered types
  const owners = new Set(SITE.blocks.map((b) => b.id));
  for (const b of SITE.blocks) setOwnerDim(b.id, s.typeFilter.length > 0 && !blockTypes(b).some(typeMatches));
  for (const id of ['436', '437', '438', '439', 'porch', '440', '441']) setOwnerDim(id, s.typeFilter.length > 0);
  void owners;
  state.shadowsDirty = true; requestRender();
}

/* horizontal band at storey n on every residential block that has it */
function buildStoreyBand() {
  clearGroup(L.storeyBand);
  const s = state.settings.storey; if (!s.on) return;
  const { f2f } = hts(), n = s.n, y0 = floorY(n), y1 = y0 + f2f, P = 0.9;
  const mb = new MultiBuf();
  const add = (e) => addBox(mb, e.u0 - P, e.u1 + P, y0, y1, e.v0 - P, e.v1 + P, { ...allSides('band'), T: { mat: 'band' } });
  for (const b of SITE.blocks) {
    if (n > b.storeys) continue;
    if (b.kind === 'sale') {
      for (const t of b.towers) for (const row of t.rows) add(rowExtents(row));
      for (const p of b.link) add({ u0: p.u - p.lu / 2, u1: p.u + p.lu / 2, v0: p.v - p.lv / 2, v1: p.v + p.lv / 2 });
      if (b.tip) add({ u0: b.tip.u - b.tip.lu / 2, u1: b.tip.u + b.tip.lu / 2 + EXT, v0: b.tip.v - b.tip.lv / 2, v1: b.tip.v + b.tip.lv / 2 });
    } else for (const pt of b.points) add({ u0: pt.u - pt.lu / 2 - EXT, u1: pt.u + pt.lu / 2 + EXT, v0: pt.v - pt.lv / 2, v1: pt.v + pt.lv / 2 });
  }
  for (const m of mb.meshes(() => new THREE.MeshBasicMaterial({ color: '#0A84FF', transparent: true, opacity: 0.45, depthWrite: false }), { cast: false, receive: false })) { m.renderOrder = 3; L.storeyBand.add(m); }
  requestRender();
}

/* my-flat marker: bright box on the flat's facade at its storey + label */
function unitFaceBox(info, storey, pad = 0.9) {
  const { f2f } = hts(), y0 = floorY(storey), y1 = y0 + f2f;
  const box = { u0: info.u0, u1: info.u1, v0: info.v0, v1: info.v1, y0, y1 };
  if (info.face === 'N') box.v0 -= pad; else if (info.face === 'S') box.v1 += pad; else box.u1 += pad;
  return box;
}
function buildUnitMark() {
  clearGroup(L.unitMark);
  const mu = state.settings.myUnit; if (!mu) { requestRender(); return; }
  if (!myUnitValid(mu)) { requestRender(); return; }
  const info = UNITS.idx.get(mu.unit);
  const bx = unitFaceBox(info, mu.storey, 1.1);
  const geo = new THREE.BoxGeometry(bx.u1 - bx.u0 + 0.4, bx.y1 - bx.y0, bx.v1 - bx.v0 + 0.4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#D6247E', transparent: true, opacity: 0.92 }));
  mesh.position.set((bx.u0 + bx.u1) / 2, (bx.y0 + bx.y1) / 2, (bx.v0 + bx.v1) / 2); mesh.renderOrder = 4;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#FFFFFF' }));
  edges.position.copy(mesh.position);
  L.unitMark.add(mesh, edges);
  // faint stack line so the flat is findable from afar
  const sg = new THREE.BoxGeometry(bx.u1 - bx.u0, roofY(info.storeys) - hts().vd, bx.v1 - bx.v0);
  const stack = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#D6247E', transparent: true, opacity: 0.16, depthWrite: false }));
  stack.position.set(mesh.position.x, hts().vd + (roofY(info.storeys) - hts().vd) / 2, mesh.position.z); L.unitMark.add(stack);
  const el = document.createElement('div'); el.className = 'lbl mine';
  el.textContent = `Your flat · Blk ${mu.block} #${String(mu.storey).padStart(2, '0')}-${mu.unit}`;
  // anchor the label just outside the flat's facade (not inside the slab)
  const lx = info.face === 'E' ? bx.u1 + 0.6 : mesh.position.x, lz = info.face === 'N' ? bx.v0 - 0.6 : info.face === 'S' ? bx.v1 + 0.6 : mesh.position.z;
  const lo = new CSS2DObject(el); lo.position.set(lx, bx.y1 + 3, lz); L.unitMark.add(lo);
  requestRender();
}

/* selection outline (pick boxes of the selected owner) + optional stack highlight */
function buildSelection() {
  clearGroup(L.selection);
  const sel = state.selection; if (!sel) { requestRender(); return; }
  const lineMat = new THREE.LineBasicMaterial({ color: '#0A84FF' });
  if (sel.kind === 'building') {
    for (const p of REG.pick) {
      if (p.userData.owner !== sel.id) continue;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry), lineMat);
      e.position.copy(p.position); L.selection.add(e);
    }
  }
  if (sel.stack) {
    const info = sel.stack, { vd } = hts(), top = roofY(info.storeys);
    const bx = unitFaceBox(info, 2, 0.8);
    const geo = new THREE.BoxGeometry(bx.u1 - bx.u0 + 0.3, top - vd, bx.v1 - bx.v0 + 0.3);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#0A84FF', transparent: true, opacity: 0.35, depthWrite: false }));
    m.position.set((bx.u0 + bx.u1) / 2, vd + (top - vd) / 2, (bx.v0 + bx.v1) / 2); m.renderOrder = 3;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat); e.position.copy(m.position);
    L.selection.add(m, e);
  }
  requestRender();
}
