#!/usr/bin/env python3
"""Build the SITE dataset for the Sembawang Brook 3D model.

Source: data/source/siteplan.json (measured from the brochure site plan at
0.70671 m/px) with corrections from an independent geometry review, plus
data/source/courtyard.json (paved areas, tools/segment_courtyard.py).
Output: data/site-data.json.

Conventions (world): +X east, +Z south, +Y up, metres. Origin = SW outer corner
of Blk 436. Buildings are stored in the estate LOCAL frame (u along the block
rows, bearing 64.5 deg; v across, bearing 154.5 deg). A Three.js group with
rotation.y = +GRID_RAD maps local (x=u, z=v) to world.
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SRC = os.path.join(ROOT, 'data', 'source', 'siteplan.json')
OUT = os.path.join(ROOT, 'data', 'site-data.json')

SCALE_SRC = 0.70671          # m/px used by siteplan.json
SCALE = 0.708                # unified scale (3 independent measurements, +-0.2%)
K = SCALE / SCALE_SRC        # rescale factor about the origin
GRID_DEG = 25.5
EXT = 1.4                    # model faces run ~1.4 m beyond plan pads at each end (critic, camera fit)

def r(x, n=2):
    return round(x * 1.0, n)

def sc(p):
    return [r(p[0] * K), r(p[1] * K)]

def scl(pts):
    return [sc(p) for p in pts]

s = json.load(open(SRC))
# georeference: site frame -> WGS84 (fitted to OpenStreetMap building outlines; tools in tools/ + data/source/georef.json)
GEOREF = json.load(open(os.path.join(ROOT, 'data', 'source', 'georef.json')))
def _unproj(x, z):
    r = math.pi / 180; g = GEOREF
    return (g['lat0'] - (z + g['tz']) / (r * g['M']), g['lon0'] + (x + g['tx']) / (r * g['N'] * math.cos(g['lat0'] * r)))
GEO_CENTRE = _unproj(170.0 * K, -80.0 * K)
B = {b['id']: b for b in s['buildings']}

# Bays per pad (pair of flats unless noted) - counted on model photos 01/02 (critic)
BAYS_PAIR = {'4R': 8, '5R': 9, '3R': 6, '2RF-T1': 4, '2RF-T2': 4, '3GEN': 10, 'RENTAL': 4}

def pad(p, face):
    u, v = p['centreLocal']
    lu, lv = p['sizeLocal_uv_m']
    units = sorted(p['units'], key=lambda x: int(x)) if p['units'][0].isdigit() else []
    pair = len(units) == 2
    t = p['flatType'].upper().replace('3GEN', '3GEN')
    bays = BAYS_PAIR.get(t, 4) if pair else max(2, round(BAYS_PAIR.get(t, 4) / 2 + 0.01))
    # Unit order along the face, west->east (increasing u). Numbering runs clockwise
    # (seen from above, north up): north rows ascend W->E, south rows ascend E->W.
    if face == 'N':
        we = units
    elif face == 'S':
        we = list(reversed(units))
    else:
        we = units
    return {'units': units, 'unitsWE': we, 'type': t, 'u': r(u * K), 'v': r(v * K),
            'lu': r(lu * K), 'lv': r(lv * K), 'bays': bays, 'face': face}

def P(bid, units):
    for p in B[bid]['pads']:
        if p['units'] == units:
            return p
    raise KeyError((bid, units))

def core(bid):
    c = B[bid]['core']
    return {'u': r(c['centreLocal'][0] * K), 'v': r(c['centreLocal'][1] * K),
            'lu': c['sizeLocal_uv_m'][0], 'lv': c['sizeLocal_uv_m'][1]}

# 437A: critic - labels 116/118 probably swapped on our read (numbering pattern):
# east green 3R pad = #116, west orange 5R pad = #118. Flat TYPES/positions certain.
p116 = dict(P('437A', ['116'])); p116 = {**p116, 'units': ['118']}
p118 = dict(P('437A', ['118'])); p118 = {**p118, 'units': ['116']}

blocks = [
  {'id': '437A', 'storeys': 30, 'unitsPerFloor': 10, 'kind': 'sale',
   'mix': {'2RF-T1': 58, '3R': 29, '4R': 116, '5R': 87}, 'total': 290,
   'core': core('437A'),
   'towers': [
     {'side': 'W', 'scheme': 'B', 'tanks': 7, 'rows': [
        {'face': 'N', 'pads': [pad(P('437A', ['104', '106']), 'N')]},
        {'face': 'S', 'pads': [pad(P('437A', ['100', '102']), 'S')]}]},
     {'side': 'E', 'scheme': 'A', 'tanks': 6, 'rows': [
        {'face': 'N', 'pads': [pad(P('437A', ['112', '114']), 'N')]},
        {'face': 'S', 'pads': [pad(p116, 'S'), pad(p118, 'S')]}]}],
   'link': [pad(P('437A', ['108', '110']), 'N')],
   'notes': ['Unit labels #116 (3-Room, east) and #118 (5-Room, west) follow the clockwise numbering used by every other block; the brochure digits are illegible at this resolution [Unverified]. Flat types and positions are certain.',
             '2-Room Flexi link (#108/#110) is set back ~1.8 m from the west tower face [Measured].']},
  {'id': '437B', 'storeys': 30, 'unitsPerFloor': 9, 'kind': 'sale',
   'mix': {'2RF-T2': 58, '4R': 58, '5R': 116, '3GEN': 29}, 'total': 261,
   'core': core('437B'),
   'towers': [
     {'side': 'W', 'scheme': 'B', 'tanks': 6, 'rows': [
        {'face': 'N', 'pads': [pad(P('437B', ['124', '126']), 'N')]},
        {'face': 'S', 'pads': [pad(P('437B', ['120', '122']), 'S')]}]},
     {'side': 'E', 'scheme': 'A', 'tanks': 3, 'rows': [
        {'face': 'N', 'pads': [pad(P('437B', ['132', '134']), 'N')]},
        {'face': 'S', 'pads': [pad(P('437B', ['136']), 'S')]}]}],
   'link': [pad(P('437B', ['128', '130']), 'N')],
   'notes': ['East tower is set back ~6 m behind the west tower and has a single 3Gen stack (#136) on its south side [Measured].']},
  {'id': '438A', 'storeys': 26, 'unitsPerFloor': 8, 'kind': 'rental',
   'mix': {'1R-RENT': 100, '2R-RENT': 100}, 'total': 200,
   'core': core('438A'),
   'points': [
     {'side': 'W', 'scheme': 'B', 'tanks': 2, **{k: v for k, v in pad(P('438A', ['4 units (W tower)']), 'N').items() if k in ('u', 'v', 'lu', 'lv')}},
     {'side': 'E', 'scheme': 'A', 'tanks': 1, **{k: v for k, v in pad(P('438A', ['4 units (E tower)']), 'N').items() if k in ('u', 'v', 'lu', 'lv')}}],
   'notes': ['All 200 flats are rental (100 1-Room, 100 2-Room); the brochure does not say which tower holds which type, and unit numbers are not printed.',
             '"RENTAL" is the west tower\'s roof label; both towers are rental.']},
  {'id': '439A', 'storeys': 30, 'unitsPerFloor': 10, 'kind': 'sale',
   'mix': {'2RF-T2': 58, '3R': 58, '4R': 58, '5R': 116}, 'total': 290,
   'core': core('439A'),
   'towers': [
     {'side': 'W', 'scheme': 'B', 'tanks': 6, 'rows': [
        {'face': 'N', 'pads': [pad(P('439A', ['158', '160']), 'N')]},
        {'face': 'S', 'pads': [pad(P('439A', ['154', '156']), 'S')]}]},
     {'side': 'E', 'scheme': 'A', 'tanks': 5, 'rows': [
        {'face': 'N', 'pads': [pad(P('439A', ['166', '168']), 'N')]},
        {'face': 'S', 'pads': [pad(P('439A', ['170', '172']), 'S')]}]}],
   'link': [pad(P('439A', ['162', '164']), 'N')],
   'notes': ['East tower sits ~8 m south of the west tower [Measured].', '3-Room pad #166/#168 position is +-2 m [Measured-manual].']},
  {'id': '440A', 'storeys': 30, 'unitsPerFloor': 11, 'kind': 'sale',
   'mix': {'2RF-T2': 87, '4R': 232}, 'total': 319,
   'core': core('440A'),
   'towers': [
     {'side': 'W', 'scheme': 'B', 'tanks': 6, 'rows': [
        {'face': 'N', 'pads': [pad(P('440A', ['192', '194']), 'N')]},
        {'face': 'S', 'pads': [pad(P('440A', ['188', '190']), 'S')]}]},
     {'side': 'E', 'scheme': 'A', 'tanks': 4, 'rows': [
        {'face': 'N', 'pads': [pad(P('440A', ['174', '176']), 'N')]},
        {'face': 'S', 'pads': [pad(P('440A', ['180', '182']), 'S')]}]}],
   'link': [pad(P('440A', ['184', '186']), 'S')],
   'tip': pad(P('440A', ['178']), 'E'),
   'notes': ['East tower sits ~10 m north of the west tower [Measured].', '2-Room Flexi #178 faces east at the tip; #184/#186 face south in the link.']},
]

b436 = B['436']
mscp = {'id': '436', 'storeys': 8,
        'westWing': {'u0': r(2.0 * K), 'u1': r(38.7 * K), 'v0': r(-81.0 * K), 'v1': r(-2.0 * K)},
        # critic: south wing extends to the drum's east edge
        'southWing': {'u0': r(38.7 * K), 'u1': r((107.49 + 12.7) * K), 'v0': r(-19.7 * K), 'v1': r(-2.0 * K)},
        'ramp': {'u': r(107.49 * K), 'v': r(-19.83 * K), 'r': r(12.7 * K)},
        'height': 24.0,
        'uses': {'1': 'Preschool, electrical sub-station (ESS), bin centre (pneumatic waste conveyance)',
                 '2': 'Preschool, future amenities/facilities'},
        'notes': ['8 storeys [Read]; roof-garden height ~24 m is an estimate (no heights in the brochure).',
                  'West-wing length is +-8 m (plan vs Blk 436 mini-plan disagree slightly).',
                  'Roof garden contents placed from model photo IMG_1985 - representative, not surveyed.']}

def lowrise(bid, use, h, storeys):
    b = B[bid]
    return {'id': bid, 'use': use, 'u': r(b['centreLocal'][0] * K), 'v': r(b['centreLocal'][1] * K),
            'lu': r(b['sizeLocal_uv_m'][0] * K), 'lv': r(b['sizeLocal_uv_m'][1] * K), 'height': h, 'storeys': storeys}

low = [lowrise('437', 'Precinct pavilion', 4.5, 1),
       lowrise('(437B porch)', 'Drop-off porch', 4.5, 1),
       lowrise('438', 'Precinct pavilion', 4.5, 1),
       lowrise('439', 'Precinct pavilion + drop-off porch', 4.5, 1)]
low[1]['id'] = 'porch'
# 440 commercial + 441 ESS: world polygons (plan); heights estimated
poly440 = [scl(v) for v in B['440']['partsWorld'].values()]
poly441 = scl(B['441']['essWorld'])

RENAME = {  # strip analyst working notes from user-facing names
  'marker printed on 440A units 188/190 \u2014 likely 8 (RNC at 1st storey)': ("Residents' Network Centre (likely)", 'Blk 440A, 1st storey', '[Unverified: the marker digit looks like 8 = RNC in the legend]'),
  'unidentified (2 or 3)': ('Fitness station (marker illegible)', 'ground, south of Blk 436', '[Unverified: marker digit is 2 or 3]'),
  'adult fitness station (?)': ('Adult fitness station (unverified)', None, None),
  'hardcourt (?)': ('Hardcourt (unverified)', None, None),
}
facilities = []
for f in s['facilities']:
    if f['world'] is None:
        continue
    name, where, conf = f['name'], f['where'], f['conf']
    if name in RENAME:
        n2, w2, c2 = RENAME[name]; name = n2; where = w2 or where; conf = c2 or conf
    facilities.append({'name': name, 'where': where, 'x': r(f['world'][0] * K), 'z': r(f['world'][1] * K),
                       'conf': conf, 'onRoof': 'roof' in f['where'].lower()})
assert not any('marker printed' in f['name'] or '(?)' in f['name'] for f in facilities)
# heavy vehicle park: the plan shows only a label + dot (no extent) -> a context pin, not a polygon
facilities.append({'name': 'Heavy vehicle park (nearby)', 'where': 'NE of the estate, beyond the school site. Brochure note 9: possible disamenities such as higher noise levels.',
                   'x': r((735 - 221.7) * SCALE), 'z': r((113 - 422.4) * SCALE), 'conf': '[Read: label + dot on the site plan; extent not shown]', 'onRoof': False, 'context': True})

roads = [{'name': x['name'], 'status': x['status'], 'width': x['width_m'], 'line': scl(x['centrelineWorld']), 'conf': x['conf'],
          # roads traced as an outline from the plan (e.g. Admiralty Close with its turning loop): drawn as that shape
          **({'poly': scl(x['polygonWorld']), 'widthRange': x['widthRange_m']} if 'polygonWorld' in x else {})}
         for x in s['roads']]
canal = s['water'][0]
water = {'east': scl(canal['eastBankWorld']), 'west': scl(canal['westBankWorld'])}
drain = scl(s['water'][1]['polygonWorld'])
boundary = scl(s['boundary']['polygonWorld'])
linkways = [{'name': x['name'], 'line': scl(x['polylineWorld']), 'width': x['width_m']} for x in s['linkways']]
bus = [{'name': x['name'], 'road': x['road'], 'x': r(x['world'][0] * K), 'z': r(x['world'][1] * K)} for x in s['busBays']]
reserved = [{'name': x['name'], 'poly': scl(x['polygonWorld'])} for x in s['reservedSites'] if not x['name'].startswith('Heavy vehicle park')]
# paved courtyard / service drives (light-grey 'service' fill segmented from the plan: tools_build/courtyard.py, 0.708 m/px)
paved = [c['poly'] for c in json.load(open(os.path.join(ROOT, 'data', 'source', 'courtyard.json'))) if c['areaPx'] >= 80 and not (c['bboxPx'][0] >= 380 and c['bboxPx'][1] >= 330)]

FLAT_TYPES = {
  '2RF-T1': {'name': '2-Room Flexi (Type 1)', 'short': '2RF T1', 'rgb': [226, 181, 150]},
  '2RF-T2': {'name': '2-Room Flexi (Type 2)', 'short': '2RF T2', 'rgb': [204, 136, 115]},
  '3R': {'name': '3-Room', 'short': '3R', 'rgb': [150, 190, 105]},
  '4R': {'name': '4-Room', 'short': '4R', 'rgb': [232, 222, 96]},
  '5R': {'name': '5-Room', 'short': '5R', 'rgb': [240, 178, 80]},
  '3GEN': {'name': '3Gen', 'short': '3Gen', 'rgb': [176, 170, 162]},
  '1R-RENT': {'name': '1-Room (rental)', 'short': '1R rent', 'rgb': [242, 235, 188]},
  '2R-RENT': {'name': '2-Room (rental)', 'short': '2R rent', 'rgb': [242, 235, 188]},
}

# ---- self-checks (fail loudly) ----
tot = sum(b['total'] for b in blocks)
assert tot == 1360, tot
for b in blocks:
    assert sum(b['mix'].values()) == b['total'], b['id']
    if b['kind'] == 'sale':
        units = []
        for t in b['towers']:
            for row in t['rows']:
                for p in row['pads']:
                    units += p['units']
        for p in b['link']:
            units += p['units']
        if 'tip' in b:
            units += b['tip']['units']
        assert len(units) == b['unitsPerFloor'], (b['id'], units)
        assert b['unitsPerFloor'] * (b['storeys'] - 1) == b['total'], b['id']
        # per-type stack counts x 29 floors must equal the brochure mix
        cnt = {}
        def add(p):
            cnt[p['type']] = cnt.get(p['type'], 0) + len(p['units'])
        for t in b['towers']:
            for row in t['rows']:
                for p in row['pads']:
                    add(p)
        for p in b['link']:
            add(p)
        if 'tip' in b:
            add(b['tip'])
        for k, v in cnt.items():
            assert v * (b['storeys'] - 1) == b['mix'][k], (b['id'], k, v, b['mix'][k])
    else:
        assert b['unitsPerFloor'] * (b['storeys'] - 1) == b['total']

site = {
  'format': 'sembawang-brook-site', 'version': 1,
  'georef': GEOREF,
  'meta': {'name': 'Sembawang Brook', 'programme': 'HDB Build-To-Order 2026',
           'scale_m_per_px': SCALE, 'gridDeg': GRID_DEG, 'faceExtension_m': EXT,
           'origin': 'SW outer corner of Blk 436 (canal side x Admiralty Lane side)',
           'axes': '+X east, +Z south, +Y up (metres); buildings in local frame u (bearing 64.5) / v (bearing 154.5)',
           'latlon': [round(GEO_CENTRE[0], 6), round(GEO_CENTRE[1], 6)], 'latlonConf': 'estate centre from the OpenStreetMap building-outline fit (data/source/georef.json); used for the sun and the area view',
           'sources': ['HDB brochure site plan pp.15-16 (scale bar, north arrow, unit table)',
                       'HDB 1:300 sales model photos IMG_1981-1990 (massing, facades, roof garden)'],
           'disclaimer': 'Brochure: developments and facilities are subject to change. This model is reconstructed from the brochure and sales model; it is not a survey.'},
  'heights': {'floorToFloor': 2.8, 'voidDeck': 3.6, 'parapet': 1.2,
              'conf': '2.8 m storey consistent with model photos (2.7-2.9 m); void deck 3.6 m within the photo range 3.2-4.6 m. Neither is printed in the brochure.'},
  'flatTypes': FLAT_TYPES,
  'blocks': blocks, 'mscp': mscp, 'lowRise': low,
  'commercial440': {'id': '440', 'use': 'Eating house, shops, mini-mart (1st storey)', 'polys': poly440, 'height': 9.0, 'heightConf': 'estimated ~2 storeys from model photo 08'},
  'ess441': {'id': '441', 'use': 'Electrical sub-station', 'poly': poly441, 'height': 5.0, 'heightConf': 'estimated'},
  'roads': roads, 'canal': water, 'drainage': drain, 'boundary': boundary, 'linkways': linkways,
  'facilities': facilities, 'busBays': bus, 'reserved': reserved, 'paved': paved,
}
json.dump(site, open(OUT, 'w'), separators=(',', ':'))
print('ok', OUT, os.path.getsize(OUT), 'bytes; units', tot)
