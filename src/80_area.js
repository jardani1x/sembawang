/* =====================================================================
   80 AREA — the wider Sembawang area from OpenStreetMap.
   Sources (in order): cached live data (IndexedDB) → bundled snapshot
   (data/area-snapshot.json, built from an overpass-turbo export) → live
   update from the Overpass API on request (B). Conversion is the shared
   75_osmconv.js, so snapshot and live data are identical in shape.
   Everything is placed in the SITE frame via SITE.georef.
   ===================================================================== */

const AREA = {
  status: 'off',            // off | loading | ready | error
  data: null,               // converted area data
  group: new THREE.Group(),
  pickMeshes: [],           // meshes whose triangles map to buildings (userData.tri2b)
  occ: [],                  // per building: {x0,x1,z0,z1,h,base,ring}
  search: [],               // search entries (names, addresses, parks, roads)
  labels: [],
  message: '',
};
AREA.group.name = 'area'; AREA.group.visible = false; scene.add(AREA.group);
AREA.sel = new THREE.Group(); AREA.sel.name = 'areaSel'; scene.add(AREA.sel); // world-frame selection outline
const AREA_SNAPSHOT_URL = 'data/area-snapshot.json';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AREA_COL = {
  hdb: ['#ECE9E2', '#C9C4BB'], house: ['#E9DCC8', '#B97A5C'], industrial: ['#CDD2D8', '#A7ADB4'],
  civic: ['#E8E2D2', '#BDB6A6'], other: ['#E3E1DC', '#BEBBB4'], est: ['#F2C8A0', '#E0A877'],
  land: '#DADDD0', sea: '#9CCBE0', water: '#8EC4DA', park: '#9DBA6A', major: '#9A9794', minor: '#ABA8A4', service: '#B8B5B0',
};
function areaCat(b) {
  const t = b.t || 'yes';
  if (/^(apartments|residential|dormitory)$/.test(t)) return 'hdb';
  if (/^(house|detached|semidetached_house|terrace|bungalow)$/.test(t)) return 'house';
  if (/^(industrial|warehouse|manufacture|shed|roof|parking|garages|construction)$/.test(t)) return 'industrial';
  if (/^(school|public|commercial|retail|civic|government|hospital|temple|church|mosque|train_station|transportation|kindergarten|college|university|community_centre|office)$/.test(t)) return 'civic';
  return 'other';
}
const ringPts = (flat) => { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); return r; };

/* ---------- validation of converted data (snapshot, cache or live) ---------- */
function areaValidate(d) {
  if (!d || d.format !== 'sembawang-area' || d.version !== 1) throw new Error('not Sembawang area data (format/version)');
  for (const k of ['buildings', 'roads', 'waterways', 'water', 'parks']) if (!Array.isArray(d[k])) throw new Error(k + ' missing');
  if (!Array.isArray(d.bbox) || d.bbox.length !== 4 || !d.bbox.every(Number.isFinite)) throw new Error('bbox missing');
  if (d.buildings.length < 50) throw new Error('too few buildings (' + d.buildings.length + ')');
  for (const b of d.buildings.slice(0, 200)) if (!Array.isArray(b.r) || b.r.length < 6 || !(b.h > 0)) throw new Error('bad building ' + b.id);
  return d;
}

