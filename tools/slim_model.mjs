// Slims downloaded glTF models for the Singapore map's 3D location pins (assets/*.glb).
// Needs (in a scratch folder): npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp@0.33
//
// Starship: "SpaceX Starship Block 3" by Clarence365,
//   https://sketchfab.com/3d-models/spacex-starship-block-3-6f6c6f88a3eb4b4d822fdca66733fbb2 (CC BY 4.0)
//   node slim_model.mjs starship in.glb assets/starship-block3.glb
//   Drops the logo decal (a trademark, not covered by the licence), the fine weathering (metal/roughness) texture
//   and unused UVs, then merges and simplifies (meshopt, ratio 0.04, error 0.001: coarser loses the hot-stage ring).
// F-22: supplied by the project owner (source in the README).
//   node slim_model.mjs f22 in.glb assets/f22-raptor.glb
//   Drops the normal and metal/roughness maps (invisible at map size); texture -> 512 px WebP; merges. (Already gear-up.)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, quantize, meshopt, reorder, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [, , MODE, IN, OUT] = process.argv;
if (!['starship', 'f22'].includes(MODE) || !IN || !OUT) { console.error('usage: node slim_model.mjs starship|f22 in.glb out.glb'); process.exit(2); }
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();
const tris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const before = tris();
let note;
if (MODE === 'starship') {
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) if (p.getMaterial() && p.getMaterial().getName() === 'Logo') p.dispose();
  for (const mat of root.listMaterials()) if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); mat.setRoughnessFactor(Math.min(mat.getRoughnessFactor(), 0.45)); }
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const mat = p.getMaterial();
    if (!mat || !mat.getBaseColorTexture()) for (const sem of p.listSemantics()) if (sem.startsWith('TEXCOORD')) p.setAttribute(sem, null);
  }
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.04, error: 0.001 }), prune());
  note = 'logo decal removed, meshes merged and simplified';
} else {
  const sharp = (await import('sharp')).default;
  for (const mat of root.listMaterials()) {
    if (mat.getNormalTexture()) mat.setNormalTexture(null);
    if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); mat.setMetallicFactor(0.25); mat.setRoughnessFactor(0.55); }
  }
  await doc.transform(prune(), dedup(), flatten(), join({ keepNamed: false }), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }));
  note = 'normal and metal/roughness maps dropped, texture resized to 512 px WebP, meshes merged';
}
await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
const a = root.getAsset();
a.extras = { ...(a.extras || {}), modifications: `Adapted for the Sembawang Brook Singapore map: ${note}; ${Math.round(100 * tris() / before)}% of the original triangles (glTF-Transform + meshoptimizer).` };
await io.write(OUT, doc);
console.error(JSON.stringify({ mode: MODE, trianglesBefore: before, trianglesAfter: tris(), bounds: getBounds(root.listScenes()[0]) }));
