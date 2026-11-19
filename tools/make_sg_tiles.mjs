#!/usr/bin/env node
/* Offline fixture for the Singapore map tests.
   Turns the committed OpenStreetMap snapshot (data/area-snapshot.json, Sembawang only) into
   OpenMapTiles-shaped vector tiles (layers building / water / park / transportation, with
   render_height / render_min_height / hide_3d) so the page can be tested without reaching
   tiles.openfreemap.org. Needs vendor/tiletools (tools/fetch_three.sh installs it).

     node tools/make_sg_tiles.mjs [outDir]      # default tests/fixtures/sg-tiles (git-ignored)
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'vendor', 'tiletools', 'node_modules');
const geojsonvt = (await import(path.join(TOOLS, 'geojson-vt', 'src', 'index.js'))).default;
const vtpbf = createRequire(path.join(TOOLS, 'x.js'))('vt-pbf');

const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tests', 'fixtures', 'sg-tiles'));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site-data.json'), 'utf8'));
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'area-snapshot.json'), 'utf8'));

/* site frame (x east, z south, metres) -> [lon, lat]; exact inverse of osmProjector in src/75_osmconv.js */
const g = site.georef, r = Math.PI / 180;
const kx = r * g.N * Math.cos(g.lat0 * r), kz = r * g.M;
const c = Math.cos(g.theta || 0), s = Math.sin(g.theta || 0), sc = g.scale || 1;
const toLonLat = (X, Z) => {
  const x = sc * (c * X - s * Z), z = sc * (s * X + c * Z);
  return [g.lon0 + (x + g.tx) / kx, g.lat0 - (z + g.tz) / kz];
};
const ring = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(toLonLat(flat[i], flat[i + 1]));
  out.push(out[0]);
  return out;
};
const line = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push(toLonLat(flat[i], flat[i + 1])); return out; };
const fc = (features) => ({ type: 'FeatureCollection', features });

let hidden = 0;
const buildings = fc(snap.buildings.map((b, i) => {
  const props = { render_height: b.h, render_min_height: 0 };
  if (i % 997 === 0) { props.hide_3d = true; hidden++; } // a few, to exercise the hide_3d filter
  return { type: 'Feature', id: i + 1, properties: props, geometry: { type: 'Polygon', coordinates: [ring(b.r)] } };
}));
const water = fc(snap.water.map((w) => ({ type: 'Feature', properties: { class: 'lake' }, geometry: { type: 'Polygon', coordinates: [ring(w.r)] } })));
const parks = fc(snap.parks.map((p) => ({ type: 'Feature', properties: { class: 'park' }, geometry: { type: 'Polygon', coordinates: [ring(p.r)] } })));
const roads = fc(snap.roads.map((rd) => ({ type: 'Feature', properties: { class: rd.c }, geometry: { type: 'LineString', coordinates: line(rd.p) } })));

const opts = { maxZoom: 14, indexMaxZoom: 14, indexMaxPoints: 0, extent: 4096, buffer: 64, tolerance: 2 };
const idx = { building: geojsonvt(buildings, opts), water: geojsonvt(water, opts), park: geojsonvt(parks, opts), transportation: geojsonvt(roads, opts) };

/* every tile z8..14 that touches the snapshot box */
const [S, W, N, E] = snap.source.bboxLatLon;
const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * 2 ** z);
fs.rmSync(OUT, { recursive: true, force: true });
let n = 0, bytes = 0;
for (let z = 8; z <= 14; z++) {
  for (let x = tileX(W, z); x <= tileX(E, z); x++) {
    for (let y = tileY(N, z); y <= tileY(S, z); y++) {
      const layers = {};
      for (const [name, index] of Object.entries(idx)) { const t = index.getTile(z, x, y); if (t && t.features.length) layers[name] = t; }
      if (!Object.keys(layers).length) continue;
      const buf = vtpbf.fromGeojsonVt(layers, { version: 2 });
      const f = path.join(OUT, String(z), String(x), `${y}.pbf`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf);
      n++; bytes += buf.length;
    }
  }
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ tiles: n, bytes, buildings: snap.buildings.length, hidden, bboxLatLon: snap.source.bboxLatLon }, null, 1));
console.log(`sg fixture: ${n} tiles, ${(bytes / 1024).toFixed(0)} KiB, ${snap.buildings.length} buildings (${hidden} hide_3d) -> ${path.relative(ROOT, OUT)}`);