/* ---------- IndexedDB cache for live data ---------- */
function idb(mode, fn) {
  return new Promise((res, rej) => {
    let req; try { req = indexedDB.open('sembawang-brook-3d', 1); } catch (e) { rej(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => rej(req.error);
    req.onsuccess = () => { const db = req.result; const tx = db.transaction('kv', mode); const st = tx.objectStore('kv'); const r = fn(st); tx.oncomplete = () => { res(r && r.result); db.close(); }; tx.onerror = () => { rej(tx.error); db.close(); }; };
  });
}
const cacheGet = () => idb('readonly', (s) => s.get('area')).catch(() => null);
const cachePut = (d) => idb('readwrite', (s) => s.put(d, 'area')).catch(() => null);
const cacheDel = () => idb('readwrite', (s) => s.delete('area')).catch(() => null);

/* ---------- loading ---------- */
async function areaLoad() {
  if (AREA.status === 'ready' || AREA.status === 'loading') return;
  AREA.status = 'loading'; emit('area', AREA);
  try {
    let d = null;
    const cached = await cacheGet();
    if (cached) { try { d = areaValidate(cached); } catch (e) { d = null; } }
    if (!d) {
      const res = await fetch(AREA_SNAPSHOT_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('snapshot HTTP ' + res.status);
      d = areaValidate(await res.json());
    }
    areaUse(d);
  } catch (e) {
    AREA.status = 'error';
    AREA.message = location.protocol === 'file:'
      ? 'The area data file can’t be read when the page is opened straight from disk. Use the GitHub Pages link, run a local web server, or tap “Update from OpenStreetMap”.'
      : 'Couldn’t load the area data (' + e.message + ').';
    emit('area', AREA);
  }
}
/** live update (option B): Overpass API → shared converter → cache */
async function areaLiveUpdate(onProgress) {
  const q = OSM_QUERY(OSM_BBOX); let lastErr = null;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 429 ? ' (server busy — try again in a minute)' : ''));
      let text;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader(), chunks = []; let n = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onProgress && onProgress(n); }
        const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
        text = new TextDecoder().decode(all);
      } else text = await res.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) throw new Error('unexpected response');
      const d = areaValidate(osmConvert(json.elements, { georef: SITE.georef, exclude: SITE.boundary, bbox: OSM_BBOX, kind: 'live', timestamp: (json.osm3s && json.osm3s.timestamp_osm_base) || new Date().toISOString() }));
      await cachePut(d);
      areaUse(d);
      return d;
    } catch (e) { lastErr = e; }
  }
  const blocked = IN_FRAME || /Failed to fetch|NetworkError|Load failed/i.test(String(lastErr && lastErr.message));
  throw new Error(blocked ? 'OpenStreetMap couldn’t be reached from this view. Live updates work on the GitHub Pages version (this Claude view blocks outside data).' : String(lastErr && lastErr.message));
}
async function areaUseSnapshot() { await cacheDel(); AREA.status = 'off'; clearGroup(AREA.group, true); await areaLoad(); }

