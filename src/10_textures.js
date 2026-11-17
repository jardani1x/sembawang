/* =====================================================================
   10 TEXTURES + MATERIALS — procedural canvas textures (no image assets)
   Facade textures hold 4 bays × 4 storeys (the 4-storey band rhythm
   measured on the model). Colours white-balanced from the photos.
   ===================================================================== */

const PAL = {
  white: '#EEECE7', charcoal: '#4A4946', darkInfill: '#2E2E2E', glass: '#6F7E92', glassDark: '#3E4756',
  gridWhite: '#EDEBE6', roof: '#B6B1A9', tank: '#D2D2D0', turf: '#7C8F2F', roofLawn: '#707C25',
  canal: '#A6CFD9', asphalt: '#8A8784', kerb: '#D9D6D0', drive: '#5A5755', playground: '#5E9BD0',
  linkRoof: '#7E7E7A', mscpWhite: '#E4E2DC', mscpCore: '#2B2B2A',
};
const PX_STOREY = 128, PX_BAY = 128;

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 8;
  return t;
}

/* Scheme A — "light cells" (east towers, 2-Room Flexi links, 438A east).
   White-dominant: ~60% white, light blue-grey glass, small dark windows. */
function drawSchemeA(g, w, h) {
  const rnd = mulberry32(11);
  g.fillStyle = PAL.white; g.fillRect(0, 0, w, h);
  for (let s = 0; s < 4; s++) {
    const top = s * PX_STOREY;
    for (let b = 0; b < 4; b++) {
      const x = b * PX_BAY, flip = (s + b) % 2 === 1;
      const gx = flip ? x + 14 : x + 66;
      const grad = g.createLinearGradient(0, top + 26, 0, top + 100);
      grad.addColorStop(0, '#A3B0C0'); grad.addColorStop(1, '#8091A6');
      g.fillStyle = grad; g.fillRect(gx, top + 26, 46, 72);
      const wx = flip ? x + 80 : x + 20;
      g.fillStyle = '#4E545C'; g.fillRect(wx, top + 44, 28, 40);
      g.fillStyle = '#E6E4DF'; g.fillRect(wx + 13, top + 44, 2, 40); g.fillRect(wx, top + 62, 28, 2);
      const lx = flip ? x + 10 : x + 62, lw = 54;
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(lx, top + 108, lw, 5);
      g.fillStyle = '#FAF9F6'; g.fillRect(lx, top + 98, lw, 11);
      if (rnd() < 0.3) { g.fillStyle = '#7C9A55'; g.fillRect(lx + 8, top + 93, lw - 16, 5); }
      g.fillStyle = PAL.charcoal; g.fillRect(x, top, 3, PX_STOREY);
    }
    g.fillStyle = PAL.charcoal; g.fillRect(0, top, w, 4);
  }
  g.fillStyle = PAL.charcoal; g.fillRect(0, 0, w, 12);
}

/* Scheme B — "dark glass grid" (west towers, 438A west) */
function drawSchemeB(g, w, h) {
  const rnd = mulberry32(7);
  g.fillStyle = PAL.darkInfill; g.fillRect(0, 0, w, h);
  for (let s = 0; s < 4; s++) {
    const top = s * PX_STOREY;
    for (let b = 0; b < 4; b++) {
      const x = b * PX_BAY;
      for (let k = 0; k < 2; k++) {
        const light = rnd() < 0.25;
        g.fillStyle = light ? PAL.glass : PAL.glassDark;
        g.fillRect(x + 14 + k * 54, top + 16, 46, 92);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 14 + k * 54, top + 16, 46, 10);
      }
      g.fillStyle = '#59595A'; g.fillRect(x, top + PX_STOREY - 5, PX_BAY, 3); // thin sill
      g.fillStyle = PAL.gridWhite; g.fillRect(x, top, 8, PX_STOREY);        // white mullion
    }
  }
  g.fillStyle = PAL.gridWhite; g.fillRect(0, 0, w, 13);                    // white band / 4 storeys
}

