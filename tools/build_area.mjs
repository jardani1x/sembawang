#!/usr/bin/env node
// Build data/area-snapshot.json from an overpass-turbo GeoJSON export, using the SAME converter
// the page uses for live updates (src/75_osmconv.js).
//   node tools/build_area.mjs export.geojson [S,W,N,E]
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({});
const C = vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', '75_osmconv.js'), 'utf8') + '\n;({ osmConvert, osmFromGeoJSON, OSM_BBOX, OSMCONV_VERSION })', ctx);
const [input, bboxArg] = process.argv.slice(2);
if (!input) { console.error('usage: node tools/build_area.mjs export.geojson [S,W,N,E]'); process.exit(2); }
const fc = JSON.parse(fs.readFileSync(input, 'utf8'));
const georef = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source', 'georef.json'), 'utf8'));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site-data.json'), 'utf8'));
const bbox = bboxArg ? bboxArg.split(',').map(Number) : [1.430, 103.795, 1.475, 103.845]; // the export's query box
const out = C.osmConvert(C.osmFromGeoJSON(fc), { georef, exclude: site.boundary, bbox, kind: 'snapshot', timestamp: fc.timestamp || null });
const file = path.join(ROOT, 'data', 'area-snapshot.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(JSON.stringify(out.stats), '\nbbox (site m)', out.bbox, '\nwrote', file, fs.statSync(file).size, 'bytes');
