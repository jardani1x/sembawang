/* =====================================================================
   60 UI — selection + info panel, search, filters, layers, storey,
   my flat (+ sun hours), heights, sun bar, menu, keyboard, mobile
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FACE_TXT = (f) => `${bearingName(FACE_BEARING(f))} (${Math.round(FACE_BEARING(f))}°)`;
const typeName = (t) => (SITE.flatTypes[t] || { name: t }).name;
const swatch = (t) => `<i class="sw" style="background:rgb(${(SITE.flatTypes[t] || { rgb: [200, 200, 200] }).rgb.join(',')})"></i>`;
const tag = (s) => `<span class="tag">${esc(s)}</span>`;

/* ---------- layers ---------- */
function setCssVisible(obj, v) { obj.traverse((o) => { if (o.isCSS2DObject) o.visible = v; }); }
function applyLayers() {
  const Ly = state.settings.layers;
  G.roads.visible = Ly.roads; G.canal.visible = Ly.canal; G.context.visible = Ly.context;
  const cp = G.ground.getObjectByName('canalPatch'); if (cp) cp.visible = !Ly.canal;
  G.linkways.visible = Ly.linkways; G.landscape.visible = Ly.landscape;
  G.facilities.visible = Ly.facilities; setCssVisible(G.facilities, Ly.facilities);
  for (const o of REG.labels) o.visible = Ly.labels;
  G.sunPath.visible = Ly.sunPath; setCssVisible(G.sunPath, Ly.sunPath);
  renderer.shadowMap.enabled = Ly.shadows; sun.castShadow = Ly.shadows && (lastSun ? lastSun.el > 0 : true);
  scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
  applyArea();
}