/* ---------- build meshes ---------- */
function areaUse(d) {
  if (state.selection && state.selection.kind === 'osm') select(null); // building indices change with new data
  AREA.data = d; clearGroup(AREA.group, true); AREA.pickMeshes = []; AREA.occ = []; AREA.labels = [];
  const [bx0, bz0, bx1, bz1] = Array.isArray(d.ext) && d.ext.length === 4 ? d.ext : d.bbox; // ground covers features straddling the query box
  // ground: land (or sea + coast-derived land)
  const rect = [[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]];
  if (Array.isArray(d.land) && d.land.length) {
    // the land sits only 0.3 m above the sea; at 5 km that is below depth-buffer precision, so push the sea back
    AREA.group.add(flatPoly(rect, -0.35, new THREE.MeshStandardMaterial({ color: AREA_COL.sea, roughness: 0.25, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 })));
    for (const r of d.land) AREA.group.add(flatPoly(ringPts(r), -0.06, new THREE.MeshStandardMaterial({ color: AREA_COL.land, roughness: 1 })));
  } else AREA.group.add(flatPoly(rect, -0.06, new THREE.MeshStandardMaterial({ color: AREA_COL.land, roughness: 1 })));
  // parks + water polygons
  const parkMat = new THREE.MeshStandardMaterial({ color: AREA_COL.park, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const p of d.parks) { try { AREA.group.add(flatPoly(ringPts(p.r), -0.03, parkMat)); } catch (e) { /* degenerate */ } }
  const waterMat = new THREE.MeshStandardMaterial({ color: AREA_COL.water, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const w of d.water) { try { AREA.group.add(flatPoly(ringPts(w.r), -0.02, waterMat)); } catch (e) { /* degenerate */ } }
  // roads + waterways as merged ribbons per class
  const ribbons = new Map();
  const addRibbon = (key, flat, w, y) => {
    const line = ringPts(flat); if (line.length < 2) return;
    const g = ribbonGeometry(line, w, y); if (!ribbons.has(key)) ribbons.set(key, []); ribbons.get(key).push(g);
  };
  for (const r of d.roads) { const k = /^(motorway|trunk|primary|secondary)/.test(r.c) ? 'major' : /^(tertiary|residential|unclassified|living_street)/.test(r.c) ? 'minor' : 'service'; addRibbon(k, r.p, r.w, k === 'major' ? 0.02 : k === 'minor' ? 0.015 : 0.01); }
  for (const w of d.waterways) addRibbon('water', w.p, w.w, 0.005);
  for (const [k, geos] of ribbons) {
    const merged = mergeGeos(geos); geos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: AREA_COL[k], roughness: k === 'water' ? 0.25 : 0.95, polygonOffset: true, polygonOffsetFactor: k === 'water' ? -3 : k === 'major' ? -6 : k === 'minor' ? -5 : -4 }));
    m.receiveShadow = true; m.userData.areaKind = k; AREA.group.add(m);
  }
  // buildings: extruded footprints merged into ~800 m tiles (vertex colours, triangle → building map)
  const TILE = 1100, tiles = new Map();
  d.buildings.forEach((b, i) => {
    const ring = ringPts(b.r); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    AREA.occ.push({ x0, x1, z0, z1, h: b.h, base: b.b || 0, ring });
    const key = Math.floor((x0 + x1) / 2 / TILE) + ',' + Math.floor((z0 + z1) / 2 / TILE);
    if (!tiles.has(key)) tiles.set(key, []); tiles.get(key).push(i);
  });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  for (const ids of tiles.values()) {
    const pos = [], nor = [], col = [], colE = [], tri2b = [];
    const cTmp = new THREE.Color(), cE = new THREE.Color();
    for (const i of ids) {
      const b = d.buildings[i], ring = AREA.occ[i].ring, h = b.h, base = b.b || 0, cat = areaCat(b);
      const [wallHex, roofHex] = AREA_COL[cat]; const est = b.s === 'e';
      const push = (p, n, hex, hexE) => { pos.push(...p); nor.push(...n); cTmp.set(hex); col.push(cTmp.r, cTmp.g, cTmp.b); cE.set(hexE); colE.push(cE.r, cE.g, cE.b); };
      const ccw = osmArea(ring) > 0; // in (x,z): positive = clockwise seen from above
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); if (L < 1e-3) continue;
        let n = ccw ? [dz / L, 0, -dx / L] : [-dz / L, 0, dx / L];
        // winding: geometric normal of (p,q,q+up) is (-dz, dx); swap when it disagrees with n
        const swap = (-dz * n[0] + dx * n[2]) < 0; const A = swap ? q : p, B = swap ? p : q;
        const v = [[A[0], base, A[1]], [B[0], base, B[1]], [B[0], h, B[1]], [A[0], base, A[1]], [B[0], h, B[1]], [A[0], h, A[1]]];
        for (const vv of v) push(vv, n, wallHex, est ? AREA_COL.est[0] : wallHex);
        tri2b.push(i, i);
      }
      // roof (earcut via ShapeUtils)
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, -z));
      let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { tris = []; }
      for (const t of tris) {
        // make each roof triangle face up regardless of the triangulator's winding
        const [a, bb, c] = t.map((k) => ring[k]);
        const ny = (bb[1] - a[1]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[1] - a[1]);
        const order = ny >= 0 ? [a, bb, c] : [a, c, bb];
        for (const p of order) push([p[0], h, p[1]], [0, 1, 0], roofHex, est ? AREA_COL.est[1] : roofHex);
        tri2b.push(i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const ca = new THREE.Float32BufferAttribute(col, 3), ce = new THREE.Float32BufferAttribute(colE, 3);
    g.setAttribute('color', state.settings.layers.areaEstimated ? ce : ca);
    g.userData = { colorBase: ca, colorEst: ce };
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
    m.userData.tri2b = Uint32Array.from(tri2b); m.userData.areaKind = 'buildings';
    AREA.group.add(m); AREA.pickMeshes.push(m);
  }
  // labels: larger named parks + Sembawang Park; road names on the ground for main roads
  for (const p of d.parks) {
    if (!p.n) continue; const r = ringPts(p.r), a = Math.abs(osmArea(r));
    if (a < 15000 && !/Sembawang Park/i.test(p.n)) continue;
    const c = osmCentroid(r), el = document.createElement('div'); el.className = 'lbl small park'; el.textContent = p.n;
    const o = new CSS2DObject(el); o.position.set(c[0], 6, c[1]); o.userData.always = /Sembawang Park/i.test(p.n); AREA.group.add(o); AREA.labels.push(o);
  }
  const best = new Map();
  for (const r of d.roads) {
    if (!r.n || !/^(primary|secondary|tertiary|trunk)/.test(r.c)) continue;
    const pts = ringPts(r.p);
    for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (!best.has(r.n) || L > best.get(r.n).L) best.set(r.n, { L, a: pts[i], b: pts[i + 1], w: r.w }); }
  }
  for (const [n, s] of best) {
    if (s.L < 60) continue;
    let ang = -Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]); if (Math.abs(ang) > Math.PI / 2) ang += Math.PI;
    AREA.group.add(groundText(n.toUpperCase(), (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, ang, Math.max(4, Math.min(9, s.w * 0.7)), '#FFFFFF', 0.2));
  }
  // estate marker for far-out views
  const em = document.createElement('button'); em.type = 'button'; em.className = 'lbl estate'; em.textContent = 'Sembawang Brook';
  em.addEventListener('click', (e) => { e.stopPropagation(); goPreset('iso'); });
  const eo = new CSS2DObject(em); eo.position.set(ESTATE_CENTRE.x, 120, ESTATE_CENTRE.z); eo.userData.estateMarker = true; AREA.group.add(eo); AREA.labels.push(eo);
  areaBuildSearch();
  AREA.status = 'ready'; AREA.message = '';
  applyArea(); emit('area', AREA);
}
function mergeGeos(geos) {
  let n = 0, ni = 0; for (const g of geos) { n += g.attributes.position.count; ni += g.index ? g.index.count : 0; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint32Array(ni); let o = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) idx[oi + k] = a[k] + o; oi += a.length; }
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeBoundingSphere(); return m;
}
function areaRecolour() {
  for (const m of AREA.pickMeshes) { const u = m.geometry.userData; m.geometry.setAttribute('color', state.settings.layers.areaEstimated ? u.colorEst : u.colorBase); }
  requestRender();
}

