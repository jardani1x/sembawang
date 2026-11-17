#!/usr/bin/env node
// Build data/area-snapshot.json from one or more overpass-turbo GeoJSON exports, using the SAME
// converter the page uses for live updates (src/75_osmconv.js).
//   node tools/build_area.mjs export.geojson [coastline.geojson ...] [S,W,N,E]
// Several exports are merged (a feature that appears in more than one is kept once), so a separate
// coastline export can be added to the main one. The optional bbox is the query box of the exports.
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({});
const C = vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', '75_osmconv.js'), 'utf8') + '\n;({ osmConvert, osmFromGeoJSON, OSM_BBOX, OSMCONV_VERSION })', ctx);

const BBOX_RE = /^\s*-?\d+(\.\d+)?(\s*,\s*-?\d+(\.\d+)?){3}\s*$/;
const args = process.argv.slice(2);
const inputs = args.filter((a) => !BBOX_RE.test(a));
const bboxArg = args.find((a) => BBOX_RE.test(a));
if (!inputs.length) { console.error('usage: node tools/build_area.mjs export.geojson [more.geojson ...] [S,W,N,E]'); process.exit(2); }

const seen = new Set(), features = [], stamps = [];
for (const file of inputs) {
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) { console.error(file + ': not a GeoJSON FeatureCollection'); process.exit(1); }
  if (fc.timestamp) stamps.push(fc.timestamp);
  let added = 0;
  for (const f of fc.features) {
    const id = String((f.properties && f.properties['@id']) || f.id || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    features.push(f); added++;
  }
  console.log(`${file}: ${fc.features.length} features, ${added} new`);
}
// the snapshot is dated by its OLDEST export: every feature is at least that recent
const timestamp = stamps.length ? stamps.sort()[0] : null;

const georef = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source', 'georef.json'), 'utf8'));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site-data.json'), 'utf8'));
const bbox = bboxArg ? bboxArg.split(',').map(Number) : [1.430, 103.795, 1.475, 103.845]; // the main export's query box
const out = C.osmConvert(C.osmFromGeoJSON({ type: 'FeatureCollection', features }), { georef, exclude: site.boundary, bbox, kind: 'snapshot', timestamp });
const file = path.join(ROOT, 'data', 'area-snapshot.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify(out.stats), '\nland polygons', out.land ? out.land.length : 0, '\nbbox (site m)', out.bbox, '\ndata as of', timestamp, '\nwrote', file, fs.statSync(file).size, 'bytes');
