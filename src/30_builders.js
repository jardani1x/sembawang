/* =====================================================================
   30 BUILDERS — buildings (local frame) and site context (world frame)
   ===================================================================== */

const REG = {
  pick: [],          // invisible boxes for picking + sun-ray occlusion
  walk: [],          // local AABBs {u0,u1,v0,v1} blocking walk mode / tree placement
  tanks: [],         // local [u, y, v, r]
  labels: [],        // CSS2DObjects (toggle with "labels" layer)
  anchors: new Map(),// owner → local {u, y, v, size} for camera focus
};
const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });
let MSCP_H = 24;

function addPick(owner, kind, x0, x1, y0, y1, z0, z1, walkInset = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), PICK_MAT);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.userData = { owner, kind };
  m.visible = false;
  L.pick.add(m); REG.pick.push(m);
  if (walkInset >= 0) REG.walk.push({ u0: x0 + walkInset, u1: x1 - walkInset, v0: z0 + walkInset, v1: z1 - walkInset, owner });
}
function addLabel(owner, text, u, y, v, cls = '') {
  const el = document.createElement('button');
  el.className = 'lbl ' + cls; el.textContent = text; el.type = 'button';
  el.dataset.owner = owner;
  el.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'building', id: owner }, { fly: false }); });
  const o = new CSS2DObject(el); o.position.set(u, y, v); o.userData.owner = owner;
  L.buildings.add(o); REG.labels.push(o);
  return o;
}
function pushMeshes(mb, owner, group = L.buildings) {
  for (const m of mb.meshes((k) => matFor(owner, k))) { m.userData.owner = owner; group.add(m); }
}
function rowExtents(row) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, bays = 0;
  for (const p of row.pads) {
    u0 = Math.min(u0, p.u - p.lu / 2); u1 = Math.max(u1, p.u + p.lu / 2);
    v0 = Math.min(v0, p.v - p.lv / 2); v1 = Math.max(v1, p.v + p.lv / 2); bays += p.bays;
  }
  return { u0: u0 - EXT, u1: u1 + EXT, v0, v1, bays };
}

/* one residential slab: facade body, void deck, columns, frame fins, parapet, 4-storey bands */
function slab(mb, e, fac, frame, storeys, opts = {}) {
  const { vd, par, f2f } = hts(); const top = roofY(storeys);
  const facN = { mat: fac, uv: { mode: 'facade', bays: e.bays } };
  const endF = opts.endFacade ? { mat: fac, uv: { mode: 'facade', bays: e.endBays } } : { mat: 'end', uv: { mode: 'end' } };
  addBox(mb, e.u0, e.u1, vd, top, e.v0, e.v1, { N: facN, S: facN, E: opts.tipE ? { mat: fac, uv: { mode: 'facade', bays: opts.tipE } } : endF, W: endF, T: { mat: 'roof' }, B: { mat: 'soffit' } });
  // void deck enclosure (recessed 1.5 m) + white columns on both long faces
  const ins = 1.5;
  addBox(mb, e.u0 + ins, e.u1 - ins, 0, vd, e.v0 + ins, e.v1 - ins, allSides('voidDeck', { mode: 'tile', tw: 4 }));
  const len = e.u1 - e.u0, nCol = Math.max(2, Math.round(len / 6)) + 1;
  for (let k = 0; k < nCol; k++) {
    const u = e.u0 + 0.5 + k * (len - 1) / (nCol - 1);
    for (const z of [e.v0 + 0.45, e.v1 - 0.45]) addBox(mb, u - 0.3, u + 0.3, 0, vd, z - 0.3, z + 0.3, allSides('column'));
  }
  if (opts.noFrame) { addParapet(mb, e, top, par, frame, 0.3); return; }
  // picture-frame fins at both ends of each long face (0.6 m proud)
  const P = 0.6, W = 0.8, T = { mat: frame };
  for (const [z0, z1] of [[e.v0 - P, e.v0], [e.v1, e.v1 + P]]) {
    addBox(mb, e.u0, e.u0 + W, vd, top + par, z0, z1, { ...allSides(frame), T });
    addBox(mb, e.u1 - W, e.u1, vd, top + par, z0, z1, { ...allSides(frame), T });
  }
  addParapet(mb, e, top, par, frame, P);
  // 4-storey bands (projecting 0.35 m) on both long faces
  for (let s = 4; s < storeys - 1; s += 4) {
    const y = vd + s * f2f;
    addBox(mb, e.u0 + W, e.u1 - W, y - 0.14, y + 0.16, e.v0 - 0.35, e.v0, { N: { mat: frame }, T, B: { mat: frame } });
    addBox(mb, e.u0 + W, e.u1 - W, y - 0.14, y + 0.16, e.v1, e.v1 + 0.35, { S: { mat: frame }, T, B: { mat: frame } });
  }
}
function addParapet(mb, e, top, par, frame, P) {
  const t = 0.3, T = { mat: frame }, S = allSides(frame);
  addBox(mb, e.u0, e.u1, top, top + par, e.v0 - P, e.v0 + t, { ...S, T });
  addBox(mb, e.u0, e.u1, top, top + par, e.v1 - t, e.v1 + P, { ...S, T });
  addBox(mb, e.u0, e.u0 + t, top, top + par, e.v0 + t, e.v1 - t, { ...S, T });
  addBox(mb, e.u1 - t, e.u1, top, top + par, e.v0 + t, e.v1 - t, { ...S, T });
}
function placeTanks(e, n, top) {
  if (n <= 0) return;
  const len = e.u1 - e.u0 - 8;
  for (let k = 0; k < n; k++) REG.tanks.push([e.u0 + 4 + (k + 0.5) * len / n, top, (e.v0 + e.v1) / 2, 2.0]);
}

