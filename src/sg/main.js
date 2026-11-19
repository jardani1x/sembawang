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
  const start = saved.view && inBounds(saved.view.center) && Number.isFinite(saved.view.zoom) ? saved.view : CFG.home;

  let map;
  try {
    map = new maplibregl.Map({
      container: 'map', style: CFG.style,
      center: start.center, zoom: start.zoom, pitch: start.pitch, bearing: start.bearing,
      maxBounds: CFG.maxBounds, minZoom: 9, maxZoom: 19, maxPitch: 85,
      hash: 'view', attributionControl: false, canvasContextAttributes: { antialias: true },
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
    applySun();
  });

  /* ---------------- zoom hint + remembered view ---------------- */
  const hint = $('#zoomHint');
  const updateHint = () => hint.classList.toggle('off', map.getZoom() >= CFG.buildingsFrom);
  map.on('zoom', updateHint); updateHint();
  let saveT = 0;
  map.on('moveend', () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { const c = map.getCenter(); store.set({ view: { center: [+c.lng.toFixed(6), +c.lat.toFixed(6)], zoom: +map.getZoom().toFixed(2), pitch: +map.getPitch().toFixed(1), bearing: +map.getBearing().toFixed(1) } }); }, 400);
  });

  /* ---------------- camera moves ---------------- */
  function goTo(p) {
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

  /* debug / test hooks (?debug) */
  if (/[?&]debug\b/.test(location.search)) window.__sg = { map, PLACES, goTo, applySun, sun, lastSun: () => lastSun, setPlaying, geocode, matchPlaces, CFG, styleReady: () => styleReady };
})();
