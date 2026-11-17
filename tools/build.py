#!/usr/bin/env python3
"""Inline data, CSS and JS modules into one self-contained index.html.

  python3 tools/build.py                          # public build -> ./index.html
  python3 tools/build.py --preset-flat 439A,160,12 --out private.html
      # optional private build that opens with a flat preselected (block,unit,storey)
"""
import argparse, glob, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'index.html'))
ap.add_argument('--preset-flat', default=None, help='BLOCK,UNIT,STOREY e.g. 439A,160,12')
a = ap.parse_args()

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
html = open(os.path.join(ROOT, 'src', 'template.html')).read().replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
open(a.out, 'w').write(html)
print('built', a.out, os.path.getsize(a.out), 'bytes', '(preset flat)' if a.preset_flat else '(public)')