function buildResidential(b) {
  const owner = b.id, mb = new MultiBuf(), { vd, par } = hts(), top = roofY(b.storeys);
  let eastU1 = -Infinity;
  for (const t of b.towers) {
    const fac = t.scheme === 'A' ? 'facA' : 'facB', frame = t.scheme === 'A' ? 'frameDark' : 'frameWhite';
    const exts = t.rows.map(rowExtents);
    exts.forEach((e) => { slab(mb, e, fac, frame, b.storeys); addPick(owner, 'block', e.u0, e.u1, 0, top + par, e.v0, e.v1, 1.5); });
    if (t.side === 'E') eastU1 = Math.max(...exts.map((e) => e.u1));
    const [n, s] = exts;
    if (n && s && s.v0 - n.v1 > 0.6) {
      const bu0 = Math.max(n.u0, s.u0) + 2.5, bu1 = Math.min(n.u1, s.u1) - 2.5;
      if (bu1 - bu0 > 3) {
        addBox(mb, bu0, bu1, vd, top, n.v1, s.v0, { E: { mat: 'band', uv: { mode: 'end' } }, W: { mat: 'band', uv: { mode: 'end' } }, T: { mat: 'roofDark' }, B: { mat: 'soffit' } });
        addBox(mb, bu0 + 1.5, bu1 - 1.5, 0, vd, n.v1, s.v0, { E: { mat: 'voidDeck' }, W: { mat: 'voidDeck' } });
        addPick(owner, 'block', bu0, bu1, 0, top, n.v1, s.v0, 1.5);
      }
    }
    const nN = Math.ceil(t.tanks * 0.6);
    placeTanks(exts[0], nN, top + 0.01); if (exts[1]) placeTanks(exts[1], t.tanks - nN, top + 0.01);
  }
  for (const p of b.link) {
    const e = { u0: p.u - p.lu / 2, u1: p.u + p.lu / 2, v0: p.v - p.lv / 2, v1: p.v + p.lv / 2, bays: p.bays };
    slab(mb, e, 'facA', 'frameDark', b.storeys, { noFrame: true });
    addPick(owner, 'block', e.u0, e.u1, 0, top + par, e.v0, e.v1, 1.5);
  }
  if (b.tip) {
    const p = b.tip;
    const e = { u0: p.u - p.lu / 2, u1: Math.max(p.u + p.lu / 2, eastU1), v0: p.v - p.lv / 2, v1: p.v + p.lv / 2, bays: 2 };
    slab(mb, e, 'facA', 'frameDark', b.storeys, { noFrame: true, tipE: p.bays });
    addPick(owner, 'block', e.u0, e.u1, 0, top + par, e.v0, e.v1, 1.5);
  }
  const c = b.core;
  const cu0 = c.u - c.lu / 2, cu1 = c.u + c.lu / 2, cv0 = c.v - c.lv / 2, cv1 = c.v + c.lv / 2;
  addBox(mb, cu0, cu1, 0, top + 4.5, cv0, cv1, { ...allSides('core', { mode: 'full' }), T: { mat: 'roofDark' } });
  addPick(owner, 'block', cu0, cu1, 0, top + 4.5, cv0, cv1, 0);
  pushMeshes(mb, owner);
  REG.anchors.set(owner, { u: c.u, y: top / 2, v: c.v, size: 90 });
  addLabel(owner, 'Blk ' + b.id, c.u, top + 12, c.v, 'blk');
}

function buildPointTowers(b) {
  const owner = b.id, mb = new MultiBuf(), { par } = hts(), top = roofY(b.storeys);
  for (const pt of b.points) {
    const fac = pt.scheme === 'A' ? 'facA' : 'facB', frame = pt.scheme === 'A' ? 'frameDark' : 'frameWhite';
    const e = { u0: pt.u - pt.lu / 2 - EXT, u1: pt.u + pt.lu / 2 + EXT, v0: pt.v - pt.lv / 2, v1: pt.v + pt.lv / 2, bays: 4, endBays: Math.max(4, Math.round(pt.lv / 3.6)) };
    slab(mb, e, fac, frame, b.storeys, { endFacade: true });
    addPick(owner, 'block', e.u0, e.u1, 0, top + par, e.v0, e.v1, 1.5);
    const half = { ...e, v0: e.v0 + 2, v1: e.v1 - 2 };
    placeTanks(half, pt.tanks, top + 0.01);
  }
  const c = b.core;
  const cu0 = c.u - c.lu / 2, cu1 = c.u + c.lu / 2, cv0 = c.v - c.lv / 2, cv1 = c.v + c.lv / 2;
  addBox(mb, cu0, cu1, 0, top + 4.5, cv0, cv1, { ...allSides('core', { mode: 'full' }), T: { mat: 'roofDark' } });
  addPick(owner, 'block', cu0, cu1, 0, top + 4.5, cv0, cv1, 0);
  pushMeshes(mb, owner);
  REG.anchors.set(owner, { u: c.u, y: top / 2, v: c.v, size: 70 });
  addLabel(owner, 'Blk ' + b.id + ' · rental', c.u, top + 12, c.v, 'blk');
}