/* ---------- show/hide: estate context that OSM replaces ---------- */
const OSM_REPLACES_ROADS = new Set(['Admiralty Street', 'Sembawang Drive', 'Woodlands Avenue 10', 'Admiralty Lane (existing, east of Sembawang Drive)']);
function applyArea() {
  const on = !!state.settings.layers.area && AREA.status === 'ready';
  AREA.group.visible = on; setCssVisible(AREA.group, on);
  const gp = G.ground.getObjectByName('groundPlane'); if (gp) gp.visible = !on;
  const cp = G.ground.getObjectByName('canalPatch'); if (cp) cp.visible = !on && !state.settings.layers.canal;
  G.canal.visible = !on && state.settings.layers.canal;
  for (const o of G.roads.children) { const nm = o.userData.roadName; if (nm && OSM_REPLACES_ROADS.has(nm)) o.visible = !on; }
  scene.fog.near = on ? 3500 : 1100; scene.fog.far = on ? 11000 : 3200;
  camera.far = on ? 16000 : 6000; camera.updateProjectionMatrix();
  controls.maxDistance = on ? 7000 : 1600;
  $('#areaBadge').hidden = !on;
  if (sunFrameChanged(sunFrameFor())) updateSun(); // sunlight/shadows/sun path: estate frame ↔ area frame
  state.shadowsDirty = true; requestRender();
}
// in the area view the sunlight, shadows and sun path follow the view (see sunFrameFor)
controls.addEventListener('change', () => { if (state.settings.layers.area && AREA.status === 'ready' && sunFrameChanged(sunFrameFor())) updateSun(); });
async function setAreaOn(on, fly = true) {
  state.settings.layers.area = on; saveSettings(); syncAreaUI();
  if (on && AREA.status !== 'ready') { await areaLoad(); }
  applyArea();
  if (on && fly && AREA.status === 'ready') goPreset('area');
}

