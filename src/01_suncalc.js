/* =====================================================================
   01 SUNCALC — pure solar maths shared by both pages (estate model and
   Singapore map): NOAA solar position, Singapore time (UTC+8, no DST)
   ===================================================================== */

const SGT_OFFSET_MIN = 8 * 60;
/** UTC instant for a Singapore local date ('YYYY-MM-DD') + minutes after midnight */
function sgtDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + (minutes - SGT_OFFSET_MIN) * 60000);
}
function todaySGT() {
  const t = new Date(Date.now() + SGT_OFFSET_MIN * 60000);
  return t.toISOString().slice(0, 10);
}
/** NOAA solar position (spreadsheet algorithm). Returns degrees: az (from N, clockwise), el (incl. refraction) */
function sunPosition(date, lat, lon) {
  const rad = Math.PI / 180, d2r = (x) => x * rad, r2d = (x) => x / rad;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(d2r(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(d2r(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(d2r(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(d2r(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(d2r(omega));
  const decl = r2d(Math.asin(Math.sin(d2r(eps)) * Math.sin(d2r(lambda))));
  const y = Math.tan(d2r(eps / 2)) ** 2;
  const eqTime = 4 * r2d(y * Math.sin(2 * d2r(L0)) - 2 * e * Math.sin(d2r(M)) + 4 * e * y * Math.sin(d2r(M)) * Math.cos(2 * d2r(L0)) - 0.5 * y * y * Math.sin(4 * d2r(L0)) - 1.25 * e * e * Math.sin(2 * d2r(M)));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let tst = (utcMin + eqTime + 4 * lon) % 1440; if (tst < 0) tst += 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cosZ = Math.sin(d2r(lat)) * Math.sin(d2r(decl)) + Math.cos(d2r(lat)) * Math.cos(d2r(decl)) * Math.cos(d2r(ha));
  const zen = r2d(Math.acos(Math.min(1, Math.max(-1, cosZ))));
  let el = 90 - zen;
  // atmospheric refraction (NOAA)
  let refr = 0;
  if (el > 85) refr = 0;
  else if (el > 5) refr = (58.1 / Math.tan(d2r(el)) - 0.07 / Math.tan(d2r(el)) ** 3 + 0.000086 / Math.tan(d2r(el)) ** 5) / 3600;
  else if (el > -0.575) refr = (1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))) / 3600;
  else refr = (-20.772 / Math.tan(d2r(el))) / 3600;
  el += refr;
  const azDen = Math.cos(d2r(lat)) * Math.sin(d2r(zen));
  let az;
  if (Math.abs(azDen) < 1e-9) az = lat > decl ? 180 : 0;
  else {
    const cosAz = Math.min(1, Math.max(-1, ((Math.sin(d2r(lat)) * Math.cos(d2r(zen))) - Math.sin(d2r(decl))) / azDen));
    az = ha > 0 ? (r2d(Math.acos(cosAz)) + 180) % 360 : (540 - r2d(Math.acos(cosAz))) % 360;
  }
  return { az, el, elGeo: 90 - zen, decl, eqTime };
}

/** sunrise / sunset / solar noon in SGT minutes for a place (1-minute scan).
    Rise/set: geometric centre at -0.833° (standard refraction + semi-diameter), linearly interpolated. */
function sunTimesAt(dateStr, lat, lon) {
  const H = -0.833, at = (m) => sunPosition(sgtDate(dateStr, m), lat, lon);
  let rise = null, set = null, noon = 0, best = -99, prev = at(0).elGeo;
  for (let m = 1; m < 1440; m++) {
    const p = at(m), el = p.elGeo;
    if (prev < H && el >= H && rise === null) rise = m - 1 + (H - prev) / (el - prev);
    if (prev >= H && el < H) set = m - 1 + (prev - H) / (prev - el);
    if (p.el > best) { best = p.el; noon = m; }
    prev = el;
  }
  return { rise, set, noon, maxEl: best };
}
const hhmm = (m) => { if (m == null) return '—'; const t = Math.round(m); return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/* sky colours by sun elevation (deg): zenith, horizon, warm glow towards the sun, glow amount */
const SKY_KEYS_HEX = [
  { el: -18, zen: '#070D18', hor: '#141D2E', warm: '#141D2E', amt: 0 },
  { el: -9, zen: '#0E1830', hor: '#2B3754', warm: '#5B4A63', amt: 0.35 },
  { el: -3, zen: '#2E4468', hor: '#9E8E9A', warm: '#E8946A', amt: 0.85 },
  { el: 2, zen: '#5F83B0', hor: '#E2CDB8', warm: '#F4B27A', amt: 0.8 },
  { el: 8, zen: '#7FA4CC', hor: '#E8E2D6', warm: '#F6CF9C', amt: 0.4 },
  { el: 16, zen: '#8AB1D8', hor: '#E4EAEF', warm: '#F3E2C2', amt: 0.1 },
  { el: 90, zen: '#8DB4DA', hor: '#E3E9EE', warm: '#E3E9EE', amt: 0 },
];
/** '#RRGGBB' mix in sRGB, t in [0,1] */
function mixHex(a, b, t) {
  const p = (h, i) => parseInt(h.slice(i, i + 2), 16), u = Math.min(1, Math.max(0, t));
  return '#' + [1, 3, 5].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * u).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** keyframed sky colours (hex strings) for a sun elevation */
function skyHexAt(el) {
  const K = SKY_KEYS_HEX;
  let i = 0; while (i < K.length - 2 && el > K[i + 1].el) i++;
  const a = K[i], b = K[i + 1], t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
  return { zen: mixHex(a.zen, b.zen, t), hor: mixHex(a.hor, b.hor, t), warm: mixHex(a.warm, b.warm, t), amt: a.amt + (b.amt - a.amt) * t };
}