/* ---------- Blk 436 multi-storey car park + roof garden ---------- */
function mscpOutline() {
  const m = SITE.mscp, ww = m.westWing, sw = m.southWing, r = (ww.u1 - ww.u0) / 2, uc = (ww.u0 + ww.u1) / 2;
  const pts = [[ww.u0, ww.v1], [sw.u1, sw.v1], [sw.u1, sw.v0], [ww.u1, sw.v0], [ww.u1, ww.v0 + r]];
  for (let k = 1; k < 18; k++) { const a = k / 18 * Math.PI; pts.push([uc + r * Math.cos(a), ww.v0 + r - r * Math.sin(a)]); }
  pts.push([ww.u0, ww.v0 + r]);
  return pts;
}
function buildMSCP() {
  const m = SITE.mscp, owner = '436', H = m.height; MSCP_H = H;
  const ww = m.westWing, sw = m.southWing, R = m.ramp, r = (ww.u1 - ww.u0) / 2;
  const mb = new MultiBuf(), pts = mscpOutline();
  addWalls(mb, pts, 0, H, 'mscp', 16, 6);
  // cores (charcoal stair/lift towers, +3.5 m above roof) [representative positions from IMG_1985/1989]
  const cores = [[ww.u0 + 4.5, ww.v0 + r + 1], [ww.u1 - 3, sw.v1 - 3.5], [R.u - R.r - 5, sw.v1 - 3.5]];
  for (const [cu, cv] of cores) addBox(mb, cu - 3.5, cu + 3.5, 0, H + 3.5, cv - 3.5, cv + 3.5, { ...allSides('mscpCore'), T: { mat: 'mscpCore' } });
  pushMeshes(mb, owner);
  // roof deck (planted base)
  const deck = flatPoly(pts, H, new THREE.MeshStandardMaterial({ color: '#7D8B4C', roughness: 0.95 }));
  deck.userData.owner = owner; deck.castShadow = true; L.buildings.add(deck);
  // ramp drum
  const drumG = new THREE.CylinderGeometry(R.r, R.r, H + 1.5, 48, 1, true);
  const drum = new THREE.Mesh(drumG, matFor(owner, 'drum')); drum.position.set(R.u, (H + 1.5) / 2, R.v);
  drum.castShadow = drum.receiveShadow = true; drum.userData.owner = owner; L.buildings.add(drum);
  const ringG = new THREE.RingGeometry(3.8, R.r, 48); ringG.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringG, new THREE.MeshStandardMaterial({ color: '#6E8542', roughness: 0.95 }));
  ring.position.set(R.u, H + 1.52, R.v); ring.receiveShadow = true; L.buildings.add(ring);
  const ocG = new THREE.CircleGeometry(3.8, 32); ocG.rotateX(-Math.PI / 2);
  const oc = new THREE.Mesh(ocG, new THREE.MeshBasicMaterial({ color: '#1E1E1E' })); oc.position.set(R.u, H + 1.5, R.v); L.buildings.add(oc);
  // picking / occlusion
  addPick(owner, 'mscp', ww.u0, ww.u1, 0, H, ww.v0, ww.v1, 0.5);
  addPick(owner, 'mscp', ww.u1, sw.u1, 0, H, sw.v0, sw.v1, 0.5);
  addPick(owner, 'mscp', R.u - R.r, R.u + R.r, 0, H + 1.5, R.v - R.r, R.v + R.r, 0.5);
  buildRoofGarden(H);
  REG.anchors.set(owner, { u: (ww.u0 + sw.u1) / 2, y: H, v: (ww.v0 + sw.v1) / 2, size: 110 });
  addLabel(owner, 'Blk 436 · car park', (ww.u0 + ww.u1) / 2, H + 10, ww.v0 + 25, 'blk');
}