/* ---------- picking + info ---------- */
const _araycaster = new THREE.Raycaster();
function areaPick(rc) {
  if (!AREA.group.visible || !AREA.pickMeshes.length) return null;
  const hits = rc.intersectObjects(AREA.pickMeshes, false);
  if (!hits.length) return null;
  const h = hits[0], bi = h.object.userData.tri2b[h.faceIndex];
  return bi == null ? null : { kind: 'osm', id: 'osm:' + AREA.data.buildings[bi].id, bi, dist: h.distance };
}
function areaInfoHTML(bi) {
  const b = AREA.data.buildings[bi], src = { h: 'OSM height tag', l: 'OSM storeys', e: 'estimated (no height in OSM)' }[b.s];
  const kind = b.t ? b.t.replace(/_/g, ' ') : 'building';
  const osmUrl = 'https://www.openstreetmap.org/' + ({ w: 'way', r: 'relation' }[b.id[0]] || 'way') + '/' + b.id.slice(1);
  return `<h2>${esc(b.n || (b.a ? (/^\d/.test(b.a) ? 'Blk ' : '') + b.a : 'Building'))}</h2><p class="sub">${esc(kind[0].toUpperCase() + kind.slice(1))} · OpenStreetMap</p>
    <dl class="kv">${b.a ? `<dt>Address</dt><dd>${esc(b.a)}</dd>` : ''}${b.l ? `<dt>Storeys</dt><dd>${b.l} ${tag('OSM')}</dd>` : ''}
    <dt>Height</dt><dd>≈ ${fmt(b.h)} m ${tag(b.s === 'e' ? 'Estimated' : 'OSM')}<br><small class="muted">${esc(src)}${b.s === 'l' ? (/^(apartments|residential|dormitory)$/.test(b.t || '') && b.l >= 4 ? ' · 3.6 m void deck + 2.8 m storeys' : ' · 3 m per storey') : ''}</small></dd>
    <dt>Data</dt><dd>© OpenStreetMap contributors (ODbL) · ${esc(AREA.data.source.kind === 'live' ? 'live' : 'snapshot')} ${esc((AREA.data.source.timestamp || '').slice(0, 10))}</dd></dl>
    <div class="row"><a class="btn sm ghost" href="${osmUrl}" target="_blank" rel="noopener">View on OpenStreetMap</a></div>`;
}
function areaSelection(bi) {
  const b = AREA.data.buildings[bi], ring = ringPts(b.r), base = b.b || 0, top = b.h;
  const g = new THREE.Group(), mat = new THREE.LineBasicMaterial({ color: '#0A84FF' });
  for (const y of [base + 0.2, top + 0.2]) g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map(([x, z]) => new THREE.Vector3(x, y, z))), mat));
  const v = []; for (const [x, z] of ring) v.push(new THREE.Vector3(x, base, z), new THREE.Vector3(x, top, z));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), mat));
  return g;
}
function areaFocus(bi) {
  const b = AREA.data.buildings[bi], c = osmCentroid(ringPts(b.r)), d = Math.max(90, b.h * 3);
  flyTo(new THREE.Vector3(c[0] + d * 0.7, b.h + d * 0.6, c[1] + d * 0.7), new THREE.Vector3(c[0], b.h / 2, c[1]), 50);
}

/* ---------- search entries ---------- */
function areaBuildSearch() {
  AREA.search = [];
  const d = AREA.data;
  d.buildings.forEach((b, i) => {
    if (!b.n && !b.a) return;
    const label = b.n ? b.n : (/^\d/.test(b.a) ? 'Blk ' : '') + b.a;
    AREA.search.push({ kind: 'Area', label, sub: [b.n && b.a ? b.a : '', b.l ? b.l + ' storeys' : '', 'OSM'].filter(Boolean).join(' · '),
      keys: [b.n || '', b.a || '', b.a ? 'blk ' + b.a : ''].filter(Boolean),
      go: () => { if (!state.settings.layers.area) setAreaOn(true, false); select({ kind: 'osm', id: 'osm:' + b.id, bi: i }); areaFocus(i); } });
  });
  for (const p of d.parks) if (p.n) {
    const c = osmCentroid(ringPts(p.r));
    AREA.search.push({ kind: 'Park', label: p.n, sub: 'OSM', keys: [p.n, 'park'], go: () => { if (!state.settings.layers.area) setAreaOn(true, false); select(null); flyTo(new THREE.Vector3(c[0] - 260, 260, c[1] + 260), new THREE.Vector3(c[0], 0, c[1]), 50); } });
  }
  const roads = new Map(); for (const r of d.roads) if (r.n && !roads.has(r.n)) roads.set(r.n, r);
  for (const [n, r] of roads) {
    if (SITE.roads.some((x) => x.name === n)) continue;
    const pts = ringPts(r.p), m = pts[Math.floor(pts.length / 2)];
    AREA.search.push({ kind: 'Road', label: n, sub: 'OSM', keys: [n], go: () => { if (!state.settings.layers.area) setAreaOn(true, false); select(null); flyTo(new THREE.Vector3(m[0] + 150, 180, m[1] + 150), new THREE.Vector3(m[0], 0, m[1]), 50); } });
  }
  for (const p of AREA.search) p.nkeys = p.keys.map(norm);
}