/* ---------- selection + info panel ---------- */
function select(sel, opts = {}) {
  state.selection = sel;
  buildSelection(); renderInfo();
  $$('.blist button').forEach((b) => b.classList.toggle('on', !!sel && sel.kind === 'building' && b.dataset.id === sel.id));
  $$('#labels .lbl').forEach((el) => el.classList.toggle('on', !!sel && sel.kind === 'building' && el.dataset.owner === sel.id));
  if (sel && opts.fly) {
    if (sel.kind === 'building') focusAnchor(REG.anchors.get(sel.id));
    else if (sel.kind === 'osm') areaFocus(sel.bi);
    else if (sel.kind === 'facility' && sel.f) flyTo(new THREE.Vector3(sel.f.x + 60, 60, sel.f.z + 60), new THREE.Vector3(sel.f.x, 0, sel.f.z), 50);
  }
  document.body.classList.toggle('has-sel', !!sel);
}
function infoBuilding(id, sel) {
  const b = blockById(id);
  if (b && b.kind === 'sale') {
    const top = roofY(b.storeys), stacks = UNITS.stacks.get(b.id);
    const mixRows = Object.entries(b.mix).map(([t, n]) => `<tr><td>${swatch(t)}${esc(typeName(t))}</td><td class="n">${n}</td><td class="n">${n / (b.storeys - 1)}</td></tr>`).join('');
    const stackRows = stacks.map((s) => `<tr data-unit="${s.unit}" class="${sel.stack && sel.stack.unit === s.unit ? 'on' : ''}"><td>#${s.unit}</td><td>${swatch(s.type)}${esc(SITE.flatTypes[s.type].short)}</td><td>${FACE_TXT(s.face)}</td><td>${s.part === 'link' ? 'link' : s.tower === 'W' ? 'west tower' : 'east tower'}</td></tr>`).join('');
    let stackCard = '';
    if (sel.stack) {
      const s = sel.stack, st = sel.storeyHint && sel.storeyHint >= 2 ? sel.storeyHint : null;
      stackCard = `<div class="card accent"><b>Stack #${s.unit}</b> · ${esc(typeName(s.type))}<br>Faces ${FACE_TXT(s.face)} · storeys 2–${b.storeys}${st ? `<br>You tapped ≈ storey ${st} <small>(from the assumed storey heights)</small>` : ''}
        <div class="row"><button class="btn sm" data-act="mine" data-unit="${s.unit}" data-storey="${st || ''}">Set as my flat${st ? ` (storey ${st})` : ''}</button><button class="btn sm ghost" data-act="clearstack">Clear stack</button></div></div>`;
    }
    return `<h2>Blk ${esc(b.id)}</h2><p class="sub">${b.storeys} storeys · ${b.total} flats for sale · ${b.unitsPerFloor} per floor</p>
      ${stackCard}
      <dl class="kv"><dt>Storeys</dt><dd>${b.storeys} ${tag('Read')}</dd>
      <dt>Flats on</dt><dd>storeys 2–${b.storeys}; storey 1 is the void deck ${tag('Derived')}</dd>
      <dt>Roof level</dt><dd>≈ ${fmt(top)} m ${tag('Estimated')}</dd>
      <dt>Facades</dt><dd>west tower dark glass grid · east tower light cells ${tag('Model photos')}</dd></dl>
      <h3>Flat mix <small>(brochure table)</small></h3>
      <table class="t"><thead><tr><th>Type</th><th class="n">Flats</th><th class="n">Stacks</th></tr></thead><tbody>${mixRows}</tbody></table>
      <h3>Stacks <small>tap one to highlight it</small></h3>
      <table class="t click" id="stackTable"><thead><tr><th>Unit</th><th>Type</th><th>Faces</th><th>Where</th></tr></thead><tbody>${stackRows}</tbody></table>
      ${b.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
      <div class="row"><button class="btn" data-act="focus">Focus</button><button class="btn ghost" data-act="colour">${state.settings.colourByType ? 'Hide' : 'Show'} flat-type colours</button></div>`;
  }
  if (b) { // 438A rental
    return `<h2>Blk ${esc(b.id)}</h2><p class="sub">${b.storeys} storeys · ${b.total} rental flats · ${b.unitsPerFloor} per floor</p>
      <dl class="kv"><dt>Flats</dt><dd>100 × 1-Room, 100 × 2-Room (rental) ${tag('Read')}</dd>
      <dt>Flats on</dt><dd>storeys 2–${b.storeys} ${tag('Derived')}</dd><dt>Roof level</dt><dd>≈ ${fmt(roofY(b.storeys))} m ${tag('Estimated')}</dd>
      <dt>Form</dt><dd>two point towers joined by a lift core; west tower dark grid, east tower light cells</dd></dl>
      ${b.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}<div class="row"><button class="btn" data-act="focus">Focus</button></div>`;
  }
  if (id === '436') {
    const m = SITE.mscp;
    return `<h2>Blk 436</h2><p class="sub">8-storey multi-storey car park with accessible roof garden</p>
      <dl class="kv"><dt>1st storey</dt><dd>${esc(m.uses['1'])} ${tag('Read')}</dd><dt>2nd storey</dt><dd>${esc(m.uses['2'])} ${tag('Read')}</dd>
      <dt>Roof garden</dt><dd>lawn, community garden plots, children's playground, shelters, elderly fitness station ${tag('Model photo')}</dd>
      <dt>Size</dt><dd>west wing ≈ ${fmt(m.westWing.u1 - m.westWing.u0, 0)} × ${fmt(m.westWing.v1 - m.westWing.v0, 0)} m; spiral ramp Ø ≈ ${fmt(m.ramp.r * 2, 0)} m ${tag('Measured')}</dd>
      <dt>Height</dt><dd>≈ ${m.height} m ${tag('Estimated')}</dd></dl>
      ${m.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}<div class="row"><button class="btn" data-act="focus">Focus</button><button class="btn ghost" data-act="preset" data-id="roof436">Roof-garden view</button></div>`;
  }
  const lr = SITE.lowRise.find((x) => x.id === id);
  if (lr) return `<h2>${lr.id === 'porch' ? 'Drop-off porch' : 'Blk ' + esc(lr.id)}</h2><p class="sub">${esc(lr.use)}</p>
      <dl class="kv"><dt>Footprint</dt><dd>≈ ${fmt(lr.lu, 0)} × ${fmt(lr.lv, 0)} m ${tag('Measured')}</dd><dt>Height</dt><dd>≈ ${lr.height} m, 1 storey ${tag('Estimated')}</dd></dl>
      <div class="row"><button class="btn" data-act="focus">Focus</button></div>`;
  if (id === '440') return `<h2>Blk 440</h2><p class="sub">${esc(SITE.commercial440.use)}</p><dl class="kv"><dt>Height</dt><dd>≈ ${SITE.commercial440.height} m ${tag('Estimated')}</dd><dt>Note</dt><dd>${esc(SITE.commercial440.heightConf)}; marker digits on the plan are illegible ${tag('Unverified')}</dd></dl><div class="row"><button class="btn" data-act="focus">Focus</button></div>`;
  if (id === '441') return `<h2>Blk 441</h2><p class="sub">${esc(SITE.ess441.use)}</p><dl class="kv"><dt>Height</dt><dd>≈ ${SITE.ess441.height} m ${tag('Estimated')}</dd></dl><div class="row"><button class="btn" data-act="focus">Focus</button></div>`;
  return `<h2>${esc(id)}</h2>`;
}
function renderInfo() {
  const sel = state.selection, el = $('#infoBody');
  if (!sel) { el.innerHTML = '<p class="muted">Tap a block, a facility pin, a road or a reserved site to see details.</p>'; return; }
  let html = '';
  if (sel.kind === 'building') html = infoBuilding(sel.id, sel);
  else if (sel.kind === 'facility') { const f = sel.f; html = `<h2>${esc(f.name[0].toUpperCase() + f.name.slice(1))}</h2><p class="sub">${esc(f.where)}</p><dl class="kv"><dt>Source</dt><dd>${esc(f.conf)}</dd><dt>Note</dt><dd>Props in the 3D view are representative, not surveyed.</dd></dl>`; }
  else if (sel.kind === 'road') { const r = SITE.roads.find((x) => x.name === sel.id); html = `<h2>${esc(r.name)}</h2><p class="sub">${r.status === 'future' ? 'Future road' : r.status === 'existing' ? 'Existing road' : 'Status not stated'}</p><dl class="kv"><dt>Width</dt><dd>≈ ${r.width} m ${tag('Measured/inferred')}</dd><dt>Source</dt><dd>${esc(r.conf)}</dd></dl>`; }
  else if (sel.kind === 'osm' && AREA.status === 'ready') html = areaInfoHTML(sel.bi);
  else if (sel.kind === 'reserved') html = `<h2>${esc(sel.id)}</h2><p class="sub">Neighbouring / reserved site (context only)</p><p class="note">Shown as a flat labelled plot. Any future buildings here are not modelled, so views and sun hours could change when they are built.</p>`;
  el.innerHTML = html;
  $('#info').classList.add('open');
}
$('#infoBody').addEventListener('click', (e) => {
  const tr = e.target.closest('#stackTable tbody tr');
  if (tr) { const info = UNITS.idx.get(tr.dataset.unit); select({ ...state.selection, stack: info, storeyHint: null }); return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const sel = state.selection, act = btn.dataset.act;
  if (act === 'focus' && sel) focusAnchor(REG.anchors.get(sel.id));
  else if (act === 'colour') { state.settings.colourByType = !state.settings.colourByType; syncControls(); updateTypeOverlay(); saveSettings(); renderInfo(); }
  else if (act === 'preset') goPreset(btn.dataset.id);
  else if (act === 'clearstack') select({ ...sel, stack: null, storeyHint: null });
  else if (act === 'mine') {
    const info = UNITS.idx.get(btn.dataset.unit);
    $('#muBlock').value = info.block; fillUnitOptions(); $('#muUnit').value = info.unit;
    const st = parseInt(btn.dataset.storey, 10); if (st) $('#muStorey').value = st;
    openLeft('mine'); $('#muStorey').focus();
  }
});
$('#infoClose').addEventListener('click', () => { $('#info').classList.remove('open'); select(null); });

/* ---------- search (blocks, unit numbers, flat types, facilities, roads, reserved sites) ---------- */
let SEARCH = [];
const norm = (s) => String(s).toLowerCase().replace(/\b(blk|block|unit|stack)\b/g, '').replace(/[#\s\-_.]+/g, '');
const TYPE_SYNONYMS = { '2RF-T1': ['2 room flexi type 1', '2rf t1', '2-room flexi', 'flexi', '2rf', 'two room'], '2RF-T2': ['2 room flexi type 2', '2rf t2', '2-room flexi', 'flexi', '2rf', 'two room'], '3R': ['3 room', '3-room', 'three room', '3r'], '4R': ['4 room', '4-room', 'four room', '4r'], '5R': ['5 room', '5-room', 'five room', '5r'], '3GEN': ['3gen', '3 gen', 'three generation', 'multi-generation'], '1R-RENT': ['1 room rental', 'rental', 'rent'], '2R-RENT': ['2 room rental', 'rental', 'rent'] };
function buildSearchIndex() {
  SEARCH = [];
  for (const b of SITE.blocks) SEARCH.push({ kind: 'Block', label: 'Blk ' + b.id, sub: `${b.storeys} storeys · ${b.total} ${b.kind === 'sale' ? 'flats' : 'rental flats'}`, keys: [b.id, 'blk ' + b.id, ...(b.kind === 'rental' ? ['rental'] : []), ...Object.keys(b.mix).map(typeName)], go: () => select({ kind: 'building', id: b.id }, { fly: true }) });
  const others = [['436', 'Blk 436 · multi-storey car park', ['car park', 'carpark', 'mscp', 'parking', 'roof garden', 'preschool', 'community garden', 'allotment']],
    ['437', 'Blk 437 · precinct pavilion', ['pavilion']], ['438', 'Blk 438 · precinct pavilion', ['pavilion']], ['439', 'Blk 439 · pavilion + drop-off porch', ['pavilion', 'drop-off', 'porch']],
    ['porch', 'Drop-off porch (by Blk 437B)', ['drop-off', 'porch']], ['440', 'Blk 440 · eating house, shops, mini-mart', ['shops', 'eating house', 'food', 'coffee shop', 'mini-mart', 'minimart', 'commercial']], ['441', 'Blk 441 · electrical sub-station', ['ess', 'sub-station', 'substation']]];
  for (const [id, label, keys] of others) SEARCH.push({ kind: 'Building', label, sub: '', keys: [id, 'blk ' + id, ...keys], go: () => select({ kind: 'building', id }, { fly: true }) });
  for (const [no, info] of UNITS.idx) SEARCH.push({ kind: 'Stack', label: `#${no} · Blk ${info.block}`, sub: `${typeName(info.type)} · faces ${FACE_TXT(info.face)}`, keys: ['#' + no, no], exact: true, go: () => { select({ kind: 'building', id: info.block, stack: info }); focusFlat(info, Math.min(15, info.storeys)); } });
  const types = ['2RF-T1', '2RF-T2', '3R', '4R', '5R', '3GEN', '1R-RENT'];
  for (const t of types) SEARCH.push({ kind: 'Flat type', label: t === '1R-RENT' ? 'Rental flats (1-Room / 2-Room)' : typeName(t), sub: 'Filter + colour stacks', keys: [t, typeName(t), ...(TYPE_SYNONYMS[t] || [])], go: () => { const key = t === '1R-RENT' ? 'RENT' : t; state.settings.typeFilter = [key]; state.settings.colourByType = true; syncControls(); updateTypeOverlay(); renderBlockList(); saveSettings(); openLeft('types'); } });
  for (const f of SITE.facilities) SEARCH.push({ kind: 'Facility', label: f.name[0].toUpperCase() + f.name.slice(1), sub: f.where, keys: [f.name, f.where], go: () => select({ kind: 'facility', id: f.name, f }, { fly: true }) });
  for (const r of SITE.roads) if (!/unnamed/i.test(r.name)) SEARCH.push({ kind: 'Road', label: r.name, sub: r.status, keys: [r.name], go: () => { select({ kind: 'road', id: r.name }); const m = r.line[Math.floor(r.line.length / 2)]; flyTo(new THREE.Vector3(m[0] + 90, 120, m[1] + 90), new THREE.Vector3(m[0], 0, m[1]), 50); } });
  SEARCH.push({ kind: 'Water', label: 'Sungei Sembawang (canal)', sub: 'west edge of the estate', keys: ['canal', 'sungei sembawang', 'river', 'drain'], go: () => { const m = SITE.canal.east[2]; select(null); flyTo(new THREE.Vector3(m[0] - 120, 90, m[1] + 60), new THREE.Vector3(m[0], 0, m[1]), 50); } });
  for (const r of SITE.reserved) SEARCH.push({ kind: 'Site', label: r.name, sub: 'context only', keys: [r.name], go: () => { select({ kind: 'reserved', id: r.name }); let x = 0, z = 0; r.poly.forEach((p) => { x += p[0]; z += p[1]; }); x /= r.poly.length; z /= r.poly.length; flyTo(new THREE.Vector3(x + 100, 160, z + 100), new THREE.Vector3(x, 0, z), 50); } });
  for (const p of SEARCH) p.nkeys = p.keys.map(norm);
}
function runSearch(q) {
  const n = norm(q); if (!n) return [];
  const out = [];
  const addr = String(q).match(/#?\s*(\d{1,2})\s*-\s*(\d{3})/); // HDB address: #storey-unit
  if (addr && UNITS.idx.has(addr[2])) {
    const info = UNITS.idx.get(addr[2]), st = parseInt(addr[1], 10);
    if (st >= 2 && st <= info.storeys) return [{ kind: 'Flat', label: `Blk ${info.block} #${String(st).padStart(2, '0')}-${addr[2]}`, sub: `${typeName(info.type)} · storey ${st} · faces ${FACE_TXT(info.face)}`,
      go: () => { select({ kind: 'building', id: info.block, stack: info, storeyHint: st }); focusFlat(info, st); } }];
    return [{ kind: 'Flat', label: `#${addr[1]}-${addr[2]}`, sub: `Blk ${info.block} has storeys 2–${info.storeys} (storey 1 is the void deck)`, go: () => {} }];
  }
  for (const p of (AREA.status === 'ready' ? SEARCH.concat(AREA.search) : SEARCH)) {
    let score = 0;
    for (const k of p.nkeys) {
      if (p.exact) { if (k === n) score = Math.max(score, 3); else if (k.startsWith(n) && n.length >= 2) score = Math.max(score, 1.5); continue; }
      if (k === n) score = Math.max(score, 3); else if (k.startsWith(n)) score = Math.max(score, 2); else if (k.includes(n)) score = Math.max(score, 1);
    }
    if (score) out.push({ p, score });
  }
  out.sort((a, b) => b.score - a.score || a.p.label.localeCompare(b.p.label));
  const seen = new Set(); return out.filter(({ p }) => !seen.has(p.label) && seen.add(p.label)).slice(0, 9).map((x) => x.p);
}
(function bindSearch() {
  const inp = $('#search'), box = $('#searchResults'); let res = [], cur = -1;
  const draw = () => {
    box.innerHTML = res.length ? res.map((p, i) => `<button type="button" role="option" class="${i === cur ? 'cur' : ''}" data-i="${i}"><span class="k">${esc(p.kind)}</span><span class="l">${esc(p.label)}</span><span class="s">${esc(p.sub || '')}</span></button>`).join('')
      : (inp.value.trim() ? '<div class="none">No match. Try "437B", "#132", "4-room", "playground".</div>' : '');
    box.hidden = !inp.value.trim();
  };
  inp.addEventListener('input', () => { res = runSearch(inp.value); cur = res.length ? 0 : -1; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { cur = Math.min(res.length - 1, cur + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cur = Math.max(0, cur - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && res[cur]) { res[cur].go(); box.hidden = true; inp.blur(); }
    else if (e.key === 'Escape') { inp.value = ''; box.hidden = true; inp.blur(); }
  });
  box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; res[+b.dataset.i].go(); box.hidden = true; inp.blur(); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) box.hidden = true; });
})();

/* ---------- left panel: blocks list, flat types, storey, my flat, layers, heights ---------- */
function renderBlockList() {
  const f = state.settings.typeFilter;
  const rows = SITE.blocks.map((b) => {
    const match = Object.entries(b.mix).filter(([t]) => typeMatches(t));
    const cnt = f.length ? match.reduce((a, [, n]) => a + n, 0) : b.total;
    const dots = Object.keys(b.mix).map(swatch).join('');
    return `<button type="button" data-id="${b.id}" class="${f.length && !cnt ? 'dim' : ''}"><b>Blk ${b.id}</b><span>${dots}</span><small>${b.storeys} st · ${f.length ? `${cnt} matching flats` : `${b.total} ${b.kind === 'sale' ? 'flats' : 'rental'}`}</small></button>`;
  }).join('') + `<button type="button" data-id="436"><b>Blk 436</b><span></span><small>car park + roof garden</small></button>`;
  $('#blockList').innerHTML = rows;
  $('#typeSummary').textContent = f.length ? `${SITE.blocks.reduce((a, b) => a + Object.entries(b.mix).filter(([t]) => typeMatches(t)).reduce((x, [, n]) => x + n, 0), 0)} flats match` : '1,360 flats in 5 blocks';
}
$('#blockList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { select({ kind: 'building', id: b.dataset.id }, { fly: true }); if (document.body.classList.contains('mobile')) closeLeft(); } });

function renderTypeChips() {
  const keys = [['2RF', '2-Room Flexi', '2RF-T2'], ['3R', '3-Room', '3R'], ['4R', '4-Room', '4R'], ['5R', '5-Room', '5R'], ['3GEN', '3Gen', '3GEN'], ['RENT', 'Rental', '1R-RENT']];
  $('#typeChips').innerHTML = keys.map(([k, l, c]) => `<button type="button" class="chip ${state.settings.typeFilter.includes(k) ? 'on' : ''}" data-k="${k}" aria-pressed="${state.settings.typeFilter.includes(k)}">${swatch(c)}${l}</button>`).join('');
}
$('#typeChips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const f = state.settings.typeFilter, k = b.dataset.k, i = f.indexOf(k);
  if (i >= 0) f.splice(i, 1); else f.push(k);
  renderTypeChips(); renderBlockList(); updateTypeOverlay(); saveSettings();
});
$('#typeClear').addEventListener('click', () => { state.settings.typeFilter = []; renderTypeChips(); renderBlockList(); updateTypeOverlay(); saveSettings(); });
$('#colourByType').addEventListener('change', (e) => { state.settings.colourByType = e.target.checked; updateTypeOverlay(); saveSettings(); if (state.selection) renderInfo(); });

function storeyReadout() {
  const n = state.settings.storey.n;
  $('#storeyOut').textContent = `Storey ${n} · floor ≈ ${fmt(floorY(n))} m above ground`;
}
$('#storeyOn').addEventListener('change', (e) => { state.settings.storey.on = e.target.checked; buildStoreyBand(); saveSettings(); });
$('#storeyN').addEventListener('input', (e) => { state.settings.storey.n = +e.target.value; storeyReadout(); if (!state.settings.storey.on) { state.settings.storey.on = true; $('#storeyOn').checked = true; } buildStoreyBand(); saveSettings(); });

/* my flat */
function fillUnitOptions() {
  const id = $('#muBlock').value, list = UNITS.stacks.get(id) || [];
  $('#muUnit').innerHTML = list.map((s) => `<option value="${s.unit}">#${s.unit} · ${esc(SITE.flatTypes[s.type].short)} · ${bearingName(s.bearing)}</option>`).join('');
  const b = blockById(id); $('#muStorey').max = b ? b.storeys : 30;
}
function initMyFlat() {
  $('#muBlock').innerHTML = SITE.blocks.filter((b) => b.kind === 'sale').map((b) => `<option value="${b.id}">Blk ${b.id}</option>`).join('');
  const mu = state.settings.myUnit;
  if (mu && myUnitValid(mu)) { $('#muBlock').value = mu.block; fillUnitOptions(); $('#muUnit').value = mu.unit; $('#muStorey').value = mu.storey; }
  else fillUnitOptions();
  renderMyFlat();
}
$('#muBlock').addEventListener('change', fillUnitOptions);
$('#muForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const block = $('#muBlock').value, unit = $('#muUnit').value, storey = parseInt($('#muStorey').value, 10);
  const info = UNITS.idx.get(unit), b = blockById(block);
  const err = $('#muErr');
  if (!info || info.block !== block) { err.textContent = 'Pick a unit in that block.'; return; }
  if (!(storey >= 2 && storey <= b.storeys)) { err.textContent = `Storey must be 2–${b.storeys} (storey 1 is the void deck).`; return; }
  err.textContent = '';
  state.settings.myUnit = { block, unit, storey }; saveSettings();
  buildUnitMark(); renderMyFlat(true); focusFlat(info, storey);
  if (document.body.classList.contains('mobile')) closeLeft();
});
$('#muClear').addEventListener('click', () => { state.settings.myUnit = null; saveSettings(); buildUnitMark(); renderMyFlat(); });
function myUnitValid(mu) {
  const info = mu && UNITS.idx.get(mu.unit), b = mu && blockById(mu.block);
  return !!(info && b && info.block === mu.block && mu.storey >= 2 && mu.storey <= b.storeys);
}
function keyDates(year) { return [['20 Mar', `${year}-03-20`], ['21 Jun', `${year}-06-21`], ['22 Sep', `${year}-09-22`], ['21 Dec', `${year}-12-21`]]; }
function renderMyFlat(compute = false) {
  const mu = state.settings.myUnit, out = $('#muOut');
  $('#muClear').hidden = !mu;
  if (!mu || !myUnitValid(mu)) { out.innerHTML = '<p class="muted">Set your block, unit number and storey to highlight your flat and estimate its direct sun.</p>'; return; }
  const info = UNITS.idx.get(mu.unit);
  const head = `<div class="card mine"><b>Blk ${esc(mu.block)} #${String(mu.storey).padStart(2, '0')}-${esc(mu.unit)}</b><br>${esc(typeName(info.type))} · main windows face ${FACE_TXT(info.face)}<br>Floor ≈ ${fmt(floorY(mu.storey))} m above ground <small>(assumed heights)</small>
    <div class="row"><button class="btn sm" type="button" id="muGo">Go to my flat</button><button class="btn sm ghost" type="button" id="muSun">${compute ? 'Recalculate' : 'Estimate sun hours'}</button></div></div>`;
  let table = '';
  if (compute) {
    const sd = state.settings.sun.date || todaySGT(), yr = sd.slice(0, 4);
    const rows = [['Selected', sd], ...keyDates(yr)].map(([n, d]) => { const r = flatSunHours(info, mu.storey, d); return `<tr><td>${n}<small>${d.slice(5)}</small></td><td class="n">${fmt(r.hours)}</td><td class="n">${fmt(r.before12)}</td><td class="n">${fmt(r.after15)}</td></tr>`; }).join('');
    table = `<h4>Direct sun on the main facade <small>(hours, estimate)</small></h4><table class="t"><thead><tr><th>Date</th><th class="n">Total</th><th class="n">Before 12</th><th class="n">After 3 pm</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Geometric estimate at the centre of the flat's main facade, 5-minute steps, blocked by the estate's buildings${AREA.status === 'ready' ? ' and the surrounding OpenStreetMap buildings (heights partly estimated)' : ' only — turn on the Sembawang area to include the surrounding buildings'}. It ignores trees, ledges, side windows, and anything future built on the reserved sites. Heights are assumed (${state.settings.heights.floorToFloor} m storeys, ${state.settings.heights.voidDeck} m void deck).</p>`;
  }
  out.innerHTML = head + table;
  $('#muGo').onclick = () => focusFlat(info, mu.storey);
  $('#muSun').onclick = () => renderMyFlat(true);
}

/* layers */
function bindLayers() {
  $$('#layers input[type=checkbox]').forEach((cb) => {
    cb.checked = state.settings.layers[cb.name];
    cb.addEventListener('change', () => { state.settings.layers[cb.name] = cb.checked; if (cb.name === 'sunPath') updateSun(); applyLayers(); saveSettings(); syncControls(); });
  });
}
/* heights */
$('#hForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = parseFloat($('#hF2F').value), v = parseFloat($('#hVD').value), err = $('#hErr');
  if (!(f >= 2.4 && f <= 3.6) || !(v >= 2.4 && v <= 6)) { err.textContent = 'Floor-to-floor 2.4–3.6 m; void deck 2.4–6 m.'; return; }
  err.textContent = '';
  state.settings.heights = { floorToFloor: f, voidDeck: v }; saveSettings(); rebuildBuildings();
});
$('#hReset').addEventListener('click', () => { $('#hErr').textContent = ''; state.settings.heights = { floorToFloor: SITE_DEFAULT.heights.floorToFloor, voidDeck: SITE_DEFAULT.heights.voidDeck }; syncControls(); saveSettings(); rebuildBuildings(); });

/* ---------- sun bar ---------- */
function syncSunBar() {
  const s = state.settings.sun;
  $('#sunDate').value = s.date || todaySGT();
  $('#sunTime').value = s.minutes;
}
on('sun', (p) => {
  const t = sunTimes(p.dateStr);
  $('#sunRead').innerHTML = `<b>${hhmm(p.minutes)} SGT</b> · ${p.el > 0 ? `altitude ${fmt(p.el)}° · azimuth ${fmt(p.az, 0)}° (${bearingName(p.az)})` : 'sun below the horizon'}<small>rise ${hhmm(t.rise)} · solar noon ${hhmm(t.noon)} (${fmt(t.maxEl, 0)}°) · set ${hhmm(t.set)}</small>`;
});
$('#sunDate').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { state.settings.sun.date = e.target.value; updateSun(); saveSettings(); } });
$('#sunTime').addEventListener('input', (e) => { state.settings.sun.minutes = +e.target.value; updateSun(); saveSettings(); });
$('#sunPlay').addEventListener('click', () => { state.sunPlaying = !state.sunPlaying; $('#sunPlay').textContent = state.sunPlaying ? 'Pause' : 'Play day'; $('#sunPlay').setAttribute('aria-pressed', state.sunPlaying); requestRender(); });
$('#sunNow').addEventListener('click', () => { const t = new Date(Date.now() + SGT_OFFSET_MIN * 60000); state.settings.sun.date = t.toISOString().slice(0, 10); state.settings.sun.minutes = t.getUTCHours() * 60 + t.getUTCMinutes(); syncSunBar(); updateSun(); saveSettings(); });
function stepSun(dt) {
  if (!state.sunPlaying) return false;
  const speed = +$('#sunSpeed').value; // minutes per second
  let m = state.settings.sun.minutes + speed * dt;
  if (m > 19.5 * 60) m = 6.5 * 60;
  state.settings.sun.minutes = m; $('#sunTime').value = Math.round(m); updateSun();
  return true;
}
function toggleSun(open = !state.sunOpen) {
  state.sunOpen = open; document.body.classList.toggle('sun-open', open);
  $('#btnSun').setAttribute('aria-pressed', open);
  if (!open && state.sunPlaying) $('#sunPlay').click();
  requestRender();
}