function buildRoofGarden(H) {
  const m = SITE.mscp, ww = m.westWing, sw = m.southWing, r = (ww.u1 - ww.u0) / 2;
  const y = H + 0.04, g = L.roofProps, mb = new MultiBuf();
  const RG = { gravel: '#D4CBB4', airwell: '#202020', rib: '#E6E4DF', lawn: '#93AC45', soil: '#6B5236', leaf: '#5E8A3A', shelter: '#5B5B58' };
  const plane = (u0, u1, v0, v1, yy, k) => mb.get(k).quad([u0, yy, v1], [u1, yy, v1], [u1, yy, v0], [u0, yy, v0], [0, 1, 0], 0, 0, 1, 1);
  const box = (u, yy, v, su, sy, sv, k) => addBox(mb, u - su / 2, u + su / 2, yy, yy + sy, v - sv / 2, v + sv / 2, { ...allSides(k), T: { mat: k } });
  const L0 = ww.v0 + r, len = ww.v1 - L0;
  plane(ww.u0 + 1.2, ww.u0 + 3.2, L0, ww.v1 - 2, y + 0.01, 'gravel');            // west perimeter path
  const mp = []; for (let k = 0; k <= 20; k++) { const t = k / 20; mp.push([ww.u1 - 6 + Math.sin(t * Math.PI * 3) * 3, L0 + 2 + t * (len - 6)]); }
  const mpm = new THREE.Mesh(ribbonGeometry(mp, 2, y + 0.02), new THREE.MeshStandardMaterial({ color: RG.gravel, roughness: 0.95 })); mpm.receiveShadow = true; g.add(mpm);
  const au = (ww.u0 + ww.u1) / 2 + 2, av0 = L0 + 4, av1 = av0 + 0.45 * len;       // air-well slot (~45% of the wing)
  plane(au - 2, au + 2, av0, av1, y + 0.02, 'airwell');
  for (let v = av0 + 2; v < av1; v += 4) box(au, y, v, 4.2, 0.3, 0.3, 'rib');
  box(au - 2.3, y, (av0 + av1) / 2, 0.4, 1.0, av1 - av0, 'rib'); box(au + 2.3, y, (av0 + av1) / 2, 0.4, 1.0, av1 - av0, 'rib');
  plane(ww.u0 + 4, ww.u0 + 16, L0 + len * 0.45, L0 + len * 0.45 + 18, y + 0.02, 'lawn');
  for (let i = 0; i < 5; i++) for (let j = 0; j < 9; j++) {                          // community garden plots 5 x 9
    const u = ww.u0 + 5 + i * 2.3, v = ww.v1 - 26 + j * 2.3;
    box(u, y, v, 1.7, 0.45, 1.7, 'soil'); box(u, y + 0.45, v, 1.4, 0.12, 1.4, 'leaf');
  }
  const shelter = (u, v) => { box(u, y + 2.5, v, 4.5, 0.25, 4.5, 'shelter'); for (const [a, c] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) box(u + a, y, v + c, 0.15, 2.5, 0.15, 'shelter'); };
  shelter(ww.u1 - 6, L0 + 6); shelter(ww.u1 - 6, L0 + len * 0.55); shelter(ww.u0 + 9, ww.v1 - 32); shelter((sw.u0 + sw.u1) / 2 - 10, (sw.v0 + sw.v1) / 2);
  for (const mesh of mb.meshes((k) => k === 'airwell' ? new THREE.MeshBasicMaterial({ color: RG.airwell }) : new THREE.MeshStandardMaterial({ color: RG[k], roughness: 0.95 }))) g.add(mesh);
  for (const f of SITE.facilities.filter((f) => f.onRoof)) {                       // roof facilities from the site plan
    const { u, v } = toLocal(f.x, f.z);
    if (/playground/i.test(f.name)) playgroundProp(g, u, y, v);
    else if (/fitness/i.test(f.name)) fitnessProp(g, u, y, v);
  }
}
function playgroundProp(g, u, y, v) {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: PAL.playground, roughness: 0.9 }));
  disc.position.set(u, y + 0.03, v); disc.receiveShadow = true; g.add(disc);
  const mat = new THREE.MeshStandardMaterial({ color: '#2E3A4A' });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 2), mat); tower.position.set(u - 1, y + 1.3, v); tower.castShadow = true; g.add(tower);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.15, 0.8), new THREE.MeshStandardMaterial({ color: '#E8C547' }));
  slide.position.set(u + 1.6, y + 1.3, v); slide.rotation.z = -0.55; slide.castShadow = true; g.add(slide);
}
function fitnessProp(g, u, y, v) {
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8C9097', roughness: 0.9 }));
  mat.position.set(u, y + 0.03, v); mat.receiveShadow = true; g.add(mat);
  const bar = new THREE.MeshStandardMaterial({ color: '#E8E6E1' });
  for (let k = -1; k <= 1; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.8, 0.15), bar); b.position.set(u + k * 2, y + 0.9, v); b.castShadow = true; g.add(b); }
}

/* ---------- low-rise: pavilions, porch, commercial (440), sub-station (441) ---------- */
function buildLowRise() {
  for (const lr of SITE.lowRise) {
    const mb = new MultiBuf(), owner = lr.id;
    const u0 = lr.u - lr.lu / 2, u1 = lr.u + lr.lu / 2, v0 = lr.v - lr.lv / 2, v1 = lr.v + lr.lv / 2;
    addBox(mb, u0, u1, lr.height - 0.7, lr.height, v0, v1, { ...allSides('lowRoof', { mode: 'tile', tw: 4 }), T: { mat: 'lowRoof' }, B: { mat: 'soffit' } });
    for (const u of [u0 + 0.6, (u0 + u1) / 2, u1 - 0.6]) for (const v of [v0 + 0.6, v1 - 0.6]) addBox(mb, u - 0.25, u + 0.25, 0, lr.height - 0.7, v - 0.25, v + 0.25, allSides('column'));
    addBox(mb, u0 + 1.5, u0 + lr.lu * 0.35, 0, lr.height - 0.7, v0 + 1.5, v0 + lr.lv * 0.4, { ...allSides('end', { mode: 'tile', tw: 6 }) });
    pushMeshes(mb, owner);
    addPick(owner, 'lowrise', u0, u1, 0, lr.height, v0, v1, 0.3);
    REG.anchors.set(owner, { u: lr.u, y: 3, v: lr.v, size: 40 });
    addLabel(owner, lr.id === 'porch' ? 'Drop-off porch' : 'Blk ' + lr.id, lr.u, lr.height + 5, lr.v, 'small');
  }
  // commercial 440 (world polygons → local)
  const c = SITE.commercial440, mb = new MultiBuf();
  let cu = 0, cv = 0, cn = 0;
  for (const poly of c.polys) {
    const loc = poly.map(([x, z]) => { const p = toLocal(x, z); return [p.u, p.v]; });
    addWalls(mb, loc, 0, c.height, 'shop', 8, 4.5);
    const roof = flatPoly(loc, c.height, matFor('440', 'lowRoof')); roof.castShadow = true; roof.userData.owner = '440'; L.buildings.add(roof);
    const xs = loc.map((p) => p[0]), zs = loc.map((p) => p[1]);
    addPick('440', 'lowrise', Math.min(...xs), Math.max(...xs), 0, c.height, Math.min(...zs), Math.max(...zs), 0.3);
    for (const p of loc) { cu += p[0]; cv += p[1]; cn++; }
  }
  pushMeshes(mb, '440');
  REG.anchors.set('440', { u: cu / cn, y: 4, v: cv / cn, size: 50 });
  addLabel('440', 'Blk 440 · shops', cu / cn, c.height + 5, cv / cn, 'small');
  // ESS 441
  const e = SITE.ess441, mb2 = new MultiBuf();
  const loc = e.poly.map(([x, z]) => { const p = toLocal(x, z); return [p.u, p.v]; });
  addWalls(mb2, loc, 0, e.height, 'ess', 6, 5);
  pushMeshes(mb2, '441');
  const roof = flatPoly(loc, e.height, matFor('441', 'lowRoof')); roof.castShadow = true; roof.userData.owner = '441'; L.buildings.add(roof);
  const xs = loc.map((p) => p[0]), zs = loc.map((p) => p[1]);
  addPick('441', 'lowrise', Math.min(...xs), Math.max(...xs), 0, e.height, Math.min(...zs), Math.max(...zs), 0.3);
  const au = (Math.min(...xs) + Math.max(...xs)) / 2, av = (Math.min(...zs) + Math.max(...zs)) / 2;
  REG.anchors.set('441', { u: au, y: 3, v: av, size: 40 });
  addLabel('441', 'Blk 441 · ESS', au, e.height + 5, av, 'small');
}

