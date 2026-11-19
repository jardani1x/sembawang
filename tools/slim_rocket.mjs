// Slims a downloaded glTF rocket for the Singapore map's location pin (assets/starship-block3.glb).
// Source: "SpaceX Starship Block 3" by Clarence365, https://sketchfab.com/3d-models/spacex-starship-block-3-6f6c6f88a3eb4b4d822fdca66733fbb2 (CC BY 4.0).
// Needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer  (in a scratch folder)
// usage: STRIP=1 node slim_rocket.mjs in.glb assets/starship-block3.glb 0.04 0.001
//   STRIP=1 drops the fine weathering (metal/roughness) texture and unused UVs; ratio / error feed meshopt's simplifier.
//   0.001 keeps the hot-stage ring between ship and booster; 0.002 and coarser lose it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, quantize, meshopt, reorder, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
const [, , IN, OUT, RATIO = '0.06', ERR = '0.002'] = process.argv;
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();
const tris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const before = { tris: tris(), meshes: root.listMeshes().length, prims: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0), bounds: getBounds(root.listScenes()[0]) };
// the SpaceX logo decal is a trademark, not part of the CC-BY licence: drop that one decal
let logo = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) if (p.getMaterial() && p.getMaterial().getName() === 'Logo') { p.dispose(); logo++; }
if (process.env.STRIP) { // map-size use: drop the fine weathering (metal/roughness) texture and UVs nobody can see at map scale
  for (const mat of root.listMaterials()) { if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); mat.setRoughnessFactor(Math.min(mat.getRoughnessFactor(), 0.45)); } }
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const mat = p.getMaterial(); if (!mat || !mat.getBaseColorTexture()) for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD')) p.setAttribute(sem, null); }
}
await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: +RATIO, error: +ERR }), prune());
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
const a = root.getAsset();
a.extras = { ...(a.extras || {}), modifications: `Adapted for the Sembawang Brook Singapore map: logo decal removed, meshes merged and simplified to about ${Math.round(100 * tris() / before.tris)}% of the triangles (glTF-Transform + meshoptimizer).` };
await io.write(OUT, doc);
const after = { tris: tris(), meshes: root.listMeshes().length, prims: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0), bounds: getBounds(root.listScenes()[0]), materials: root.listMaterials().length, textures: root.listTextures().length };
console.log(JSON.stringify({ before, logoPrimsRemoved: logo, after }, null, 1));
