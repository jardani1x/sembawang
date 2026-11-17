/* =====================================================================
   75 OSM CONVERTER — pure functions, no THREE/DOM. Used by the page for
   live OpenStreetMap updates AND by tools/build_area.mjs (Node) to build
   the bundled snapshot, so both paths produce identical data.

   Input : Overpass API JSON elements (`out geom`): ways with geometry
           [{lat,lon}], multipolygon relations with member geometry.
   Output: compact area data in the SITE frame (metres, +X east, +Z south,
           origin = SW corner of Blk 436), via data/source/georef.json.
   ===================================================================== */

const OSMCONV_VERSION = 1;
const OSM_BBOX = [1.4240, 103.7900, 1.4750, 103.8480];
const EXT_CAP = 1000; // m: how far the ground may extend beyond the query box (< the 0.01° coastline margin) // S, W, N, E — live query: Sembawang town to Sembawang Park and the coast
const OSM_QUERY = (b = OSM_BBOX) => {
  const bb = b.join(',');
  // coastline from a box 0.01° (~1.1 km) wider, so it is complete under the ground extent (see EXT_CAP)
  const bc = [b[0] - 0.01, b[1] - 0.01, b[2] + 0.01, b[3] + 0.01].map((v) => +v.toFixed(4)).join(',');
  return `[out:json][timeout:180];(` +
    `way["building"](${bb});relation["building"](${bb});` +
    `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bb});` +
    `way["waterway"](${bb});way["natural"="water"](${bb});relation["natural"="water"](${bb});` +
    `way["leisure"="park"](${bb});relation["leisure"="park"](${bb});way["natural"="coastline"](${bc});` +
    `);out geom;`;
};

/* ---------- projection: WGS84 → local tangent plane → site frame ---------- */
function osmProjector(g) {
  const r = Math.PI / 180, kx = r * g.N * Math.cos(g.lat0 * r), kz = r * g.M;
  const c = Math.cos(g.theta || 0), s = Math.sin(g.theta || 0), sc = g.scale || 1;
  return (lat, lon) => {
    const x = (lon - g.lon0) * kx - g.tx, z = -(lat - g.lat0) * kz - g.tz;
    // inverse of P_osm = s·R(θ)·P_site + t
    return [Math.round(((c * x + s * z) / sc) * 10) / 10, Math.round(((-s * x + c * z) / sc) * 10) / 10];
  };
}