/* roof water tanks: one InstancedMesh for the estate */
let tankMesh = null;
function buildTanks() {
  if (tankMesh) { tankMesh.geometry.dispose(); L.roofProps.remove(tankMesh); }
  const geo = new THREE.CylinderGeometry(1, 1, 3, 20);
  tankMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: PAL.tank, roughness: 0.6 }), REG.tanks.length);
  const m4 = new THREE.Matrix4();
  REG.tanks.forEach(([u, y, v, r], i) => { m4.makeScale(r, 1, r); m4.setPosition(u, y + 1.5, v); tankMesh.setMatrixAt(i, m4); });
  tankMesh.castShadow = tankMesh.receiveShadow = true;
  L.roofProps.add(tankMesh);
}

function buildAllBuildings() {
  clearGroup(L.buildings); clearGroup(L.roofProps); clearGroup(L.pick);
  REG.pick.length = 0; REG.walk.length = 0; REG.tanks.length = 0; REG.labels.length = 0; REG.anchors.clear();
  tankMesh = null;
  for (const b of SITE.blocks) (b.kind === 'sale' ? buildResidential : buildPointTowers)(b);
  buildMSCP(); buildLowRise(); buildTanks();
  G.estate.updateMatrixWorld(true);
}

/* =====================================================================
   SITE CONTEXT (world frame)
   ===================================================================== */