/* End walls: white with a column of small square windows per storey */
function drawEnd(g, w, h) {
  g.fillStyle = PAL.white; g.fillRect(0, 0, w, h);
  for (let s = 0; s < 4; s++) {
    const top = s * PX_STOREY;
    g.fillStyle = '#C9C6BF'; g.fillRect(0, top, w, 2);
    g.fillStyle = '#4A4E55'; g.fillRect(w * 0.5 - 16, top + 44, 32, 32);
    g.fillStyle = '#4A4E55'; g.fillRect(w * 0.15 - 12, top + 50, 24, 24);
  }
}
/* Lift core strip: white panels + dark slot with stacked small openings */
function drawCore(g, w, h) {
  g.fillStyle = PAL.white; g.fillRect(0, 0, w, h);
  g.fillStyle = '#D6D3CC'; for (let x = 0; x < w; x += 40) g.fillRect(x, 0, 2, h);
  const sx = w * 0.36, sw = w * 0.28;
  g.fillStyle = PAL.mscpCore; g.fillRect(sx, 0, sw, h);
  for (let s = 0; s < 4; s++) { g.fillStyle = '#6C6F73'; g.fillRect(sx + sw * 0.25, s * PX_STOREY + 40, sw * 0.5, 30); }
}
/* Corridor / air-well band: dark recess with white corridor slabs each storey */
function drawBand(g, w, h) {
  g.fillStyle = '#3A3A39'; g.fillRect(0, 0, w, h);
  for (let s = 0; s < 4; s++) { g.fillStyle = '#E9E7E2'; g.fillRect(0, s * PX_STOREY + PX_STOREY - 22, w, 22); }
}
/* MSCP: white spandrel bands + dark openings, split-level (half-deck shift) */
function drawMSCP(g, w, h) {
  g.fillStyle = '#2F2F2E'; g.fillRect(0, 0, w, h);
  const deck = h / 2;                     // canvas holds 2 decks (6 m), 16 m wide
  for (let half = 0; half < 2; half++) {
    const x0 = half * w / 2, shift = half ? deck / 2 : 0;
    for (let k = -1; k < 3; k++) {
      const y = k * deck + shift;
      g.fillStyle = PAL.mscpWhite; g.fillRect(x0, y, w / 2, deck * 0.34);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y + deck * 0.34, w / 2, 4);
    }
  }
  g.fillStyle = '#F2F1EE'; g.fillRect(0, 0, 8, h); g.fillRect(w / 2 - 4, 0, 8, h);
}
function drawDrum(g, w, h) {
  for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#8A8A86' : '#4A4A48'; g.fillRect(x, 0, 16, h); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
}
function drawShop(g, w, h) {
  g.fillStyle = PAL.white; g.fillRect(0, 0, w, h);
  g.fillStyle = '#4C5560'; g.fillRect(0, h * 0.55, w, h * 0.38);
  g.fillStyle = '#9DB0BF'; for (let x = 6; x < w; x += 32) g.fillRect(x, h * 0.58, 22, h * 0.32);
  g.fillStyle = '#4C5560'; g.fillRect(0, h * 0.08, w, h * 0.2);
}
function drawNoise(base, amp, seed) {
  return (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const r = mulberry32(seed), img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
  };
}

const TEX = {};
function makeTextures(maxAniso) {
  const a = Math.min(8, maxAniso || 4);
  TEX.facA = canvasTex(4 * PX_BAY, 4 * PX_STOREY, drawSchemeA, { aniso: a });
  TEX.facB = canvasTex(4 * PX_BAY, 4 * PX_STOREY, drawSchemeB, { aniso: a });
  TEX.end = canvasTex(256, 4 * PX_STOREY, drawEnd, { aniso: a });
  TEX.core = canvasTex(256, 4 * PX_STOREY, drawCore, { aniso: a });
  TEX.band = canvasTex(128, 4 * PX_STOREY, drawBand, { aniso: a });
  TEX.mscp = canvasTex(512, 256, drawMSCP, { aniso: a });
  TEX.drum = canvasTex(256, 64, drawDrum, { aniso: a });
  TEX.shop = canvasTex(256, 128, drawShop, { aniso: a });
  TEX.grass = canvasTex(256, 256, drawNoise('#86964F', 18, 3), { aniso: a });
  TEX.asphalt = canvasTex(128, 128, drawNoise(PAL.asphalt, 14, 5), { aniso: a });
}

/* Base materials, cloned per building so filters can dim one building. */
function stdMat(o) { return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o }); }
const BASE_MATS = {};
function makeBaseMaterials() {
  Object.assign(BASE_MATS, {
    facA: stdMat({ map: TEX.facA }), facB: stdMat({ map: TEX.facB, roughness: 0.6 }),
    end: stdMat({ map: TEX.end }), core: stdMat({ map: TEX.core }), band: stdMat({ map: TEX.band }),
    frameDark: stdMat({ color: PAL.charcoal }), frameWhite: stdMat({ color: PAL.gridWhite }),
    roof: stdMat({ color: PAL.roof }), roofDark: stdMat({ color: '#8E8A84' }),
    voidDeck: stdMat({ color: '#45464A' }), soffit: stdMat({ color: '#D8D6D0' }), column: stdMat({ color: '#E8E6E1' }),
    mscp: stdMat({ map: TEX.mscp }), mscpCore: stdMat({ color: PAL.mscpCore }), drum: stdMat({ map: TEX.drum }),
    lowRoof: stdMat({ color: '#6E6E6B' }), shop: stdMat({ map: TEX.shop }), ess: stdMat({ color: '#B9B7B1' }),
  });
}
const matCache = new Map();
/** material for building `owner` and key `k` (cloned once per owner) */
function matFor(owner, k) {
  const id = owner + '|' + k;
  if (!matCache.has(id)) { const m = BASE_MATS[k].clone(); m.userData.base = { color: m.color.clone() }; matCache.set(id, m); }
  return matCache.get(id);
}
/** dim (true) or restore (false) every material of one building */
function setOwnerDim(owner, dim) {
  for (const [id, m] of matCache) {
    if (!id.startsWith(owner + '|')) continue;
    m.transparent = dim; m.opacity = dim ? 0.28 : 1; m.depthWrite = !dim; m.needsUpdate = true;
  }
}