/* ---------- top bar actions, menu, dialogs ---------- */
$('#btnMeasure').addEventListener('click', () => setTool(state.tool === 'measure' ? 'orbit' : 'measure'));
$('#btnWalk').addEventListener('click', () => setTool(state.tool === 'walk' ? 'orbit' : 'walk'));
$('#btnSun').addEventListener('click', () => toggleSun());
$('#toolExit').addEventListener('click', () => { clearMeasure(); setTool('orbit'); });
$('#btnShot').addEventListener('click', screenshot);
$('#btnMenu').addEventListener('click', () => ($('#left').classList.contains('open') ? closeLeft() : openLeft()));
$('#leftClose').addEventListener('click', closeLeft);
function openLeft(section) {
  $('#left').classList.add('open'); setTimeout(resize, 260);
  if (section) { const d = document.getElementById('sec-' + section); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } }
}
function closeLeft() { $('#left').classList.remove('open'); setTimeout(resize, 260); }
const menu = $('#menu');
$('#btnMore').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
document.addEventListener('click', (e) => { if (!e.target.closest('#menu, #btnMore')) menu.hidden = true; });
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; menu.hidden = true;
  ({ export: exportJSON, import: () => $('#importFile').click(), reset: resetSettings, about: () => $('#about').showModal(), help: () => $('#help').showModal() })[b.dataset.act]?.();
});
$$('dialog .close').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- saving files: artifact "downloads" capability → normal download → in-page fallback ---------- */
let DL = null;
try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then((d) => { DL = d; }).catch(() => { DL = null; }); } catch (e) { DL = null; }
const IN_FRAME = (() => { try { return window.top !== window; } catch (e) { return true; } })();
async function saveFile(filename, blob, fallback) {
  if (DL) {
    try { const r = await DL.save({ filename, data: blob }); if (r && r.status === 'saved') toast('Saved ' + filename); return; }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') { toast('Save cancelled'); return; }
      if (c === 'rate_limited') { toast('A save prompt is already open'); return; }
      // unavailable / other: fall through to the next route
    }
  }
  if (!IN_FRAME) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return;
  }
  fallback(); // sandboxed frame without the capability: show it in the page instead
}
function exportJSON() {
  const data = { format: 'sembawang-brook-3d', version: 1, app: APP_VERSION, exported: new Date().toISOString(), settings: state.settings, site: SITE };
  const text = JSON.stringify(data, null, 1);
  saveFile('sembawang-brook-3d.json', new Blob([text], { type: 'application/json' }), () => {
    $('#saveTitle').textContent = 'Export (copy)';
    $('#saveNote').textContent = 'Downloads are not available in this view. Copy the JSON and keep it as a .json file; you can import it later.';
    $('#saveBody').innerHTML = '<textarea readonly rows="8"></textarea><div class="row"><button class="btn" type="button" id="copyJson">Copy JSON</button></div>';
    $('#saveBody textarea').value = text;
    $('#copyJson').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { $('#saveBody textarea').select(); toast('Select all and copy', true); } };
    $('#saveDlg').showModal();
  });
}
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'sembawang-brook-3d' || data.version !== 1) throw new Error('Not a Sembawang Brook 3D export (format/version mismatch).');
    if (data.site) checkSiteShape(data.site);
    const prevSite = SITE, prevSettings = state.settings;
    try {
      if (data.site) { SITE = data.site; setFrame(); applyGroupFrame(); }
      state.settings = sanitizeSettings(data.settings || {});
      rebuildEverything();
    } catch (err) { // roll back to the previous, working state
      SITE = prevSite; state.settings = prevSettings; setFrame(); applyGroupFrame(); rebuildEverything(); syncControls();
      throw new Error('the data could not be built (' + err.message + '); nothing was changed');
    }
    let note = 'Imported';
    if (state.settings.myUnit && !myUnitValid(state.settings.myUnit)) { state.settings.myUnit = null; buildUnitMark(); note += ' · the saved flat did not match its block/storey and was cleared'; }
    const issues = validateSite(); if (issues.length) note += ' · data check: ' + issues[0];
    saveSettings(); syncControls(); toast(note, issues.length > 0);
  } catch (err) { toast('Import failed: ' + err.message, true); }
});
function checkSiteShape(s) {
  const bad = (m) => { throw new Error('site data: ' + m); };
  if (s.format !== 'sembawang-brook-site' || s.version !== 1) bad('format/version mismatch');
  if (!s.meta || typeof s.meta.gridDeg !== 'number' || !Array.isArray(s.meta.latlon)) bad('meta missing');
  if (!s.heights || !Array.isArray(s.blocks) || !s.blocks.length) bad('blocks missing');
  const box = (o) => o && ['u', 'v', 'lu', 'lv'].every((k) => Number.isFinite(o[k]));
  for (const b of s.blocks) {
    if (!b.id || !Number.isInteger(b.storeys) || !b.mix || !box(b.core)) bad(`block ${b.id || '?'} incomplete`);
    if (b.kind === 'sale' && !(Array.isArray(b.towers) && b.towers.every((t) => Array.isArray(t.rows) && t.rows.every((r) => Array.isArray(r.pads) && r.pads.every(box))) && Array.isArray(b.link))) bad(`block ${b.id} towers/link incomplete`);
    if (b.kind !== 'sale' && !(Array.isArray(b.points) && b.points.every(box))) bad(`block ${b.id} towers incomplete`);
  }
  if (!s.mscp || !s.mscp.westWing || !s.mscp.southWing || !s.mscp.ramp) bad('car park missing');
  for (const k of ['roads', 'linkways', 'facilities', 'busBays', 'reserved', 'lowRise', 'boundary']) if (!Array.isArray(s[k])) bad(k + ' missing');
  if (!s.canal || !Array.isArray(s.canal.east) || !Array.isArray(s.canal.west)) bad('canal missing');
}
function resetSettings() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  SITE = structuredClone(SITE_DEFAULT); setFrame(); applyGroupFrame();
  state.settings = DEFAULT_SETTINGS(); rebuildEverything(); syncControls(); goPreset(defaultPreset()); toast('Settings reset');
}
function screenshot() {
  render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) { toast('Could not capture the image', true); return; }
    saveFile('sembawang-brook-3d.png', blob, () => {
      $('#saveTitle').textContent = 'Image';
      $('#saveNote').textContent = 'Downloads are not available in this view. Long-press or right-click the image to save it.';
      $('#saveBody').innerHTML = `<img alt="Snapshot of the 3D view" src="${URL.createObjectURL(blob)}">`;
      $('#saveDlg').showModal();
    });
  }, 'image/png');
}
let toastTimer = 0;
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

