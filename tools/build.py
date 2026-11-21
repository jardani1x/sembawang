#!/usr/bin/env python3
"""Inline data, CSS and JS modules into one self-contained index.html.

  python3 tools/build.py                          # public build -> ./index.html
  python3 tools/build.py --preset-flat 439A,160,12 --out private.html \
      --sg-url https://example.github.io/sembawang/singapore.html
      # optional private build that opens with a flat preselected (block,unit,storey)

The estate page's "Singapore" tab points at --sg-url (default singapore.html). A relative URL
also builds that page (src/sg/ + src/01_suncalc.js) next to --out; an absolute URL opens in a
new tab and builds nothing else (for hosts that cannot load outside map tiles).
"""
import argparse, glob, html, json, math, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'index.html'))
ap.add_argument('--preset-flat', default=None, help='BLOCK,UNIT,STOREY e.g. 439A,160,12')
ap.add_argument('--sg-url', default='singapore.html', help='target of the Singapore tab (relative: also build it)')
a = ap.parse_args()
sg_abs = bool(re.match(r'https?://', a.sg_url))
assert sg_abs or re.fullmatch(r'[\w.-]+\.html', a.sg_url), 'relative --sg-url must be a plain file name'

site = json.load(open(os.path.join(ROOT, 'data', 'site-data.json')))
preset = 'null'
if a.preset_flat:
    block, unit, storey = a.preset_flat.split(',')
    assert re.fullmatch(r'\d{3}[A-Z]?', block) and re.fullmatch(r'\d{3}', unit) and 2 <= int(storey) <= 30
    preset = json.dumps({'block': block, 'unit': unit, 'storey': int(storey)})
js = '\n'.join(open(f).read() for f in sorted(glob.glob(os.path.join(ROOT, 'src', '[0-9][0-9]_*.js'))))
js = js.replace('/*__SITE_JSON__*/null', json.dumps(site, separators=(',', ':')))
js = js.replace('/*__PRESET_FLAT__*/null', preset)
assert '__SITE_JSON__' not in js and '__PRESET_FLAT__' not in js
css = open(os.path.join(ROOT, 'src', 'style.css')).read()
page = open(os.path.join(ROOT, 'src', 'template.html')).read().replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
page = page.replace('/*__SG_URL__*/', html.escape(a.sg_url, quote=True))
page = page.replace('/*__SG_TARGET__*/', ' target="_blank" rel="noopener"' if sg_abs else '')
assert '/*__SG_' not in page
open(a.out, 'w').write(page)
print('built', a.out, os.path.getsize(a.out), 'bytes', '(preset flat)' if a.preset_flat else '(public)')

# ---------- Singapore 3D map page ----------
if not sg_abs:
    g = site['georef']; r = math.pi / 180
    kx, kz = r * g['N'] * math.cos(g['lat0'] * r), r * g['M']
    c, s_, sc = math.cos(g.get('theta') or 0), math.sin(g.get('theta') or 0), g.get('scale') or 1
    def lonlat(X, Z):  # exact inverse of osmProjector (src/75_osmconv.js): site frame -> [lon, lat]
        x, z = sc * (c * X - s_ * Z), sc * (s_ * X + c * Z)
        return [round(g['lon0'] + (x + g['tx']) / kx, 7), round(g['lat0'] - (z + g['tz']) / kz, 7)]
    pts = site['boundary']
    A = cx = cz = 0.0
    for (x0, z0), (x1, z1) in zip(pts, pts[1:] + pts[:1]):
        k = x0 * z1 - x1 * z0; A += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k
    centre = lonlat(cx / (3 * A), cz / (3 * A))
    ring = [lonlat(x, z) for x, z in pts]; ring.append(ring[0])
    sg_out = os.path.join(os.path.dirname(os.path.abspath(a.out)), a.sg_url)
    sg = {'estate': {'name': site['meta']['name'], 'centre': centre, 'ring': ring,
                     'url': os.path.relpath(os.path.abspath(a.out), os.path.dirname(sg_out))},
          # 3D location pins whose model files are present next to the page (assets/); the page offers only these
          'pins': [k for k, f in (('starship', 'starship-block3.glb'), ('f22', 'f22-raptor.glb'))
                   if os.path.isfile(os.path.join(os.path.dirname(sg_out), 'assets', f))]}
    sjs = '\n'.join(open(os.path.join(ROOT, 'src', f)).read() for f in ('01_suncalc.js', '02_holdcopy.js', os.path.join('sg', 'main.js')))
    sjs = sjs.replace('/*__SG_JSON__*/null', json.dumps(sg, separators=(',', ':')))
    assert '__SG_JSON__' not in sjs
    spage = open(os.path.join(ROOT, 'src', 'sg', 'template.html')).read()
    spage = spage.replace('/*__CSS__*/', open(os.path.join(ROOT, 'src', 'sg', 'style.css')).read()).replace('/*__JS__*/', sjs)
    spage = spage.replace('/*__ESTATE_URL__*/', html.escape(sg['estate']['url'], quote=True))
    assert '/*__' not in spage.replace('/*__SG_JSON', '')
    open(sg_out, 'w').write(spage)
    print('built', sg_out, os.path.getsize(sg_out), 'bytes', 'estate centre', centre, 'pins', sg['pins'])