/* ---------- sun-ray occlusion by surrounding OSM buildings ---------- */
/** buildings near a point (prefilter for a flat's sun-hours run) */
function areaOccludersNear(x, z, R = 1500) {
  if (AREA.status !== 'ready') return [];
  return AREA.occ.filter((o) => o.x1 > x - R && o.x0 < x + R && o.z1 > z - R && o.z0 < z + R);
}
/** does the ray o + t·d (t>0, d.y>0) pass through any extruded footprint in `occs`? */
function areaRayBlocked(o, d, occs) {
  for (const b of occs) {
    // vertical slab of the building: t where base ≤ y ≤ h
    let ty0 = (b.base - o.y) / d.y, ty1 = (b.h - o.y) / d.y; if (ty0 > ty1) [ty0, ty1] = [ty1, ty0];
    let t0 = Math.max(0, ty0), t1 = ty1; if (t1 <= t0) continue;
    // AABB in x and z
    for (const [p, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.z, d.z, b.z0, b.z1]]) {
      if (Math.abs(dd) < 1e-12) { if (p < lo || p > hi) { t1 = -1; break; } continue; }
      let a = (lo - p) / dd, c = (hi - p) / dd; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t1 <= t0) break;
    }
    if (t1 <= t0) continue;
    // exact: 2D segment [t0,t1] against the footprint polygon
    const ax = o.x + d.x * t0, az = o.z + d.z * t0, bx = o.x + d.x * t1, bz = o.z + d.z * t1;
    if (osmInPoly(ax, az, b.ring) || osmInPoly(bx, bz, b.ring)) return true;
    const r = b.ring;
    for (let k = 0; k < r.length; k++) {
      const p = r[k], q = r[(k + 1) % r.length];
      const d1 = (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax), d2 = (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax);
      const d3 = (q[0] - p[0]) * (az - p[1]) - (q[1] - p[1]) * (ax - p[0]), d4 = (q[0] - p[0]) * (bz - p[1]) - (q[1] - p[1]) * (bx - p[0]);
      if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return true;
    }
  }
  return false;
}

/* ---------- UI binding (Explore → Sembawang area) ---------- */
function syncAreaUI() {
  const on = !!state.settings.layers.area;
  $('#btnArea').setAttribute('aria-pressed', on);
  $('#areaOn').checked = on; $('#areaEst').checked = !!state.settings.layers.areaEstimated;
  const d = AREA.data, st = $('#areaStatus');
  if (AREA.status === 'loading') st.textContent = 'Loading the Sembawang area…';
  else if (AREA.status === 'error') st.textContent = AREA.message;
  else if (d) {
    const s = d.stats || {}, hs = s.heightSrc || {};
    st.innerHTML = `${d.buildings.length.toLocaleString()} buildings · ${((hs.levels || 0) + (hs.height || 0)).toLocaleString()} with heights from OSM, ${(hs.estimated || 0).toLocaleString()} estimated<br>
      <b>${d.source.kind === 'live' ? 'Live OSM data' : 'Snapshot'}</b> · ${esc((d.source.timestamp || '').replace('T', ' ').slice(0, 16))} UTC${d.land ? '' : ' · coastline not in this data (sea shown as land)'}`;
  } else st.textContent = 'Off. Turn it on to load about 4,000 OSM buildings around the estate.';
  $('#areaSnapshot').hidden = !(d && d.source.kind === 'live');
}
on('area', () => { syncAreaUI(); if (state.selection && state.selection.kind === 'osm' && AREA.status !== 'ready') select(null); });
$('#btnArea').addEventListener('click', () => setAreaOn(!state.settings.layers.area));
$('#areaOn').addEventListener('change', (e) => setAreaOn(e.target.checked));
$('#areaEst').addEventListener('change', (e) => { state.settings.layers.areaEstimated = e.target.checked; saveSettings(); areaRecolour(); });
$('#areaUpdate').addEventListener('click', async () => {
  const btn = $('#areaUpdate'), st = $('#areaStatus'); btn.disabled = true;
  st.textContent = 'Asking OpenStreetMap (Overpass API)… this can take 20–60 s and ~15 MB.';
  try {
    await areaLiveUpdate((n) => { st.textContent = `Downloading from OpenStreetMap… ${(n / 1048576).toFixed(1)} MB`; });
    state.settings.layers.area = true; saveSettings(); applyArea(); syncAreaUI(); toast('Area updated from OpenStreetMap');
  } catch (e) { st.textContent = e.message; toast('Live update failed', true); }
  finally { btn.disabled = false; }
});
$('#areaSnapshot').addEventListener('click', async () => { await areaUseSnapshot(); toast('Using the bundled snapshot'); });