const GROUND_HALF = { x: 900, z: 650 };
let ESTATE_CENTRE = new THREE.Vector3();
function computeCentre() {
  let x = 0, z = 0, n = 0;
  for (const b of SITE.blocks) { const p = toWorld(b.core.u, b.core.v); x += p.x; z += p.z; n++; }
  ESTATE_CENTRE.set(x / n, 0, z / n);
}
/** extend a polyline at both ends by d metres along direction dir (unit [dx,dz]; default = its own end segments) */
function extendLine(line, d, dir = null) {
  const a = line[0], b = line[1], y = line[line.length - 2], z = line[line.length - 1];
  const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(z[0] - y[0], z[1] - y[1]);
  const d1 = dir || [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], d2 = dir || [(z[0] - y[0]) / l2, (z[1] - y[1]) / l2];
  return [[a[0] - d1[0] * d, a[1] - d1[1] * d], ...line, [z[0] + d2[0] * d, z[1] + d2[1] * d]];
}
/** canal polygon: both banks extended parallel to the east bank (keeps the channel width) */
function canalPolygon() {
  const e = SITE.canal.east, a = e[0], z = e[e.length - 1], l = Math.hypot(z[0] - a[0], z[1] - a[1]);
  const dir = [(z[0] - a[0]) / l, (z[1] - a[1]) / l];
  const east = extendLine(e, 160, dir), west = extendLine(SITE.canal.west, 160, dir);
  return { east, west, poly: [...east, ...[...west].reverse()] };
}
function groundText(text, x, z, angle, size = 4, color = '#FFFFFF', y = 0.15) {
  const c = document.createElement('canvas'); const fs = 64; const g0 = c.getContext('2d');
  g0.font = `600 ${fs}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const sp = text.split('').join(String.fromCharCode(8202));
  const w = Math.ceil(g0.measureText(sp).width) + 24; c.width = w; c.height = fs + 24;
  const g = c.getContext('2d'); g.font = `600 ${fs}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(sp, 12, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const h = size, wl = h * c.width / c.height;
  const geo = new THREE.PlaneGeometry(wl, h); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  mat.userData.ownMap = true;
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = angle; m.renderOrder = 2;
  return m;
}
function buildContext() {
  for (const k of ['ground', 'context', 'roads', 'canal']) clearGroup(G[k], true);
  computeCentre();
  const cx = ESTATE_CENTRE.x, cz = ESTATE_CENTRE.z;
  // canal polygon (banks extended 160 m each way)
  const { east, west, poly: canalPoly } = canalPolygon();
  // ground with a hole for the canal
  const rect = [[cx - GROUND_HALF.x, cz - GROUND_HALF.z], [cx + GROUND_HALF.x, cz - GROUND_HALF.z], [cx + GROUND_HALF.x, cz + GROUND_HALF.z], [cx - GROUND_HALF.x, cz + GROUND_HALF.z]];
  const shape = new THREE.Shape(rect.map(([x, z]) => new THREE.Vector2(x, -z)));
  shape.holes.push(new THREE.Path(canalPoly.map(([x, z]) => new THREE.Vector2(x, -z))));
  const gg = new THREE.ShapeGeometry(shape); gg.rotateX(-Math.PI / 2);
  const uv = gg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 24, uv.getY(i) / 24);
  TEX.grass.repeat.set(1, 1);
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: '#B9C39A', map: TEX.grass, roughness: 1 }));
  ground.receiveShadow = true; ground.name = 'groundPlane'; G.ground.add(ground);
  // estate site lawn
  const site = flatPoly(SITE.boundary, 0.03, new THREE.MeshStandardMaterial({ color: '#A9BD7A', map: TEX.grass, roughness: 1 }));
  const su = site.geometry.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) / 24, su.getY(i) / 24);
  G.ground.add(site);
  // ground patch that fills the canal opening when the canal layer is hidden
  const patchG = flatPoly(canalPoly, 0.0, new THREE.MeshStandardMaterial({ color: '#B9C39A', roughness: 1 }));
  patchG.name = 'canalPatch'; patchG.visible = !state.settings.layers.canal; G.ground.add(patchG);
  // paved car-park courtyard + service drives (segmented from the plan's light-grey service fill)
  for (const p of SITE.paved || []) { const m = flatPoly(p, 0.06, new THREE.MeshStandardMaterial({ color: '#77736F', map: TEX.asphalt, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 })); const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8); G.ground.add(m); }
  const bl = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(SITE.boundary.map(([x, z]) => new THREE.Vector3(x, 0.25, z))), new THREE.LineBasicMaterial({ color: '#C0392B' }));
  G.ground.add(bl);
  // canal: water + sloped concrete banks
  const water = flatPoly(canalPoly, -1.7, new THREE.MeshStandardMaterial({ color: PAL.canal, roughness: 0.18, metalness: 0.05 }));
  G.canal.add(water);
  const bankMb = new MultiBuf();
  const bank = (line, sideSign) => {
    for (let i = 0; i < line.length - 1; i++) {
      const p = line[i], q = line[i + 1]; const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const nx = -dz / l * sideSign, nz = dx / l * sideSign; // toward water
      const a = [p[0], 0.02, p[1]], b = [q[0], 0.02, q[1]], c = [q[0] + nx * 3, -1.7, q[1] + nz * 3], d = [p[0] + nx * 3, -1.7, p[1] + nz * 3];
      const n = [nx * 0.5, 0.86, nz * 0.5];
      if (sideSign > 0) bankMb.get('bank').quad(a, d, c, b, n, 0, 0, 1, 1); else bankMb.get('bank').quad(a, b, c, d, n, 0, 0, 1, 1);
    }
  };
  bank(east, 1); bank(west, -1);
  for (const m of bankMb.meshes(() => new THREE.MeshStandardMaterial({ color: '#CFCBC4', roughness: 0.9, side: THREE.DoubleSide }), { cast: false })) G.canal.add(m);
  const mid = SITE.canal.east[2];
  G.canal.add(groundText('SUNGEI SEMBAWANG', mid[0] - 12, mid[1] - 35, Math.atan2(SITE.canal.east[3][0] - SITE.canal.east[1][0], SITE.canal.east[3][1] - SITE.canal.east[1][1]) + Math.PI / 2, 5, '#2F5B6A', -1.6));
  // drainage reserve
  G.ground.add(flatPoly(SITE.drainage, 0.06, new THREE.MeshStandardMaterial({ color: '#BFBDBE', roughness: 1 })));
  // reserved / neighbouring sites (flat, labelled — no invented buildings)
  for (const r of SITE.reserved) {
    const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.poly.map(([x, z]) => new THREE.Vector3(x, 0.2, z))), new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8 }));
    G.context.add(ln);
    let x = 0, z = 0; r.poly.forEach((p) => { x += p[0]; z += p[1]; }); x /= r.poly.length; z /= r.poly.length;
    const short = r.name.replace(/\(.*?\)/g, '').replace('Site reserved for', 'Reserved:').replace('future high-rise', 'future high-rise').trim();
    G.context.add(groundText(short.toUpperCase(), x, z, 0, 3.2, '#3E4A2E', 0.22));
    const hit = flatPoly(r.poly, 0.01, PICK_MAT); hit.visible = false; hit.userData = { owner: 'reserved:' + r.name, kind: 'reserved', name: r.name }; G.context.add(hit);
  }
  // roads: kerb/footpath ribbon + asphalt ribbon + name
  for (const rd of SITE.roads) {
    const drive = /driveway|service/i.test(rd.name);
    const kerb = new THREE.Mesh(ribbonGeometry(rd.line, rd.width + (drive ? 2 : 6), 0.07), new THREE.MeshStandardMaterial({ color: PAL.kerb, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    kerb.receiveShadow = true; kerb.userData.roadName = rd.name; G.roads.add(kerb);
    const asph = new THREE.Mesh(ribbonGeometry(rd.line, rd.width, 0.1), new THREE.MeshStandardMaterial({ color: drive ? PAL.drive : '#9A9794', map: TEX.asphalt, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    asph.receiveShadow = true; asph.userData = { owner: 'road:' + rd.name, kind: 'road', roadName: rd.name }; G.roads.add(asph);
    if (!drive && !/unnamed/i.test(rd.name)) {
      // label on the longest segment
      let best = 0, bi = 0; for (let i = 0; i < rd.line.length - 1; i++) { const l = Math.hypot(rd.line[i + 1][0] - rd.line[i][0], rd.line[i + 1][1] - rd.line[i][1]); if (l > best) { best = l; bi = i; } }
      const a = rd.line[bi], b = rd.line[bi + 1];
      let ang = -Math.atan2(b[1] - a[1], b[0] - a[0]); if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;
      const nm = rd.name.replace(/\s*\(existing.*?\)/i, '').replace(/\s*\(future road\)/i, '').toUpperCase() + (rd.status === 'future' ? ' (FUTURE)' : '');
      const gt = groundText(nm, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ang, Math.min(4.5, rd.width * 0.22), '#FFFFFF', 0.16); gt.userData.roadName = rd.name; G.roads.add(gt);
    }
  }
}

/* covered linkways (roof ribbons on posts) */
function buildLinkways() {
  clearGroup(G.linkways, true);
  const roofMat = new THREE.MeshStandardMaterial({ color: PAL.linkRoof, roughness: 0.8, side: THREE.DoubleSide });
  const posts = [];
  for (const lw of SITE.linkways) {
    const top = new THREE.Mesh(ribbonGeometry(lw.line, lw.width, 3.2), roofMat); top.castShadow = top.receiveShadow = true;
    top.userData = { owner: 'linkway', kind: 'linkway', name: lw.name }; G.linkways.add(top);
    for (let i = 0; i < lw.line.length - 1; i++) {
      const a = lw.line[i], b = lw.line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(l / 7));
      const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
      for (let k = 0; k <= n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; posts.push([x + nx * (lw.width / 2 - 0.3), z + nz * (lw.width / 2 - 0.3)], [x - nx * (lw.width / 2 - 0.3), z - nz * (lw.width / 2 - 0.3)]); }
    }
  }
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#5E5E5B' }), posts.length);
  const m4 = new THREE.Matrix4(); posts.forEach(([x, z], i) => { m4.makeTranslation(x, 1.6, z); pm.setMatrixAt(i, m4); });
  G.linkways.add(pm);
  // bus bays (future): small shelters
  for (const bb of SITE.busBays) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 2.6), new THREE.MeshStandardMaterial({ color: '#F2F1EE' }));
    s.position.set(bb.x, 2.7, bb.z); s.castShadow = true; G.linkways.add(s);
  }
}

/* landscape: instanced trees (representative, not surveyed) + ground facility props */
function blocked(x, z, pad = 2) {
  const { u, v } = toLocal(x, z);
  for (const b of REG.walk) if (u > b.u0 - pad - 1.5 && u < b.u1 + pad + 1.5 && v > b.v0 - pad - 1.5 && v < b.v1 + pad + 1.5) return true;
  for (const rd of SITE.roads) if (distToPolyline(x, z, rd.line) < rd.width / 2 + 3) return true;
  for (const lw of SITE.linkways) if (distToPolyline(x, z, lw.line) < lw.width / 2 + 1.5) return true;
  for (const f of SITE.facilities) if (!f.onRoof && Math.hypot(x - f.x, z - f.z) < 7) return true;
  return false;
}
function buildLandscape() {
  clearGroup(G.landscape, true); clearGroup(G.facilities, true);
  const rnd = mulberry32(2026);
  const pts = []; // [x, y, z, scale, colourIdx]
  const bnd = SITE.boundary;
  // trees along the site boundary (inset 4 m), every ~7 m
  const c = ESTATE_CENTRE;
  for (let i = 0; i < bnd.length; i++) {
    const a = bnd[i], b = bnd[(i + 1) % bnd.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 3; d < l; d += 6 + rnd() * 3) {
      let x = a[0] + (b[0] - a[0]) * d / l, z = a[1] + (b[1] - a[1]) * d / l;
      // nudge inward
      const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l; const s = pointInPoly(x + nx * 4, z + nz * 4, bnd) ? 1 : -1;
      x += nx * 4 * s; z += nz * 4 * s;
      if (!blocked(x, z)) pts.push([x, 0, z, 0.8 + rnd() * 0.6, (rnd() * 3) | 0]);
    }
  }
  // along linkways
  for (const lw of SITE.linkways) for (let i = 0; i < lw.line.length - 1; i++) {
    const a = lw.line[i], b = lw.line[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    for (let d = 5; d < l; d += 11 + rnd() * 5) for (const sgn of [-1, 1]) {
      const x = a[0] + (b[0] - a[0]) * d / l + nx * sgn * 6, z = a[1] + (b[1] - a[1]) * d / l + nz * sgn * 6;
      if (pointInPoly(x, z, bnd) && !blocked(x, z)) pts.push([x, 0, z, 0.7 + rnd() * 0.5, (rnd() * 3) | 0]);
    }
  }
  // clusters around ground facilities and in courtyards
  for (const f of SITE.facilities.filter((f) => !f.onRoof)) for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2, r = 10 + rnd() * 8, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
    if (pointInPoly(x, z, bnd) && !blocked(x, z, 1)) pts.push([x, 0, z, 0.7 + rnd() * 0.6, (rnd() * 3) | 0]);
  }
  // random infill inside the site
  for (let k = 0; k < 900 && pts.length < 520; k++) {
    const x = c.x - 260 + rnd() * 520, z = c.z - 160 + rnd() * 260;
    if (pointInPoly(x, z, bnd) && !blocked(x, z, 4)) pts.push([x, 0, z, 0.6 + rnd() * 0.6, (rnd() * 3) | 0]);
  }
  // Blk 436 roof garden trees (local → world)
  const m = SITE.mscp, ww = m.westWing, r0 = (ww.u1 - ww.u0) / 2;
  for (let k = 0; k < 60 && pts.length < 580; k++) {
    const u = ww.u0 + 3 + rnd() * (ww.u1 - ww.u0 - 6), v = ww.v0 + r0 + 2 + rnd() * (ww.v1 - ww.v0 - r0 - 4);
    const au = (ww.u0 + ww.u1) / 2 + 2; if (Math.abs(u - au) < 5) continue;
    if (u < ww.u0 + 18 && v > ww.v1 - 28) continue; // plots
    if (Math.hypot(u - (ww.u0 + 4.5), v - (ww.v0 + r0 + 1)) < 7 || Math.hypot(u - (ww.u1 - 3), v - (m.southWing.v1 - 3.5)) < 7) continue; // stair cores
    const p = toWorld(u, v); pts.push([p.x, m.height, p.z, 0.45 + rnd() * 0.3, (rnd() * 3) | 0]);
  }
  const canopyG = new THREE.IcosahedronGeometry(1, 1), trunkG = new THREE.CylinderGeometry(0.18, 0.25, 1, 6);
  const canopy = new THREE.InstancedMesh(canopyG, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), pts.length);
  const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#5A4A3A' }), pts.length);
  const greens = [new THREE.Color('#4F6B32'), new THREE.Color('#6E8F40'), new THREE.Color('#90A85A')];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  pts.forEach(([x, y, z, s, ci], i) => {
    const h = 6 * s, cr = 3.2 * s;
    m4.compose(p3.set(x, y + h * 0.45 + cr * 0.7, z), q, s3.set(cr, cr * 0.85, cr)); canopy.setMatrixAt(i, m4); canopy.setColorAt(i, greens[ci]);
    m4.compose(p3.set(x, y + h * 0.3, z), q, s3.set(1, h * 0.6, 1)); trunk.setMatrixAt(i, m4);
  });
  canopy.castShadow = true; canopy.receiveShadow = true; trunk.castShadow = true;
  G.landscape.add(canopy, trunk);
  G.landscape.userData.treeCount = pts.length;
  // ground facility props + pins
  for (const f of SITE.facilities) {
    const y = f.onRoof ? MSCP_H + 0.05 : 0.12;
    if (!f.onRoof) {
      const { u, v } = toLocal(f.x, f.z), g = new THREE.Group();
      g.rotation.y = GRID; // placed in world, rotated like the estate grid
      g.position.set(f.x, 0, f.z);
      if (/playground/i.test(f.name)) playgroundProp(g, 0, 0.1, 0);
      else if (/fitness/i.test(f.name)) fitnessProp(g, 0, 0.1, 0);
      else if (/hardcourt/i.test(f.name)) { const ct = new THREE.Mesh(new THREE.PlaneGeometry(15, 26).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4E7F6A' })); ct.position.y = 0.12; ct.receiveShadow = true; g.add(ct); }
      else if (/future community/i.test(f.name)) { const pd = new THREE.Mesh(new THREE.PlaneGeometry(11, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#BDBAB3' })); pd.position.y = 0.12; g.add(pd); }
      if (g.children.length) G.landscape.add(g);
    }
    const el = document.createElement('button'); el.type = 'button'; el.className = 'pin';
    el.title = f.name + ' — ' + f.where; el.setAttribute('aria-label', f.name);
    el.textContent = /playground/i.test(f.name) ? '◎' : /fitness/i.test(f.name) ? '✚' : /pavilion|porch/i.test(f.name) ? '⌂' : /school|preschool/i.test(f.name) ? '✎' : /eating|shop|mart/i.test(f.name) ? '¤' : /heavy vehicle/i.test(f.name) ? '!' : '•';
    if (f.context) el.classList.add('ctx');
    el.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'facility', id: f.name + '@' + f.x + ',' + f.z, f }); });
    const o = new CSS2DObject(el); o.position.set(f.x, y + 4, f.z); G.facilities.add(o);
  }
  for (const bb of SITE.busBays) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'pin bus'; el.textContent = 'B'; el.title = 'Future bus bay & shelter — ' + bb.road;
    el.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'facility', id: 'bus@' + bb.x, f: { name: 'Future bus bay & shelter', where: bb.road, conf: '[Read label; position ±3 m]', x: bb.x, z: bb.z } }); });
    const o = new CSS2DObject(el); o.position.set(bb.x, 6, bb.z); G.facilities.add(o);
  }
}
