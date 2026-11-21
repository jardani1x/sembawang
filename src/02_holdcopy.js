/* =====================================================================
   02 HOLD-TO-COPY — shared by both pages (estate model and Singapore map).
   Press and hold (touch or mouse, ~0.55 s, without moving) on the map: the
   coordinates of that spot appear in a card, and are copied to the clipboard
   when you let go. The copy happens on release because browsers (iOS Safari
   in particular) only let a page write to the clipboard inside a user action,
   and a touch counts as one when the finger lifts. If copying is blocked, the
   card's Copy button tries again (a tap is always a user action).
   Format: "lat, lon" in decimal degrees (WGS84), 6 decimals ≈ 0.1 m, which
   Google Maps, Apple Maps and OneMap search all accept.
   ===================================================================== */
const HOLD_MS = 550, HOLD_SLOP_PX = 10;

const fmtLatLon = (lat, lon) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
const mapsLink = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;

/** write text to the clipboard; resolves true/false. Call from inside a user action (pointerup, click). */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* blocked (permissions policy, no user action): try the older way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}

/** long-press detector on an element (pointer events: mouse, touch and pen alike) */
function onLongPress(el, { enabled = () => true, onDown, cancelIf, onHold, onRelease, onCancel }) {
  let h = null, lastType = 'mouse';
  const clear = () => { if (h) { clearTimeout(h.t); h = null; } };
  el.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType;
    if (h) { clear(); return; } // a second finger: pinch or rotate, not a hold
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (onDown) onDown(e);
    if (!enabled()) return;
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, fired: false };
    // when the timer is due, first let queued input run (a busy page can deliver a drag's moves late), then
    // also refuse if the view moved meanwhile: a drag is not a hold
    s.t = setTimeout(() => requestAnimationFrame(() => {
      if (h !== s) return;
      if (cancelIf && cancelIf()) { clear(); return; }
      s.fired = true; onHold(s.x, s.y, s.type);
    }), HOLD_MS);
    h = s;
  });
  el.addEventListener('pointermove', (e) => {
    if (h && e.pointerId === h.id && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) clear();
  });
  el.addEventListener('pointerup', (e) => { if (!h || e.pointerId !== h.id) return; const s = h; clear(); if (s.fired && onRelease) onRelease(e); });
  el.addEventListener('pointercancel', (e) => { if (!h || e.pointerId !== h.id) return; const s = h; clear(); if (s.fired && onCancel) onCancel(e); });
  // Android opens a context menu on a long touch; desktop right-click keeps its usual behaviour
  el.addEventListener('contextmenu', (e) => { if ((h && h.fired) || lastType === 'touch' || lastType === 'pen') e.preventDefault(); });
}

/** the coordinates card (one per page), built on first use */
const coordCard = (() => {
  let el = null, cur = null, onClose = null;
  const css = `.cc{position:fixed;left:50%;top:calc(var(--top,56px) + 12px);transform:translateX(-50%);z-index:45;width:min(420px,calc(100% - 24px));
    background:rgba(255,255,255,.97);color:#1D1D1F;border:1px solid rgba(0,0,0,.1);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.16);
    padding:10px 12px;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    .cc[hidden]{display:none}.cc-row{display:flex;align-items:center;gap:8px}
    .cc-ll{flex:1;min-width:0;font:600 15px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;user-select:all;-webkit-user-select:all;overflow-wrap:anywhere}
    .cc button,.cc a{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(0,0,0,.12);background:#fff;color:#1D1D1F;font-weight:600;font-size:13px;line-height:30px;font-family:inherit;cursor:pointer;text-decoration:none;white-space:nowrap}
    .cc .cc-copy{background:#0071E3;border-color:#0071E3;color:#fff}.cc .cc-x{width:32px;padding:0;font-size:20px;line-height:30px;border:0;background:none;color:#6E6E73}
    .cc-sub{margin-top:4px;color:#6E6E73;font-size:12px}.cc-sub b{font-weight:600}.cc-sub .ok{color:#1A7F37}.cc-sub .warn{color:#B25E09}
    .cc-dot{width:16px;height:16px;border-radius:50%;background:#E5484D;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);pointer-events:none;box-sizing:border-box}
    canvas{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
    @media (max-width:440px){.cc{padding:9px 10px}.cc-row{gap:6px}.cc-ll{font-size:13px;white-space:nowrap;overflow-wrap:normal}.cc button,.cc a{padding:0 9px}.cc .cc-x{width:26px}}`;
  function ensure() {
    if (el) return el;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('div'); el.className = 'cc'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Coordinates');
    el.innerHTML = '<div class="cc-row"><span class="cc-ll"></span><button type="button" class="cc-copy">Copy</button><a class="cc-map" target="_blank" rel="noopener" title="Open in Google Maps">Map</a><button type="button" class="cc-x" aria-label="Close">×</button></div><div class="cc-sub"><span class="cc-what"></span> · <span class="cc-status" role="status" aria-live="polite"></span></div>';
    el.querySelector('.cc-copy').addEventListener('click', () => { if (cur) copyNow(); });
    el.querySelector('.cc-x').addEventListener('click', hide);
    document.body.appendChild(el);
    return el;
  }
  function status(text, kind) { const s = ensure().querySelector('.cc-status'); s.textContent = text; s.className = 'cc-status ' + (kind || ''); }
  function show(p, close) {
    if (onClose && cur) onClose();
    ensure(); cur = p; onClose = close || null;
    el.querySelector('.cc-ll').textContent = fmtLatLon(p.lat, p.lon);
    el.querySelector('.cc-what').textContent = p.what || '';
    el.querySelector('.cc-map').href = mapsLink(p.lat, p.lon);
    status('let go to copy'); el.hidden = false;
    document.body.classList.add('cc-open');
  }
  function hide() {
    if (!el || el.hidden) return;
    el.hidden = true; document.body.classList.remove('cc-open');
    if (onClose) { const f = onClose; onClose = null; f(); }
    cur = null;
  }
  function copyNow() {
    const text = fmtLatLon(cur.lat, cur.lon);
    return copyText(text).then((ok) => { status(ok ? 'copied' : 'couldn’t copy automatically: tap Copy', ok ? 'ok' : 'warn'); return ok; });
  }
  return { show, hide, status, copyNow, ready: ensure, current: () => cur, el: () => el };
})();

/** wire hold-to-copy onto a map element. locate(x, y) → { lat, lon, what } | null; mark(p) → remove() for a spot marker */
function holdToCopy(el, { enabled = () => true, locate, mark, onDown, viewMoved }) {
  coordCard.ready(); // styles in place before the first hold (stops iOS's callout on the map)
  onLongPress(el, {
    enabled,
    onDown(e) { coordCard.hide(); if (onDown) onDown(e); }, // touching the map again dismisses the last card
    cancelIf: viewMoved,
    onHold(x, y) {
      const p = locate(x, y);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not allowed */ } }
      const unmark = mark ? mark(p) : null;
      coordCard.show(p, unmark);
    },
    onRelease() { if (coordCard.current()) coordCard.copyNow(); },
    onCancel() { if (coordCard.current()) coordCard.status('tap Copy to copy', 'warn'); },
  });
}