/* ---------- geometry helpers ---------- */
function osmArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function osmCentroid(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
function osmInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function osmSimplify(pts, eps) { // Ramer–Douglas–Peucker (open polyline)
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9; let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dz * (pts[i][0] - ax) - dx * (pts[i][1] - az)) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function osmCleanRing(pts, eps = 0.25) {
  const r = pts.slice(); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if (r.length < 3) return null;
  // closed ring: split at the vertex farthest from r[0] and simplify both halves (RDP needs a non-degenerate chord)
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = osmSimplify(r.slice(0, far + 1), eps), b = osmSimplify([...r.slice(far), r[0]], eps);
  const s = a.concat(b.slice(1, -1));
  return s.length >= 3 && Math.abs(osmArea(s)) >= 2 ? s : null;
}
/** join way segments (arrays of points) into rings/chains by matching endpoints */
function osmJoin(segs, allowReverse = true) {
  const key = (p) => p[0] + ',' + p[1];
  const pool = segs.filter((s) => s.length >= 2).map((s) => s.slice());
  const out = [];
  while (pool.length) {
    let cur = pool.shift(), grown = true;
    while (grown && key(cur[0]) !== key(cur[cur.length - 1])) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (key(s[0]) === key(cur[cur.length - 1])) { cur = cur.concat(s.slice(1)); }
        else if (key(s[s.length - 1]) === key(cur[0])) { cur = s.concat(cur.slice(1)); }
        else if (allowReverse && key(s[s.length - 1]) === key(cur[cur.length - 1])) { cur = cur.concat(s.slice(0, -1).reverse()); }
        else if (allowReverse && key(s[0]) === key(cur[0])) { cur = s.slice(1).reverse().concat(cur); }
        else continue;
        pool.splice(i, 1); grown = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

/* ---------- coastline → land polygons inside the bbox ----------
   OSM convention: land on the LEFT of the coastline direction. Work in
   math orientation (x east, y north = −z). Pieces that cross the bbox are
   closed by walking the bbox boundary counter-clockwise from each exit to
   the next entry. Closed rings inside the bbox are islands (land).         */
function osmCoastLand(chainsXZ, box) {
  const [x0, y0, x1, y1] = [box[0], -box[3], box[2], -box[1]]; // math y = −z
  const W = x1 - x0, H = y1 - y0, PER = 2 * (W + H);
  const toM = (p) => [p[0], -p[1]], toS = (p) => [p[0], -p[1]];
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const param = (p) => { // CCW perimeter parameter from the bottom-left corner
    const e = 1e-6;
    if (Math.abs(p[1] - y0) < e) return p[0] - x0;
    if (Math.abs(p[0] - x1) < e) return W + (p[1] - y0);
    if (Math.abs(p[1] - y1) < e) return W + H + (x1 - p[0]);
    return 2 * W + H + (y1 - p[1]);
  };
  const corners = [[x1, y0, W], [x1, y1, W + H], [x0, y1, 2 * W + H], [x0, y0, PER]];
  const clipSeg = (a, b) => { // Liang–Barsky → [t0,t1] or null
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p; if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [t0, t1];
  };
  const pieces = [], islands = [];
  for (const ch of chainsXZ) {
    const c = ch.map(toM);
    const closed = c.length > 3 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
    if (closed && c.every(inside)) { islands.push(c.slice(0, -1)); continue; }
    let cur = null;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i], b = c[i + 1], t = clipSeg(a, b);
      if (!t) { if (cur) { pieces.push(cur); cur = null; } continue; }
      const pa = [a[0] + (b[0] - a[0]) * t[0], a[1] + (b[1] - a[1]) * t[0]], pb = [a[0] + (b[0] - a[0]) * t[1], a[1] + (b[1] - a[1]) * t[1]];
      if (!cur) cur = { pts: [pa], entry: t[0] > 0 || !inside(a) ? param(pa) : null };
      cur.pts.push(pb);
      if (t[1] < 1) { cur.exit = param(pb); pieces.push(cur); cur = null; }
    }
    if (cur) pieces.push(cur);
  }
  const open = pieces.filter((p) => p.entry != null && p.exit != null);
  const rings = islands.slice(); const used = new Set();
  for (const start of open) {
    if (used.has(start)) continue;
    let ring = [...start.pts], cur = start; used.add(start); let guard = 0;
    while (guard++ < 1000) {
      // nearest entry CCW-ahead of cur.exit
      let best = null, bd = Infinity;
      for (const p of open) { let d = p.entry - cur.exit; if (d < 0) d += PER; if (d < bd) { bd = d; best = p; } }
      const cs = []; // bbox corners passed on the way, in walking order
      for (const [cx, cy, cp] of corners) { let d = cp % PER - cur.exit; if (d < 0) d += PER; if (d > 0 && d < bd) cs.push([d, cx, cy]); }
      cs.sort((a, b) => a[0] - b[0]); for (const c of cs) ring.push([c[1], c[2]]);
      if (!best || best === start) break;
      ring = ring.concat(best.pts); used.add(best); cur = best;
    }
    rings.push(ring);
  }
  return rings.map((r) => r.map(toS));
}

/* ---------- classification ---------- */
const OSM_ROAD_W = { motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9, residential: 7, unclassified: 7, living_street: 6, service: 4, pedestrian: 5,
  motorway_link: 7, trunk_link: 7, primary_link: 6, secondary_link: 6, tertiary_link: 6 };
const OSM_WATERWAY_W = { river: 20, canal: 15, stream: 4, drain: 3, ditch: 2 };
function osmNum(v) { const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : NaN; }
/** height (m) of a building from OSM tags; src = height | levels | estimated */
function osmHeight(t, areaM2) {
  const LV = 3.0, lv = osmNum(t['building:levels']);
  let base = osmNum(t.min_height); if (!(base >= 0)) { const ml = osmNum(t['building:min_level']); base = ml >= 0 ? ml * LV : 0; }
  const h = osmNum(t.height);
  if (h > 0) return { h: Math.max(h, base + 1), base, src: 'height', levels: lv > 0 ? lv : null };
  const ty = t.building || 'yes';
  if (lv > 0) {
    const resi = /^(apartments|residential|dormitory)$/.test(ty) && lv >= 4; // HDB-style: void deck + 2.8 m storeys (as in the estate model)
    return { h: base + (resi ? 3.6 + (lv - 1) * 2.8 : lv * LV), base, src: 'levels', levels: lv };
  }
  if (ty === 'roof' || ty === 'carport') return { h: 4.0, base: 3.4, src: 'estimated', levels: null };
  let est = 3;
  if (/^(house|detached|semidetached_house|terrace|bungalow)$/.test(ty) || (ty === 'residential' && areaM2 < 400)) est = 2;
  else if (/^(shed|garage|garages|hut|kiosk|toilets|cabin)$/.test(ty)) est = 1;
  else if (ty === 'construction') est = 2;
  else if (/^(industrial|warehouse)$/.test(ty)) est = 4;
  return { h: base + est * LV, base, src: 'estimated', levels: null };
}

/* ---------- main converter ---------- */
function osmConvert(elements, opts) {
  const P = osmProjector(opts.georef), ex = opts.exclude || null;
  const box = [P(opts.bbox[2], opts.bbox[1]), P(opts.bbox[0], opts.bbox[3])]; // NW, SE corners (lat,lon)
  const bbox = [box[0][0], box[0][1], box[1][0], box[1][1]]; // x0 (W), z0 (N), x1 (E), z1 (S)
  const geom = (g) => (g || []).filter((p) => p && Number.isFinite(p.lat)).map((p) => P(p.lat, p.lon));
  const out = { format: 'sembawang-area', version: OSMCONV_VERSION, source: { name: 'OpenStreetMap', attribution: '© OpenStreetMap contributors', licence: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', kind: opts.kind || 'snapshot', timestamp: opts.timestamp || null, bboxLatLon: opts.bbox },
    bbox, buildings: [], roads: [], waterways: [], water: [], parks: [], land: null, stats: {} };
  const st = { buildings: 0, excludedInEstate: 0, heightSrc: { height: 0, levels: 0, estimated: 0 }, roads: 0, roadsInEstate: 0, waterways: 0, water: 0, parks: 0, coastWays: 0, skipped: 0 };
  const coast = [];
  const ringsOf = (el) => {
    if (el.type === 'way') { const g = geom(el.geometry); return g.length >= 4 ? [g] : []; }
    if (el.type === 'relation') {
      const outer = (el.members || []).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => geom(m.geometry));
      return osmJoin(outer).filter((r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]);
    }
    return [];
  };
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') continue;
    if (t.building && t.building !== 'no') {
      for (const raw of ringsOf(el)) {
        const r = osmCleanRing(raw); if (!r) { st.skipped++; continue; }
        const c = osmCentroid(r);
        if (ex && osmInPoly(c[0], c[1], ex)) { st.excludedInEstate++; continue; }
        if (osmArea(r) < 0) r.reverse(); // store CCW in (x,z) = clockwise seen from above; renderer handles winding
        const a = Math.abs(osmArea(r)), H = osmHeight(t, a);
        const b = { id: el.type[0] + el.id, r: r.flat(), h: Math.round(H.h * 10) / 10, s: H.src[0] };
        if (H.base) b.b = Math.round(H.base * 10) / 10;
        if (H.levels) b.l = H.levels;
        if (t.building !== 'yes') b.t = t.building;
        if (t.name) b.n = t.name;
        if (t['addr:housenumber'] || t['addr:street']) b.a = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
        out.buildings.push(b); st.buildings++; st.heightSrc[H.src]++;
      }
      continue;
    }
    if (t.natural === 'coastline' && el.type === 'way') { coast.push(geom(el.geometry)); st.coastWays++; continue; }
    if (t.highway && OSM_ROAD_W[t.highway] && el.type === 'way') {
      const g = geom(el.geometry); if (g.length < 2) continue;
      if (ex) { const inn = g.filter((p) => osmInPoly(p[0], p[1], ex)).length; if (inn / g.length >= 0.5) { st.roadsInEstate++; continue; } }
      const w = osmNum(t.width) > 0 ? osmNum(t.width) : OSM_ROAD_W[t.highway] * (t.oneway === 'yes' && /primary|secondary|trunk|motorway/.test(t.highway) ? 0.6 : 1);
      const rd = { c: t.highway, w: Math.round(w * 10) / 10, p: osmSimplify(g, 0.4).flat() }; if (t.name) rd.n = t.name;
      out.roads.push(rd); st.roads++; continue;
    }
    if (t.waterway && OSM_WATERWAY_W[t.waterway] && el.type === 'way') {
      const g = geom(el.geometry); if (g.length < 2) continue;
      const ww = { c: t.waterway, w: osmNum(t.width) > 0 ? osmNum(t.width) : OSM_WATERWAY_W[t.waterway], p: osmSimplify(g, 0.4).flat() }; if (t.name) ww.n = t.name;
      out.waterways.push(ww); st.waterways++; continue;
    }
    if (t.natural === 'water' || t.leisure === 'park') {
      for (const raw of ringsOf(el)) {
        const r = osmCleanRing(raw, 0.5); if (!r) continue;
        const o = { id: el.type[0] + el.id, r: r.flat() }; if (t.name) o.n = t.name;
        if (t.natural === 'water') { out.water.push(o); st.water++; } else { out.parks.push(o); st.parks++; }
      }
    }
  }
  // ground extent: the query box grown to cover features that straddle it (Overpass returns whole ways), capped
  const ext = bbox.slice(), grow = (f) => { for (let i = 0; i < f.length; i += 2) { if (f[i] < ext[0]) ext[0] = f[i]; if (f[i + 1] < ext[1]) ext[1] = f[i + 1]; if (f[i] > ext[2]) ext[2] = f[i]; if (f[i + 1] > ext[3]) ext[3] = f[i + 1]; } };
  for (const k of ['buildings', 'water', 'parks']) for (const o of out[k]) grow(o.r);
  for (const k of ['roads', 'waterways']) for (const o of out[k]) grow(o.p);
  out.ext = [Math.max(ext[0], bbox[0] - EXT_CAP), Math.max(ext[1], bbox[1] - EXT_CAP), Math.min(ext[2], bbox[2] + EXT_CAP), Math.min(ext[3], bbox[3] + EXT_CAP)].map(Math.round);
  if (coast.length) {
    const chains = osmJoin(coast, false);
    // land on the ground extent — unless a coastline ends inside it (shore missing there): then only the query box
    const [ex0, ez0, ex1, ez1] = out.ext, inExt = (p) => p[0] > ex0 && p[0] < ex1 && p[1] > ez0 && p[1] < ez1;
    const ok = chains.every((c) => (c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) || (!inExt(c[0]) && !inExt(c[c.length - 1])));
    if (!ok) out.ext = bbox.map(Math.round);
    out.land = osmCoastLand(chains, out.ext).map((r) => r.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]).flat());
  }
  out.stats = st;
  return out;
}
/** GeoJSON (overpass-turbo export) → Overpass-style elements, for the snapshot build and tests */
function osmFromGeoJSON(fc) {
  const els = [];
  for (const f of fc.features || []) {
    const id = String((f.properties && f.properties['@id']) || f.id || ''); const m = /^(way|relation|node)\/(\d+)$/.exec(id);
    if (!m) continue;
    const tags = {}; for (const [k, v] of Object.entries(f.properties || {})) if (!k.startsWith('@') && !(m[1] === 'relation' && k === 'type')) tags[k] = v;
    if (m[1] === 'relation') tags.type = 'multipolygon';
    const g = f.geometry; if (!g) continue;
    const toG = (ring) => ring.map(([lon, lat]) => ({ lat, lon }));
    if (m[1] === 'way') {
      if (g.type === 'LineString') els.push({ type: 'way', id: +m[2], tags, geometry: toG(g.coordinates) });
      else if (g.type === 'Polygon') els.push({ type: 'way', id: +m[2], tags, geometry: toG(g.coordinates[0]) });
    } else if (m[1] === 'relation') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const members = []; polys.forEach((poly) => poly.forEach((ring, i) => members.push({ type: 'way', ref: 0, role: i === 0 ? 'outer' : 'inner', geometry: toG(ring) })));
      els.push({ type: 'relation', id: +m[2], tags, members });
    }
  }
  return els;
}
