/* =====================================================================
   SG — Singapore 3D map. MapLibre GL JS 5 + OpenFreeMap vector tiles
   (OpenStreetMap data in the OpenMapTiles schema). Buildings are
   extruded from their OSM heights and lit from the sun's direction
   (01_suncalc.js) for a chosen Singapore date and time.
   ===================================================================== */
(() => {
  'use strict';
  const SG = /*__SG_JSON__*/null; // { estate: { name, centre:[lon,lat], ring:[[lon,lat]…], url } } — injected by tools/build.py

  const CFG = {
    style: 'https://tiles.openfreemap.org/styles/liberty',
    geocoder: 'https://nominatim.openstreetmap.org/search',
    island: [103.8198, 1.3521],
    maxBounds: [[103.3, 1.0], [104.4, 1.65]],
    home: { center: SG.estate.centre, zoom: 15.6, pitch: 60, bearing: -25 },
    buildingsFrom: 13, // OpenMapTiles has buildings from z13
    store: 'sembawang-brook-3d.sg',
  };
  const PLACES = [
    { id: 'estate', name: SG.estate.name, sub: 'HDB estate · Sembawang', ll: SG.estate.centre, z: 16.4, alias: 'home bto hdb estate admiralty' },
    { id: 'island', name: 'All of Singapore', sub: 'Island overview', ll: CFG.island, z: 10.9, pitch: 35, alias: 'overview whole island zoom out' },
    { id: 'sembawang-park', name: 'Sembawang Park', sub: 'Park · Sembawang', ll: [103.8368, 1.4614], z: 16, alias: 'beach jetty' },
    { id: 'sembawang-mrt', name: 'Sembawang MRT', sub: 'North–South Line', ll: [103.8201, 1.4491], z: 16.5, alias: 'station sun plaza' },
    { id: 'canberra-mrt', name: 'Canberra MRT', sub: 'North–South Line', ll: [103.8297, 1.4430], z: 16.5, alias: 'station' },
    { id: 'woodlands', name: 'Woodlands MRT', sub: 'North–South & Thomson–East Coast lines', ll: [103.7865, 1.4370], z: 16, alias: 'causeway point station' },
    { id: 'yishun', name: 'Yishun MRT', sub: 'North–South Line', ll: [103.8350, 1.4295], z: 16, alias: 'northpoint station' },
    { id: 'bishan', name: 'Bishan', sub: 'Town centre', ll: [103.8484, 1.3510], z: 16, alias: 'junction 8' },
    { id: 'toa-payoh', name: 'Toa Payoh', sub: 'Town centre', ll: [103.8474, 1.3327], z: 16, alias: 'hdb hub' },
    { id: 'orchard', name: 'Orchard Road', sub: 'ION Orchard', ll: [103.8318, 1.3040], z: 16.2, alias: 'ion shopping' },
    { id: 'raffles', name: 'Raffles Place', sub: 'Central Business District', ll: [103.8514, 1.2840], z: 16, pitch: 62, alias: 'cbd downtown skyscrapers' },
    { id: 'mbs', name: 'Marina Bay Sands', sub: 'Marina Bay', ll: [103.8607, 1.2834], z: 16, pitch: 62, alias: 'mbs marina bay' },
    { id: 'gardens', name: 'Gardens by the Bay', sub: 'Marina Bay', ll: [103.8636, 1.2816], z: 16, alias: 'supertree' },
    { id: 'duxton', name: 'Pinnacle@Duxton', sub: 'HDB · Tanjong Pagar', ll: [103.8414, 1.2765], z: 17, pitch: 62, alias: 'tanjong pagar hdb' },
    { id: 'sentosa', name: 'Resorts World Sentosa', sub: 'Sentosa', ll: [103.8238, 1.2540], z: 16, alias: 'rws universal' },
    { id: 'jurong-east', name: 'Jurong East', sub: 'Jurong Lake District', ll: [103.7422, 1.3331], z: 16, alias: 'jem westgate' },
    { id: 'punggol', name: 'Punggol', sub: 'Town centre', ll: [103.9023, 1.4053], z: 16, alias: 'waterway point' },
    { id: 'tampines', name: 'Tampines', sub: 'Regional centre', ll: [103.9452, 1.3530], z: 16, alias: 'tampines mall' },
    { id: 'jewel', name: 'Jewel Changi Airport', sub: 'Changi', ll: [103.9895, 1.3604], z: 16, alias: 'airport changi' },
  ];

  /* ---------------- helpers ---------------- */
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9@ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const compass = (b) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((b % 360) + 360) % 360 / 22.5) % 16];
  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(CFG.store)) || {}; } catch (e) { return {}; } },
    set(patch) { try { localStorage.setItem(CFG.store, JSON.stringify({ ...store.get(), ...patch })); } catch (e) { /* private mode / blocked storage */ } },
  };
  function showStatus(msg) { const s = $('#status'); if (!msg) { s.hidden = true; s.textContent = ''; return; } s.textContent = msg; s.hidden = false; }
  const nowMinutesSGT = () => { const t = new Date(Date.now() + SGT_OFFSET_MIN * 60000); return t.getUTCHours() * 60 + t.getUTCMinutes(); };

  /* ---------------- map ---------------- */
  if (!window.maplibregl) { showStatus('The map library could not be loaded from cdn.jsdelivr.net. Check your connection and reload.'); return; }
  const saved = store.get();
  const inBounds = (ll) => Array.isArray(ll) && ll[0] > CFG.maxBounds[0][0] && ll[0] < CFG.maxBounds[1][0] && ll[1] > CFG.maxBounds[0][1] && ll[1] < CFG.maxBounds[1][1];
  /* #view=zoom/lat/lon/bearing/pitch in the address bar, so a link reopens the same view.
     Written by hand (not MapLibre's hash option) so it can pause while the map follows your location. */
  function readHash() {
    const m = location.hash.match(/[#&]view=([^&]+)/); if (!m) return null;
    const [z, lat, lon, b, p] = m[1].split('/').map(Number);
    return [z, lat, lon].every(Number.isFinite) && inBounds([lon, lat]) ? { center: [lon, lat], zoom: z, bearing: b || 0, pitch: p || 0 } : null;
  }
  const start = readHash() || (saved.view && inBounds(saved.view.center) && Number.isFinite(saved.view.zoom) ? saved.view : CFG.home);

  let map;
  try {
    map = new maplibregl.Map({
      container: 'map', style: CFG.style,
      center: start.center, zoom: start.zoom, pitch: start.pitch, bearing: start.bearing,
      maxBounds: CFG.maxBounds, minZoom: 9, maxZoom: 19, maxPitch: 85,
      attributionControl: false, canvasContextAttributes: { antialias: true },
    });
  } catch (e) {
    showStatus(`This browser could not start the 3D map (${e.message || e}). WebGL is required.`);
    return;
  }
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  let styleReady = false, buildingSource = null, tilesLoaded = 0, tileErrors = 0;
  map.on('error', (e) => {
    const msg = (e && e.error && (e.error.message || e.error.status)) || 'unknown error';
    console.warn('[sg] map error:', msg);
    if (!styleReady) showStatus(`Could not load the map style from OpenFreeMap (${msg}). Check your connection and reload.`);
    else if (e.sourceId && ++tileErrors >= 3 && !tilesLoaded) showStatus('Map tiles are not loading from OpenFreeMap right now. Check your connection, or try again later.');
  });
  map.on('sourcedata', (e) => {
    if (e.tile && e.sourceId === buildingSource) { tilesLoaded++; if (tileErrors) showStatus(''); }
  });

  /* replace the style's own 3D buildings with height-shaded, sun-lit ones that start at z13 */
  function setupBuildings() {
    const layers = map.getStyle().layers;
    const bLayers = layers.filter((l) => l['source-layer'] === 'building');
    const sources = map.getStyle().sources;
    buildingSource = (bLayers[0] && bLayers[0].source) || Object.keys(sources).find((k) => sources[k].type === 'vector') || null;
    if (!buildingSource) { showStatus('This map style has no vector tiles, so there are no 3D buildings to show.'); return false; }
    const old = bLayers.filter((l) => l.type === 'fill-extrusion');
    const filter = (old[0] && old[0].filter) || ['!', ['has', 'hide_3d']];
    // keep the style's stacking: insert where its own 3D layer was, else under the first label layer
    let before = null;
    if (old.length) { const i = layers.indexOf(old[old.length - 1]); before = (layers.slice(i + 1).find((l) => !old.includes(l)) || {}).id || null; }
    else before = (layers.find((l) => l.type === 'symbol') || {}).id || null;
    old.forEach((l) => map.removeLayer(l.id));
    const h = ['coalesce', ['get', 'render_height'], 6];
    map.addLayer({
      id: 'sg-3d', type: 'fill-extrusion', source: buildingSource, 'source-layer': 'building', minzoom: CFG.buildingsFrom, filter,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], h, 0, '#EEEBE6', 12, '#E6E2DC', 40, '#DAD6D0', 90, '#C9CED6', 180, '#B7C0CC'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], CFG.buildingsFrom, 0, CFG.buildingsFrom + 1, h],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], CFG.buildingsFrom, 0, CFG.buildingsFrom + 1, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.95,
        'fill-extrusion-vertical-gradient': true,
      },
    }, before || undefined);
    return true;
  }

  /* estate outline (under the buildings) */
  function addEstate() {
    const ring = SG.estate.ring;
    map.addSource('estate', { type: 'geojson', data: { type: 'Feature', properties: { name: SG.estate.name }, geometry: { type: 'Polygon', coordinates: [ring] } } });
    const before = map.getLayer('sg-3d') ? 'sg-3d' : undefined;
    map.addLayer({ id: 'estate-fill', type: 'fill', source: 'estate', paint: { 'fill-color': '#D6247E', 'fill-opacity': 0.16 } }, before);
    map.addLayer({ id: 'estate-line', type: 'line', source: 'estate', paint: { 'line-color': '#D6247E', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3], 'line-opacity': 0.9 } }, before);
  }

  // the pin is DOM, so it survives style reloads and does not need the style's fonts
  const pin = document.createElement('button');
  pin.type = 'button'; pin.className = 'estate-pin'; pin.textContent = SG.estate.name;
  pin.setAttribute('aria-label', `${SG.estate.name}: show details`);
  const popupBody = document.createElement('div');
  popupBody.innerHTML = '<b></b><p>HDB estate in Sembawang. The estate model has every block and flat, sun and shadows.</p><a></a>';
  popupBody.querySelector('b').textContent = SG.estate.name;
  const popLink = popupBody.querySelector('a'); popLink.href = SG.estate.url; popLink.textContent = 'Open the estate model →';
  new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat(SG.estate.centre)
    .setPopup(new maplibregl.Popup({ offset: 16, maxWidth: '260px' }).setDOMContent(popupBody)).addTo(map);

  map.on('style.load', () => {
    styleReady = true; showStatus('');
    setupBuildings();
    addEstate();
    addLocLayers();
    applySun();
  });

  /* ---------------- zoom hint + remembered view ---------------- */
  const hint = $('#zoomHint');
  const updateHint = () => hint.classList.toggle('off', map.getZoom() >= CFG.buildingsFrom);
  map.on('zoom', updateHint); updateHint();
  let saveT = 0;
  const followingMe = () => LOC.on && LOC.follow; // then the view centre is your position: keep it out of the link and storage
  function writeHash() {
    if (followingMe()) return;
    const c = map.getCenter(), h = `#view=${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}/${map.getBearing().toFixed(1)}/${map.getPitch().toFixed(0)}`;
    if (location.hash !== h) history.replaceState(history.state, '', h);
  }
  map.on('load', writeHash);
  map.on('moveend', () => {
    writeHash();
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (followingMe()) return;
      const c = map.getCenter();
      store.set({ view: { center: [+c.lng.toFixed(6), +c.lat.toFixed(6)], zoom: +map.getZoom().toFixed(2), pitch: +map.getPitch().toFixed(1), bearing: +map.getBearing().toFixed(1) } });
    }, 400);
  });
  addEventListener('hashchange', () => { const v = readHash(); if (v) map.jumpTo(v); });

  /* ---------------- camera moves ---------------- */
  function goTo(p) {
    stopFollowing(); // flying somewhere else ends "follow me" (tracking continues)
    const opts = { bearing: map.getBearing(), essential: true };
    if (reducedMotion()) opts.duration = 0;
    if (p.bbox) { // [s, n, w, e] from the geocoder
      const [s, n, w, e] = p.bbox;
      if (n - s > 0.004 || e - w > 0.004) {
        const cam = map.cameraForBounds([[w, s], [e, n]], { padding: 60, maxZoom: 17.5 });
        if (cam) { map.flyTo({ ...opts, center: cam.center, zoom: cam.zoom, pitch: 55 }); return; }
      }
    }
    map.flyTo({ ...opts, center: p.ll, zoom: p.z || 17, pitch: p.pitch != null ? p.pitch : 60 });
  }

  /* ---------------- places panel ---------------- */
  const placesEl = $('#places'), btnPlaces = $('#btnPlaces');
  function setPlaces(open) { placesEl.hidden = !open; btnPlaces.setAttribute('aria-pressed', String(open)); }
  function placeButton(p, onPick) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = p.id || '';
    b.textContent = p.name;
    const s = document.createElement('small'); s.textContent = p.sub || ''; b.appendChild(s);
    b.addEventListener('click', () => onPick(p));
    return b;
  }
  for (const p of PLACES) { const li = document.createElement('li'); li.appendChild(placeButton(p, (q) => { goTo(q); if (innerWidth <= 760) setPlaces(false); })); $('#placeList').appendChild(li); }
  btnPlaces.addEventListener('click', () => setPlaces(placesEl.hidden));
  $('#placesClose').addEventListener('click', () => setPlaces(false));

  /* ---------------- search: built-in places, then OpenStreetMap (Nominatim) on request ---------------- */
  const input = $('#search'), results = $('#results');
  let sel = -1, items = [], lastGeo = 0, geoSeq = 0;
  const geoCache = new Map();
  function matchPlaces(q) {
    const n = norm(q); if (!n) return [];
    return PLACES.map((p) => {
      const name = norm(p.name), hay = `${name} ${norm(p.sub)} ${p.alias}`;
      const score = name.startsWith(n) ? 3 : name.split(' ').some((w) => w.startsWith(n)) ? 2 : hay.includes(n) ? 1 : 0;
      return { p, score };
    }).filter((r) => r.score).sort((a, b) => b.score - a.score).slice(0, 8).map((r) => r.p);
  }
  function renderResults(list, extra) {
    results.textContent = ''; items = [];
    list.forEach((p, i) => {
      const b = placeButton(p, pick); b.id = `res-${i}`; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', 'false');
      results.appendChild(b); items.push(b);
    });
    if (extra) results.appendChild(extra);
    sel = -1; results.hidden = !results.children.length;
    input.setAttribute('aria-expanded', String(!results.hidden));
  }
  function note(text) { const d = document.createElement('div'); d.className = 'note'; d.textContent = text; d.style.cssText = 'padding:8px 10px;font-size:12px;color:var(--muted)'; return d; }
  function osmRow(q) {
    const b = placeButton({ id: 'osm', name: `Search OpenStreetMap for “${q}”`, sub: 'Addresses, streets, buildings (Nominatim)' }, () => geocode(q));
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', 'false'); b.id = 'res-osm';
    return b;
  }
  function onInput() {
    const q = input.value.trim();
    if (!q) { renderResults([]); return; }
    const local = matchPlaces(q);
    renderResults(local, q.length >= 3 ? osmRow(q) : (local.length ? null : note('Type at least 3 letters to search OpenStreetMap')));
    if (q.length >= 3) items.push(results.querySelector('#res-osm'));
  }
  async function geocode(q) {
    const key = norm(q), seq = ++geoSeq;
    renderResults([], note('Searching OpenStreetMap…'));
    try {
      let list = geoCache.get(key);
      if (!list) {
        const wait = 1100 - (Date.now() - lastGeo); // Nominatim policy: at most 1 request per second
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastGeo = Date.now();
        const url = `${CFG.geocoder}?format=jsonv2&limit=6&countrycodes=sg&bounded=1&viewbox=103.55,1.50,104.15,1.15&accept-language=en&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        list = (Array.isArray(data) ? data : []).map((d, i) => ({
          id: `osm-${i}`, name: d.name || String(d.display_name || '').split(',')[0], sub: String(d.display_name || '').split(',').slice(1, 4).join(',').trim(),
          ll: [+d.lon, +d.lat], z: 17.2, bbox: Array.isArray(d.boundingbox) ? d.boundingbox.map(Number) : null,
        })).filter((p) => Number.isFinite(p.ll[0]) && Number.isFinite(p.ll[1]));
        geoCache.set(key, list);
      }
      if (seq !== geoSeq) return;
      renderResults(list, note(list.length ? 'Search © OpenStreetMap contributors (Nominatim)' : `No OpenStreetMap results for “${q}” in Singapore`));
      if (items[0]) setSel(0);
    } catch (e) {
      if (seq !== geoSeq) return;
      renderResults([], note(`OpenStreetMap search is unavailable (${e.message || e}). The built-in places still work.`));
    }
  }
  function pick(p) {
    if (p.id === 'osm') return; // handled by its own button
    renderResults([]); input.blur(); goTo(p);
  }
  function setSel(i) {
    items.forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    sel = i; if (items[i]) { items[i].scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', items[i].id); }
  }
  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => { if (input.value.trim()) onInput(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setSel((sel + 1) % items.length); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setSel((sel - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const b = items[sel >= 0 ? sel : 0]; if (b) b.click(); else if (input.value.trim().length >= 3) geocode(input.value.trim()); }
    else if (e.key === 'Escape') { renderResults([]); input.blur(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) renderResults([]); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/') { e.preventDefault(); input.focus(); }
    else if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) locBtn.click();
  });

  /* ---------------- sun: light direction, colour and sky for a Singapore date + time ---------------- */
  const sun = { date: todaySGT(), min: 0, playing: false };
  { const m = nowMinutesSGT(); sun.min = m >= 420 && m <= 1140 ? Math.round(m / 5) * 5 : 600; }
  const dateIn = $('#sunDate'), timeIn = $('#sunTime'), playBtn = $('#sunPlay'), readOut = $('#sunRead');
  dateIn.value = sun.date; timeIn.value = sun.min;

  function lightFor(el) {
    // MapLibre shades a wall facing away from the light at (1 - intensity), so this keeps shaded walls light grey
    if (el >= 0) return { color: mixHex('#FFB27A', '#FFFFFF', smooth(2, 35, el)), intensity: 0.24 + 0.16 * smooth(0, 20, el) };
    return { color: mixHex('#E8A27A', '#7D8BB4', smooth(0, 10, -el)), intensity: 0.3 };
  }
  let lastSun = null;
  function applySun() {
    const c = map.getCenter();
    const p = sunPosition(sgtDate(sun.date, sun.min), c.lat, c.lng);
    const t = sunTimesAt(sun.date, c.lat, c.lng);
    lastSun = { ...p, date: sun.date, minutes: sun.min, rise: t.rise, set: t.set, noon: t.noon };
    readOut.textContent = p.el > 0 ? `${hhmm(sun.min)} SGT · sun ${Math.round(p.el)}° up, ${compass(p.az)} (${Math.round(p.az)}°)` : `${hhmm(sun.min)} SGT · sun below the horizon`;
    readOut.title = `Sunrise ${hhmm(t.rise)} · solar noon ${hhmm(t.noon)} · sunset ${hhmm(t.set)}`;
    if (!styleReady) return;
    const L = lightFor(p.el);
    map.setLight({ anchor: 'map', position: [1.15, p.az, clamp(90 - p.el, 0, 89)], color: L.color, intensity: L.intensity });
    const k = skyHexAt(p.el);
    map.setSky({
      'sky-color': k.zen, 'horizon-color': mixHex(k.hor, k.warm, k.amt * 0.7), 'fog-color': k.hor,
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6,
    });
  }
  dateIn.addEventListener('change', () => { if (dateIn.value) { sun.date = dateIn.value; applySun(); } });
  timeIn.addEventListener('input', () => { sun.min = +timeIn.value; applySun(); });

  let playT = 0, playRaf = 0;
  const MIN_PER_SEC = 60; // one simulated hour per second
  function setPlaying(on) {
    sun.playing = on; playBtn.setAttribute('aria-pressed', String(on)); playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.title = on ? 'Pause' : 'Play the day';
    cancelAnimationFrame(playRaf);
    if (!on) return;
    playT = performance.now();
    const step = (now) => {
      const dt = Math.min(0.25, (now - playT) / 1000); playT = now;
      let m = sun.min + dt * MIN_PER_SEC;
      if (m > +timeIn.max) m = +timeIn.min;
      sun.min = m; timeIn.value = Math.round(m); applySun();
      playRaf = requestAnimationFrame(step);
    };
    playRaf = requestAnimationFrame(step);
  }
  playBtn.addEventListener('click', () => setPlaying(!sun.playing));

  const btnSun = $('#btnSun');
  function setSunBar(on) { document.body.classList.toggle('sun-off', !on); btnSun.setAttribute('aria-pressed', String(on)); store.set({ sunOn: on }); if (!on) setPlaying(false); }
  btnSun.addEventListener('click', () => setSunBar(document.body.classList.contains('sun-off')));
  setSunBar(saved.sunOn !== false);
  applySun();

  /* ---------------- live location: an original rocket pin, accuracy circle, follow mode ----------------
     Uses the browser's Geolocation API only. The position stays on this device: it is not sent
     anywhere and not saved. The rocket stands upright while you are still and points along your
     direction of travel while you move (the device's heading, else the bearing between fixes). */
  const LOC = { watch: null, on: false, follow: false, fix: null, prev: null, heading: null, movedAt: 0, first: false, shown: false };
  const R_EARTH = 6371008.8;
  const distM = (a, b) => { const p1 = a[1] * Math.PI / 180, p2 = b[1] * Math.PI / 180, dp = p2 - p1, dl = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.sqrt(h)); };
  const bearingDeg = (a, b) => { const p1 = a[1] * Math.PI / 180, p2 = b[1] * Math.PI / 180, dl = (b[0] - a[0]) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
  function circle(ll, r, n = 64) {
    const out = [], lat = ll[1] * Math.PI / 180;
    for (let i = 0; i <= n; i++) { const t = (i % n) / n * 2 * Math.PI;
      out.push([ll[0] + (r * Math.sin(t)) / (R_EARTH * Math.cos(lat)) * 180 / Math.PI, ll[1] + (r * Math.cos(t)) / R_EARTH * 180 / Math.PI]); }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [out] } };
  }
  const EMPTY = { type: 'FeatureCollection', features: [] };
  function addLocLayers() {
    map.addSource('me-acc', { type: 'geojson', data: LOC.fix ? circle(LOC.fix.ll, LOC.fix.acc) : EMPTY });
    const before = map.getLayer('sg-3d') ? 'sg-3d' : undefined;
    map.addLayer({ id: 'me-acc-fill', type: 'fill', source: 'me-acc', paint: { 'fill-color': '#0A84FF', 'fill-opacity': 0.12 } }, before);
    map.addLayer({ id: 'me-acc-line', type: 'line', source: 'me-acc', paint: { 'line-color': '#0A84FF', 'line-opacity': 0.55, 'line-width': 1.2 } }, before);
  }

  // the pin: an original cartoon rocket over a location dot (the dot's centre is the position)
  const meEl = document.createElement('div');
  meEl.className = 'me'; meEl.setAttribute('aria-hidden', 'true');
  meEl.innerHTML = `<div class="me-rocket"><svg viewBox="0 0 40 66" width="36" height="59">
    <path class="me-flame" d="M14 50 Q20 70 26 50 Z" fill="#FF9F0A"/><path class="me-flame" d="M17 50 Q20 62 23 50 Z" fill="#FFE27A"/>
    <path d="M11 33 L3 48 Q3 50 5 50 L11 47 Z M29 33 L37 48 Q37 50 35 50 L29 47 Z" fill="#E5484D" stroke="#1D1D1F" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="15" y="46" width="10" height="5" rx="1.5" fill="#8E8E93" stroke="#1D1D1F" stroke-width="1.2"/>
    <path d="M20 2 C30 12 31 28 29 47 L11 47 C9 28 10 12 20 2 Z" fill="#F5F5F7" stroke="#1D1D1F" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M20 2 C25.4 7.4 28.3 13 29.5 18 L10.5 18 C11.7 13 14.6 7.4 20 2 Z" fill="#E5484D" stroke="#1D1D1F" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="20" cy="29" r="5" fill="#0A84FF" stroke="#1D1D1F" stroke-width="1.4"/><circle cx="18.4" cy="27.4" r="1.5" fill="#fff" opacity=".85"/>
    <rect x="18.6" y="38" width="2.8" height="11" rx="1.4" fill="#E5484D" stroke="#1D1D1F" stroke-width="1"/></svg></div><div class="me-dot"></div>`;
  const meMarker = new maplibregl.Marker({ element: meEl, anchor: 'center' });

  const locBtn = document.createElement('button');
  locBtn.type = 'button'; locBtn.className = 'sg-locate';
  locBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle class="fill" cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  map.addControl({ onAdd() { const d = document.createElement('div'); d.className = 'maplibregl-ctrl maplibregl-ctrl-group'; d.appendChild(locBtn); return d; }, onRemove() {} }, 'top-right');
  const LOC_LABEL = { off: 'Show my location (L)', wait: 'Finding your location… (tap to cancel)', follow: 'Following your location (tap to stop)', free: 'Centre on my location', error: 'Location unavailable (tap to try again)' };
  function setLocState(s) { locBtn.dataset.state = s; locBtn.title = LOC_LABEL[s]; locBtn.setAttribute('aria-label', LOC_LABEL[s]); locBtn.setAttribute('aria-pressed', String(s === 'follow' || s === 'free' || s === 'wait')); }
  setLocState('off');
  const chip = $('#locChip');
  function locChip(text, kind) { chip.textContent = text || ''; chip.hidden = !text; chip.className = kind || ''; }

  function centreOnMe(first) {
    if (!LOC.fix || !inBounds(LOC.fix.ll)) return;
    const o = { center: LOC.fix.ll, essential: true };
    if (reducedMotion()) o.duration = 0;
    if (first) map.flyTo({ ...o, zoom: Math.max(map.getZoom(), 16.5), pitch: Math.max(map.getPitch(), 45) });
    else map.easeTo({ ...o, duration: o.duration === 0 ? 0 : 600 });
  }
  function onFix(pos) {
    if (!LOC.on) return;
    const c = pos.coords, now = Date.now();
    const fix = { ll: [c.longitude, c.latitude], acc: Math.max(1, c.accuracy || 0) };
    // direction of travel: the device's own heading when it is moving, else the bearing since the last clearly-separate fix
    if (Number.isFinite(c.heading) && c.heading !== null && (c.speed == null || c.speed > 0.7)) { LOC.heading = c.heading; LOC.movedAt = now; LOC.prev = fix; }
    else if (!LOC.prev) LOC.prev = fix;
    else if (distM(LOC.prev.ll, fix.ll) > Math.max(8, 0.5 * (fix.acc + LOC.prev.acc))) { LOC.heading = bearingDeg(LOC.prev.ll, fix.ll); LOC.movedAt = now; LOC.prev = fix; }
    if (LOC.heading != null && now - LOC.movedAt > 20000) LOC.heading = null; // still for 20 s: back on the pad
    LOC.fix = fix;
    meMarker.setLngLat(fix.ll);
    if (!LOC.shown) { meMarker.addTo(map); LOC.shown = true; }
    const moving = LOC.heading != null;
    meEl.classList.toggle('moving', moving);
    if (moving) { meMarker.setRotationAlignment('map'); meMarker.setPitchAlignment('map'); meMarker.setRotation(LOC.heading); }
    else { meMarker.setRotationAlignment('viewport'); meMarker.setPitchAlignment('viewport'); meMarker.setRotation(0); }
    const src = map.getSource('me-acc'); if (src) src.setData(circle(fix.ll, fix.acc));
    if (!inBounds(fix.ll)) { locChip('You are outside the map area (Singapore), so the map stays where it is.', 'warn'); }
    else {
      locChip(`You are here · ±${Math.round(fix.acc)} m${moving ? ` · heading ${compass(LOC.heading)}` : ''}`);
      if (LOC.follow && (LOC.first || !map.isMoving())) centreOnMe(LOC.first);
    }
    LOC.first = false;
    setLocState(LOC.follow ? 'follow' : 'free');
  }
  function onLocErr(err) {
    if (!LOC.on) return;
    if (err.code === 1) { locStop(); setLocState('error'); locChip('Location is blocked for this page. Allow location for this site in your browser settings, then tap the button again.', 'err'); return; }
    if (!LOC.fix) setLocState('wait');
    locChip(err.code === 3 ? 'Still looking for your position…' : 'Your position is unavailable right now (no GPS or network fix). Still trying…', 'warn');
  }
  function locStart() {
    if (!('geolocation' in navigator)) { setLocState('error'); locChip('This browser has no location service.', 'err'); return; }
    if (!window.isSecureContext) { setLocState('error'); locChip('Location needs a secure (https) page.', 'err'); return; }
    Object.assign(LOC, { on: true, follow: true, first: true, fix: null, prev: null, heading: null });
    setLocState('wait'); locChip('Finding your location…');
    LOC.watch = navigator.geolocation.watchPosition(onFix, onLocErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function locStop() {
    if (LOC.watch != null) navigator.geolocation.clearWatch(LOC.watch);
    Object.assign(LOC, { watch: null, on: false, follow: false, fix: null, prev: null, heading: null });
    if (LOC.shown) { meMarker.remove(); LOC.shown = false; }
    const src = map.getSource('me-acc'); if (src) src.setData(EMPTY);
    setLocState('off'); locChip('');
  }
  locBtn.addEventListener('click', () => {
    if (!LOC.on) return locStart();
    if (LOC.fix && !LOC.follow) { LOC.follow = true; LOC.first = false; centreOnMe(true); setLocState('follow'); return; }
    locStop();
  });
  map.on('dragstart', () => { if (LOC.on && LOC.follow) { LOC.follow = false; setLocState(LOC.fix ? 'free' : 'wait'); } });
  function stopFollowing() { if (LOC.on && LOC.follow) { LOC.follow = false; setLocState(LOC.fix ? 'free' : 'wait'); } }

  /* debug / test hooks (?debug) */
  if (/[?&]debug\b/.test(location.search)) window.__sg = { map, PLACES, goTo, applySun, sun, lastSun: () => lastSun, setPlaying, geocode, matchPlaces, CFG, styleReady: () => styleReady, LOC, meMarker };
})();