/* presets bar */
function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p) => `<button type="button" class="preset" data-id="${p.id}" title="${esc(p.hint)} (key ${p.key})">${esc(p.name)}</button>`).join('');
}
$('#presets').addEventListener('click', (e) => { const b = e.target.closest('.preset'); if (b) goPreset(b.dataset.id); });
$('#btnReset').addEventListener('click', () => goPreset(defaultPreset()));
$('#btnFocus').addEventListener('click', () => { const s = state.selection; if (s && s.kind === 'building') focusAnchor(REG.anchors.get(s.id)); else toast('Select a building first'); });

/* keyboard (ignored while typing or walking) */
addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { if (state.tool !== 'orbit') { clearMeasure(); setTool('orbit'); } else if (state.selection) { select(null); $('#info').classList.remove('open'); } return; }
  if (state.tool === 'walk') return;
  const p = PRESETS.find((x) => x.key === e.key); if (p) { goPreset(p.id); return; }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'f' || e.key === 'F') $('#btnFocus').click();
  else if (e.key === 'm' || e.key === 'M') $('#btnMeasure').click();
  else if (e.key === 'r' || e.key === 'R') goPreset(defaultPreset());
  else if (e.key === '?') $('#help').showModal();
});

/* compass (rotates with the camera) */
const _cd = new THREE.Vector3();
function updateCompass() {
  camera.getWorldDirection(_cd); const bearing = Math.atan2(_cd.x, -_cd.z) / DEG;
  $('#compass .dial').style.transform = `rotate(${-bearing}deg)`;
  $('#compass').title = `Facing ${bearingName(bearing)} (${Math.round((bearing + 360) % 360)}°) — tap to face north`;
}
$('#compass').addEventListener('click', () => { // face north (keep height/distance)
  const t = controls.target.clone(), d = camera.position.distanceTo(t), el = Math.asin(clamp((camera.position.y - t.y) / d, -1, 1));
  flyTo(new THREE.Vector3(t.x, t.y + Math.sin(el) * d, t.z + Math.cos(el) * d), t);
});

/* sync all controls from settings */
function syncControls() {
  const s = state.settings;
  $('#colourByType').checked = s.colourByType; renderTypeChips(); renderBlockList();
  $('#storeyOn').checked = s.storey.on; $('#storeyN').value = s.storey.n; storeyReadout();
  $$('#layers input[type=checkbox]').forEach((cb) => { cb.checked = s.layers[cb.name]; });
  $('#hF2F').value = s.heights.floorToFloor; $('#hVD').value = s.heights.voidDeck;
  syncSunBar(); initMyFlat();
}

/* mobile layout switch */
const mq = matchMedia('(max-width: 760px)');
function applyMobile() { document.body.classList.toggle('mobile', mq.matches); setTimeout(resize, 0); $('#search').placeholder = mq.matches ? 'Search' : 'Search block, #unit, flat type, facility…'; if (!mq.matches) $('#left').classList.add('open'); else closeLeft(); }
mq.addEventListener('change', applyMobile);
