#!/usr/bin/env python3
"""Headless test of index.html: console errors, data, every control, screenshots.

Setup:  pip install playwright && python -m playwright install chromium
        sh tools/fetch_three.sh          # local three.js r160 (CDN requests are intercepted)
Run:    python3 tests/run.py [desktop|mobile|area|render|sg]
        (sg = the Singapore map page: needs vendor/maplibre-gl and node for the fixture tiles)
        OSM_EXPORT=export.geojson[:coastline.geojson] python3 tests/run.py area   # + live-update tests
"""
import subprocess, http.server, threading, functools, os, sys, json, time, math, re, io
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = ROOT                                  # serves ./index.html
VENDOR = os.path.join(ROOT, 'vendor', 'package')  # tools/fetch_three.sh
CHROME = os.environ.get('CHROME')            # optional system Chrome; default = Playwright's Chromium
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True)
CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html?debug'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(detail) if detail else ''), flush=True)

def vendor_file(url):
    """https://cdn.jsdelivr.net/npm/<name>@<ver>/<path> → vendor/package (three r160) or vendor/<name>@<ver>/package"""
    m = re.match(r'https://cdn\.jsdelivr\.net/npm/([^/]+)/(.*)$', url)
    if not m: return None
    base = VENDOR if m[1] == 'three@0.160.0' else os.path.join(ROOT, 'vendor', m[1], 'package')
    return os.path.join(base, m[2])

def route_cdn(route):
    f = vendor_file(route.request.url) or ''

    if os.path.isfile(f):
        ct = 'text/css' if f.endswith('.css') else 'application/javascript'
        route.fulfill(path=f, headers={'content-type': ct, 'access-control-allow-origin': '*'})
    else:
        route.abort()

def open_page(browser, w, h, mobile=False, name='desktop'):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1 if not mobile else 2, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error',) else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.route('https://cdn.jsdelivr.net/npm/**', route_cdn)
    page.goto(URL)
    page.wait_for_selector('body.ready', timeout=60000)
    page.wait_for_timeout(1500)
    return ctx, page, errors

only = sys.argv[1:]  # optional subset: desktop mobile
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    if not only or 'desktop' in only:
        ctx, page, errors = open_page(browser, 1440, 900)
        ev = page.evaluate
        check('loads without console errors', not errors, errors[:5])
        check('WebGL2', ev('__sb.renderer.capabilities.isWebGL2'))
        check('data validation', ev('__sb.validateSite().length === 0'), ev('__sb.validateSite()'))
        info = ev('(() => { __sb.render(); const i = __sb.info().render; return { tri: i.triangles, calls: i.calls, geos: __sb.info().memory.geometries, tex: __sb.info().memory.textures }; })()')
        check('render stats', info['calls'] < 400, info)
        page.screenshot(path=f'{SHOTS}/d01_admst.png')
        # sun accuracy vs independent expectations
        s = ev("__sb.sunAt('2026-06-21', 13*60+6)")
        check('sun Jun 21 13:06 SGT ≈ 68.0° due north', abs(s['el'] - 68.0) < 0.4 and (s['az'] < 3 or s['az'] > 357), s)
        s2 = ev("__sb.sunAt('2026-12-21', 13*60+3)")
        check('sun Dec 21 13:03 SGT (solar noon) ≈ 65.1° due south', abs(s2['el'] - 65.1) < 0.4 and abs(s2['az'] - 180) < 2, s2)
        t = ev("__sb.sunTimes('2026-03-20')")
        check('sunrise ~07:0x, sunset ~19:1x SGT (Mar equinox)', 415 <= t['rise'] <= 435 and 1150 <= t['set'] <= 1165, t)
        # presets
        for pid in ['adm-lane', 'woodlands', 'sembawang-dr', 'top', 'roof436', 'iso']:
            page.click(f'.preset[data-id="{pid}"]'); page.wait_for_timeout(1300)
            page.screenshot(path=f'{SHOTS}/d_preset_{pid}.png')
        check('presets ran', not errors, errors[:3])
        # my flat: public build has no preset; set one through the form
        check('public build has no preset flat', ev('__sb.state.settings.myUnit') is None)
        page.select_option('#muBlock', '439A'); page.select_option('#muUnit', '160'); page.fill('#muStorey', '12')
        page.click('#muForm button[type=submit]'); page.wait_for_timeout(300)
        mu = ev('__sb.state.settings.myUnit')
        check('flat set via form = 439A #12-160', mu == {'block': '439A', 'unit': '160', 'storey': 12}, mu)
        check('unit marker built', ev("__sb.L.unitMark.children.length") >= 3)
        page.wait_for_timeout(1300); page.screenshot(path=f'{SHOTS}/d02_myflat.png')
        page.click('#muSun'); page.wait_for_timeout(800)
        rows = page.eval_on_selector_all('#muOut tbody tr', 'r => r.map(x => x.innerText)')
        check('sun-hours table has 5 rows', len(rows) == 5, rows)
        # selection via canvas tap at the flat marker → building info
        ev("__sb.select({kind:'building', id:'437B'}, {fly:true})"); page.wait_for_timeout(1300)
        txt = page.inner_text('#infoBody')
        check('info panel 437B: 261 flats + stacks', '261' in txt and '#120' in txt, txt[:120])
        page.click('#stackTable tbody tr[data-unit="120"]'); page.wait_for_timeout(300)
        check('stack card shows', 'Stack #120' in page.inner_text('#infoBody'))
        page.screenshot(path=f'{SHOTS}/d03_select.png')
        # real click on the canvas centre picks something or clears without error
        page.mouse.click(720, 450); page.wait_for_timeout(300)
        check('canvas tap ok', not errors, errors[:3])
        # search
        page.fill('#search', '437b'); page.wait_for_timeout(200)
        r1 = page.inner_text('#searchResults')
        page.fill('#search', '#120'); page.wait_for_timeout(200)
        r2 = page.inner_text('#searchResults')
        page.fill('#search', '4 room'); page.wait_for_timeout(200)
        r3 = page.inner_text('#searchResults')
        page.fill('#search', 'PLAYG'); page.wait_for_timeout(200)
        r4 = page.inner_text('#searchResults')
        check('search: block / unit / type / facility', 'Blk 437B' in r1 and '#120' in r2 and '4-Room' in r3 and 'playground' in r4.lower(), [r1[:40], r2[:40], r3[:40], r4[:40]])
        page.fill('#search', '4 room'); page.wait_for_timeout(150); page.keyboard.press('Enter'); page.wait_for_timeout(600)
        st = ev('__sb.state.settings')
        check('type search → filter + colour on', st['typeFilter'] == ['4R'] and st['colourByType'], (st['typeFilter'], st['colourByType']))
        page.click('.preset[data-id="iso"]'); page.wait_for_timeout(1300)
        page.screenshot(path=f'{SHOTS}/d04_types_4R.png')
        page.click('#typeClear'); page.wait_for_timeout(300)
        page.screenshot(path=f'{SHOTS}/d05_types_all.png')
        page.uncheck('#colourByType')
        # storey band
        page.click('#sec-storey summary'); page.check('#storeyOn'); page.fill('#storeyN', '21'); page.dispatch_event('#storeyN', 'input'); page.wait_for_timeout(300)
        check('storey band built', ev('__sb.L.storeyBand.children.length') > 0)
        page.screenshot(path=f'{SHOTS}/d06_storey.png'); page.uncheck('#storeyOn')
        # layers
        page.click('#sec-layers summary')
        for name in ['labels', 'facilities', 'roads', 'canal', 'linkways', 'landscape', 'context', 'shadows', 'sunPath']:
            page.click(f'#layers input[name={name}]'); page.wait_for_timeout(80); page.click(f'#layers input[name={name}]')
        check('layer toggles', not errors, errors[:3])
        # sun bar
        page.click('#btnSun'); page.fill('#sunDate', '2026-06-21'); page.dispatch_event('#sunDate', 'change')
        page.fill('#sunTime', '1020'); page.dispatch_event('#sunTime', 'input'); page.wait_for_timeout(400)
        sr = page.inner_text('#sunRead')
        check('sun readout', '17:00' in sr and 'altitude' in sr, sr)
        page.click('#sunPlay'); page.wait_for_timeout(1200); page.click('#sunPlay')
        m2 = ev('__sb.state.settings.sun.minutes')
        check('play day advances time', m2 > 1020, m2)
        page.click('.preset[data-id="iso"]'); page.wait_for_timeout(1300)
        page.screenshot(path=f'{SHOTS}/d07_sun.png'); page.click('#btnSun')
        # measure: two clicks on the canvas
        page.click('.preset[data-id="top"]'); page.wait_for_timeout(1300)
        page.click('#btnMeasure'); page.mouse.click(600, 500); page.wait_for_timeout(100); page.mouse.click(900, 500); page.wait_for_timeout(300)
        mo = page.inner_text('#measureOut')
        check('measure gives a distance', ' m' in mo, mo)
        page.screenshot(path=f'{SHOTS}/d08_measure.png'); page.keyboard.press('Escape')
        # walk
        page.click('.preset[data-id="adm-lane"]'); page.wait_for_timeout(1300)
        page.click('#btnWalk'); p0 = ev('__sb.camera.position.toArray()')
        page.keyboard.down('KeyW'); page.wait_for_timeout(1200); page.keyboard.up('KeyW')
        p1 = ev('__sb.camera.position.toArray()')
        check('walk moves at eye level', abs(p1[1] - 1.6) < 0.01 and math.dist(p0, p1) > 1, (p0, p1))
        page.screenshot(path=f'{SHOTS}/d09_walk.png'); page.keyboard.press('Escape')
        check('walk exit restores orbit', ev("__sb.state.tool") == 'orbit')
        # heights edit
        page.click('#sec-heights summary'); page.fill('#hF2F', '3.0'); page.fill('#hVD', '4.0'); page.click('#hForm button[type=submit]'); page.wait_for_timeout(500)
        check('heights apply', abs(ev('__sb.roofY(30)') - (4 + 29 * 3)) < 1e-6, ev('__sb.roofY(30)'))
        page.click('#hReset'); page.wait_for_timeout(400)
        check('heights reset', abs(ev('__sb.roofY(30)') - 84.8) < 1e-6)
        # export
        page.click('#btnMore')
        with page.expect_download() as dl: page.click('#menu button[data-act=export]')
        d = json.load(open(dl.value.path()))
        check('export JSON', d['format'] == 'sembawang-brook-3d' and d['site']['blocks'][0]['id'] == '437A')
        # import (round trip)
        page.set_input_files('#importFile', dl.value.path()); page.wait_for_timeout(800)
        check('import round-trip', 'Imported' in page.inner_text('#toast') and ev('__sb.validateSite().length') == 0, page.inner_text('#toast'))
        # persistence across reload
        page.reload(); page.wait_for_selector('body.ready'); page.wait_for_timeout(500)
        check('settings persist', ev('__sb.state.settings.myUnit.unit') == '160')
        # screenshot button
        with page.expect_download() as dl2: page.click('#btnShot')
        check('PNG export', os.path.getsize(dl2.value.path()) > 50000, os.path.getsize(dl2.value.path()))
        # --- regressions from the independent QA review ---
        r = ev("__sb.runSearch('Blk 439A #12-160').map(x => x.label)")
        check('QA m6: address search #12-160', r and r[0].startswith('Blk 439A #12-160'), r)
        r = ev("__sb.runSearch('commun').length > 0 && __sb.runSearch('canal').length > 0")
        check('QA n3: "commun" and "canal" searchable', r)
        ev("__sb.goPreset('adm-st', true); __sb.render()"); page.wait_for_timeout(200)
        tf = page.eval_on_selector('#compass .dial', 'e => e.style.transform')
        check('QA M1: compass dial rotates (south view → N at bottom)', 'rotate(' in tf and abs(abs(float(tf.split('(')[1].split('deg')[0])) - 170) < 6, tf)
        t178 = ev("(() => { const i = __sb.UNITS().idx.get('178'); const p = __sb.REG.pick.filter(m => m.userData.owner === '440A').map(m => m.position.x + m.geometry.parameters.width/2); return [i.u1, Math.max(...p)]; })()")
        check('QA m2: #178 face flush with the building end', abs(t178[0] - t178[1]) < 0.01, t178)
        st = ev("__sb.sunTimes('2026-06-21')")
        check('QA n1: sunrise/sunset 21 Jun ≈ 07:00.4 / 19:12.8', abs(st['rise'] - 420.4) < 0.6 and abs(st['set'] - 1152.8) < 0.6, st)
        bad = os.path.join(SHOTS, 'bad_import.json')
        good = json.load(open(dl.value.path())); del good['site']['blocks'][1]['core']; json.dump(good, open(bad, 'w'))
        page.set_input_files('#importFile', bad); page.wait_for_timeout(800)
        owners = ev("[...new Set(__sb.REG.pick.map(m => m.userData.owner))].length")
        check('QA m3: bad import rejected, scene intact', 'Import failed' in page.inner_text('#toast') and owners >= 12, (page.inner_text('#toast')[:80], owners))
        page.set_input_files('#importFile', dl.value.path()); page.wait_for_timeout(800)
        ev("__sb.state.settings.layers.context = false; __sb.goPreset('top', true); __sb.render()"); page.wait_for_timeout(300)
        road = ev("(() => { const r = __sb.SITE().roads.find(r => r.name === 'Admiralty Street'); const m = r.line[1]; const v = new (__sb.camera.position.constructor)(m[0], 0.1, m[1]).project(__sb.camera); const c = __sb.renderer.domElement.getBoundingClientRect(); return [c.left + (v.x + 1) / 2 * c.width, c.top + (1 - v.y) / 2 * c.height]; })()")
        page.mouse.click(road[0], road[1]); page.wait_for_timeout(300)
        sel = ev("__sb.state.selection && [__sb.state.selection.kind, __sb.state.selection.id]")
        check('QA m5: road tap works with context layer off', sel == ['road', 'Admiralty Street'], sel)
        ev("__sb.state.settings.layers.context = true")
        # ---- navigation: drag moves the map; right-/Ctrl-drag rotates; labels don't block drags; bounded ----
        def settle():
            last = None
            for _ in range(40):
                p = ev("(() => { const t = __sb.controls.target, c = __sb.camera.position; return [t.x, t.z, c.x, c.y, c.z]; })()")
                if last and max(abs(u - v) for u, v in zip(p, last)) < 0.01: return
                last = p; page.wait_for_timeout(250)
        def pose():
            settle()
            return ev("(() => { const t = __sb.controls.target, c = __sb.camera.position; return { t: [t.x, t.z], o: [c.x - t.x, c.y - t.y, c.z - t.z] }; })()")
        def mdrag(x0, y0, x1, y1, button='left', mods=()):
            for m in mods: page.keyboard.down(m)
            page.mouse.move(x0, y0); page.mouse.down(button=button)
            for k in range(1, 13): page.mouse.move(x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12); page.wait_for_timeout(16)
            page.mouse.up(button=button)
            for m in mods: page.keyboard.up(m)
            page.wait_for_timeout(1600)
        def turned(a, b):  # horizontal angle between camera offsets, degrees
            return abs(math.degrees(math.atan2(a['o'][0] * b['o'][2] - a['o'][2] * b['o'][0], a['o'][0] * b['o'][0] + a['o'][2] * b['o'][2])))
        ev("(() => { document.getElementById('left').classList.remove('open'); window.dispatchEvent(new Event('resize')); __sb.select(null); })()")
        ev("__sb.goPreset('adm-st')"); page.wait_for_timeout(2200)
        R = ev("(() => { const r = __sb.renderer.domElement.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
        cx, cy = R[0] + R[2] * 0.62, R[1] + R[3] * 0.62
        a = pose(); mdrag(cx, cy, cx - 220, cy); b = pose()
        moved = math.hypot(b['t'][0] - a['t'][0], b['t'][1] - a['t'][1])
        check('navigation: drag moves the map (no rotation, nothing selected)', moved > 30 and turned(a, b) < 0.5 and ev('__sb.state.selection') is None,
              {'moved m': round(moved, 1), 'turned °': round(turned(a, b), 2)})
        a = pose(); mdrag(cx, cy, cx - 220, cy, button='right'); b = pose()
        check('navigation: right-drag rotates in place', turned(a, b) > 25 and math.hypot(b['t'][0] - a['t'][0], b['t'][1] - a['t'][1]) < 1.5, {'turned °': round(turned(a, b), 1)})
        a = pose(); mdrag(cx, cy, cx + 220, cy, mods=('Control',)); b = pose()
        check('navigation: Ctrl-drag rotates too', turned(a, b) > 25, {'turned °': round(turned(a, b), 1)})
        # labels: a drag that starts on one still moves the map; a tap on one still selects its block
        ev("__sb.goPreset('adm-st')"); page.wait_for_timeout(2200)
        lab = ev("""(() => { for (const el of document.querySelectorAll('#labels .lbl')) { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            const x = r.left + r.width / 2, y = r.top + r.height / 2, under = el.style.pointerEvents, top = document.elementFromPoint(x, y);
            if (el.dataset.owner && r.width > 0 && el.offsetParent !== null && +cs.opacity > 0.6 && top && top.id === 'gl') return { x, y, owner: el.dataset.owner }; } return null; })()""")
        a = pose(); mdrag(lab['x'], lab['y'], lab['x'] - 200, lab['y'] + 40); b = pose()
        check('navigation: a drag starting on a label still moves the map', math.hypot(b['t'][0] - a['t'][0], b['t'][1] - a['t'][1]) > 25 and ev('__sb.state.selection') is None, {'label': lab['owner']})
        ev("__sb.goPreset('adm-st')"); page.wait_for_timeout(2200)
        lab = ev("""(() => { for (const el of document.querySelectorAll('#labels .lbl')) { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            const x = r.left + r.width / 2, y = r.top + r.height / 2, under = el.style.pointerEvents, top = document.elementFromPoint(x, y);
            if (el.dataset.owner && r.width > 0 && el.offsetParent !== null && +cs.opacity > 0.6 && top && top.id === 'gl') return { x, y, owner: el.dataset.owner }; } return null; })()""")
        page.mouse.click(lab['x'], lab['y']); page.wait_for_timeout(500)
        sel = ev('__sb.state.selection')
        check('navigation: tapping a label still selects its block', sel and sel.get('id') == lab['owner'], {'label': lab['owner'], 'selected': sel})
        ev("__sb.select(null)")
        # bounded: dragging far keeps what you look at on the model (±900 m around the estate)
        for _ in range(6): mdrag(R[0] + 60, cy, R[0] + R[2] - 60, cy)
        e = ev("(() => { const t = __sb.controls.target, E = __sb.estateCentre(); return [Math.abs(t.x - E.x), Math.abs(t.z - E.z)]; })()")
        check('navigation: panning stops at the edge of the model (±900 m)', max(e) <= 900.5, [round(v) for v in e])
        # option: drag rotates instead (remembered)
        page.click('#btnMore'); page.click('#menuDrag'); page.wait_for_timeout(300)
        ev("__sb.goPreset('adm-st')"); page.wait_for_timeout(2200)
        a = pose(); mdrag(cx, cy, cx - 220, cy); b = pose()
        saved = ev("JSON.parse(localStorage.getItem('sembawang-brook-3d.settings.v1') || '{}').dragRotate")
        check('navigation: "Drag rotates the view" swaps drag to rotating, and is remembered', turned(a, b) > 25 and saved is True and ev("document.getElementById('menuDrag').getAttribute('aria-checked')") == 'true',
              {'turned °': round(turned(a, b), 1), 'saved': saved})
        page.click('#btnMore'); page.click('#menuDrag'); page.wait_for_timeout(300)
        ev("__sb.goPreset('adm-st')"); page.wait_for_timeout(1500)
        # ---- 3D sun + time-of-day sky ----
        ev("(() => { const d = document.getElementById('sunDate'); d.value = '2026-11-17'; d.dispatchEvent(new Event('change')); const t = document.getElementById('sunTime'); t.value = 1050; t.dispatchEvent(new Event('input')); const cb = document.querySelector('input[name=sunPath]'); cb.checked = true; cb.dispatchEvent(new Event('change')); })()")
        ev("__sb.goPreset('sembawang-dr')"); page.wait_for_timeout(2200)
        sv = ev("""(() => { const T = __sb.THREE, cam = __sb.camera, s = __sb.sunAt('2026-11-17', 1050), R = __sb.renderer.domElement.getBoundingClientRect(), r = Math.PI / 180;
            const g = __sb.G.sky.getObjectByName('sun3d'), dome = __sb.sunDome(), d = g.position.clone().sub(dome.c).normalize();
            const want = new T.Vector3(Math.cos(s.el * r) * Math.sin(s.az * r), Math.sin(s.el * r), -Math.cos(s.el * r) * Math.cos(s.az * r));
            const a = __sb.G.sunPath.children.find((o) => o.isLine).geometry.attributes.position; let arc = 1e9;
            for (let i = 0; i < a.count - 1; i++) { const A = new T.Vector3().fromBufferAttribute(a, i), B = new T.Vector3().fromBufferAttribute(a, i + 1), ab = B.clone().sub(A);
              const t = Math.max(0, Math.min(1, g.position.clone().sub(A).dot(ab) / ab.lengthSq())); arc = Math.min(arc, A.clone().addScaledVector(ab, t).distanceTo(g.position)); }
            const v = g.position.clone().project(cam);
            return { visible: g.visible && __sb.G.sky.visible, err: Math.acos(Math.min(1, d.dot(want))) / r, arc, px: [R.left + (v.x + 1) / 2 * R.width, R.top + (1 - v.y) / 2 * R.height],
                     balls: __sb.G.sunPath.children.filter((o) => o.isMesh).length }; })()""")
        img = Image.open(io.BytesIO(page.screenshot())).convert('RGB'); page.screenshot(path=f'{SHOTS}/sky01_sun.png')
        px = img.getpixel((int(sv['px'][0]), int(sv['px'][1])))
        check('3D sun: true direction for the date/time, on the sun-path arc, drawn bright', sv['visible'] and sv['err'] < 0.01 and sv['arc'] < 0.5 and sum(px[:3]) / 3 > 235 and sv['balls'] == 0,
              {'dir err °': round(sv['err'], 4), 'from arc m': round(sv['arc'], 2), 'pixel': px, 'old ball': sv['balls']})
        def sky_state(m):
            ev(f"(() => {{ const t = document.getElementById('sunTime'); t.value = {m}; t.dispatchEvent(new Event('input')); }})()"); page.wait_for_timeout(300)
            return ev("(() => { const b = __sb.scene.background, g = __sb.G.sky.getObjectByName('sun3d'); return { sun: g.visible, hor: [b.r, b.g, b.b].map((v) => +v.toFixed(3)), fog: __sb.scene.fog.color.equals(b) }; })()")
        noon, dusk, night = sky_state(770), sky_state(1118), sky_state(1260)
        check('sky: day neutral, sunset warm, night dark; fog follows the horizon',
              noon['sun'] and noon['hor'][2] >= noon['hor'][0] and dusk['hor'][0] > dusk['hor'][2] and not night['sun'] and max(night['hor']) < 0.05 and noon['fog'] and night['fog'],
              {'noon': noon, '18:38': dusk, '21:00': night})
        ev("(() => { const t = document.getElementById('sunTime'); t.value = 1050; t.dispatchEvent(new Event('input')); const cb = document.querySelector('input[name=sky]'); cb.checked = false; cb.dispatchEvent(new Event('change')); })()"); page.wait_for_timeout(300)
        off = ev("(() => ({ vis: __sb.G.sky.visible, bg: __sb.scene.background.getHexString(), balls: __sb.G.sunPath.children.filter((o) => o.isMesh).length }))()")
        check('Sun & sky off: plain background back, flat sun-path ball returns', not off['vis'] and off['bg'] == 'e3e9ee' and off['balls'] == 1, off)
        ev("(() => { const cb = document.querySelector('input[name=sky]'); cb.checked = true; cb.dispatchEvent(new Event('change')); const p = document.querySelector('input[name=sunPath]'); p.checked = false; p.dispatchEvent(new Event('change')); const t = document.getElementById('sunTime'); t.value = 600; t.dispatchEvent(new Event('input')); })()")
        # r160 OrbitControls jitter: the view must stop redrawing once nothing changes (top view used to redraw every frame)
        ev("__sb.goPreset('top')"); page.wait_for_timeout(3500)
        idle = ev("new Promise((r) => { const f0 = __sb.renderer.info.render.frame; setTimeout(() => r(__sb.renderer.info.render.frame - f0), 2000); })")
        check('idle: no redraws once the view is still (render on demand)', idle == 0, idle)
        tab = ev("(() => { const a = document.getElementById('tabSG'), r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), target: a.target, w: r.width, cur: document.querySelector('.pagetabs [aria-current=page]').textContent }; })()")
        check('tabs: Estate | Singapore switch in the header (Singapore -> singapore.html)', tab['href'] == 'singapore.html' and tab['target'] == '' and tab['w'] > 40 and tab['cur'] == 'Estate', tab)
        check('no console errors at end (desktop)', not errors, errors[:5])
        ctx.close()
    if not only or 'mobile' in only:
        ctx, page, errors = open_page(browser, 390, 844, mobile=True)
        page.screenshot(path=f'{SHOTS}/m01_load.png')
        check('mobile: left panel closed on load', not page.eval_on_selector('#left', 'e => e.classList.contains("open")'))
        page.tap('#btnMenu'); page.wait_for_timeout(400); page.screenshot(path=f'{SHOTS}/m02_panel.png')
        page.tap('#leftClose'); page.wait_for_timeout(300)
        page.evaluate("__sb.select({kind:'building', id:'437B'}, {fly:true})"); page.wait_for_timeout(1300)
        page.screenshot(path=f'{SHOTS}/m03_info.png')
        page.tap('#infoClose'); page.wait_for_timeout(300)
        page.tap('#btnSun'); page.wait_for_timeout(300); page.screenshot(path=f'{SHOTS}/m04_sun.png')
        page.tap('#btnSun'); page.wait_for_timeout(400)
        # one-finger drag moves the map (real touch input through Chrome)
        cdp = ctx.new_cdp_session(page)
        before = page.evaluate("(() => { const t = __sb.controls.target, c = __sb.camera.position; return { t: [t.x, t.z], o: [c.x - t.x, c.z - t.z] }; })()")
        x0, y0 = 200, 520
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
        for k in range(1, 13):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 - 10 * k, 'y': y0 + 6 * k}]}); page.wait_for_timeout(16)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(1600)
        after = page.evaluate("(() => { const t = __sb.controls.target, c = __sb.camera.position; return { t: [t.x, t.z], o: [c.x - t.x, c.z - t.z] }; })()")
        mv = math.hypot(after['t'][0] - before['t'][0], after['t'][1] - before['t'][1])
        rot = abs(math.degrees(math.atan2(before['o'][0] * after['o'][1] - before['o'][1] * after['o'][0], before['o'][0] * after['o'][0] + before['o'][1] * after['o'][1])))
        check('mobile: one-finger drag moves the map (no rotation)', mv > 10 and rot < 0.5, {'moved m': round(mv, 1), 'turned °': round(rot, 2)})
        mt = page.evaluate("(() => { const a = document.querySelector('#menu a[href]'); const tabs = getComputedStyle(document.querySelector('.pagetabs')).display; const sr = document.querySelector('.search').getBoundingClientRect(); return { href: a && a.getAttribute('href'), tabs, search: sr.width }; })()")
        check('mobile: Singapore map is in the ⋯ menu; header tabs hidden so search keeps its width', mt['href'] == 'singapore.html' and mt['tabs'] == 'none' and mt['search'] >= 100, mt)
        check('mobile: no console errors', not errors, errors[:5])
        ctx.close()
    if not only or 'area' in only:
        # ---------- Sembawang area (OpenStreetMap) ----------
        OSM_EXPORT = os.environ.get('OSM_EXPORT')  # overpass-turbo GeoJSON (optional: parity + live-update tests)
        fixture = None
        exports = [f for f in (OSM_EXPORT or '').split(os.pathsep) if f and os.path.isfile(f)]
        real_coast = False
        if exports:
            els, seen = [], set()
            for path in exports:
                for f in json.load(open(path))['features']:
                    m = re.match(r'^(way|relation)/(\d+)$', str(f['properties'].get('@id', '')))
                    if not m or m[0] in seen: continue
                    seen.add(m[0])
                    tags = {k: v for k, v in f['properties'].items() if not k.startswith('@')}
                    if tags.get('natural') == 'coastline': real_coast = True
                    g = f['geometry']; G2 = lambda ring: [{'lat': la, 'lon': lo} for lo, la in ring]
                    if m[1] == 'way' and g['type'] in ('LineString', 'Polygon'):
                        els.append({'type': 'way', 'id': int(m[2]), 'tags': tags, 'geometry': G2(g['coordinates'] if g['type'] == 'LineString' else g['coordinates'][0])})
                    elif m[1] == 'relation':
                        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
                        els.append({'type': 'relation', 'id': int(m[2]), 'tags': {**tags, 'type': 'multipolygon'}, 'members': [{'type': 'way', 'ref': 0, 'role': 'outer' if i == 0 else 'inner', 'geometry': G2(r)} for poly in polys for i, r in enumerate(poly)]})
            if not real_coast:
                # SYNTHETIC test coastline (not real data): straight line at 1.4665 N, running west, land on its left (south)
                els.append({'type': 'way', 'id': 1, 'tags': {'natural': 'coastline', 'note': 'synthetic test fixture'}, 'geometry': [{'lat': 1.4665, 'lon': 103.86}, {'lat': 1.4665, 'lon': 103.82}, {'lat': 1.4665, 'lon': 103.78}]})
            fixture = os.path.join(SHOTS, 'overpass_fixture.json')
            json.dump({'osm3s': {'timestamp_osm_base': '2026-11-17T14:00:00Z'}, 'elements': els}, open(fixture, 'w'))
        ctx, page, errors = open_page(browser, 1440, 900)
        if fixture:
            page.route('https://overpass-api.de/api/interpreter', lambda r: r.fulfill(path=fixture, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}))
        ev = page.evaluate
        check('area off by default', ev('__sb.AREA.status') == 'off' and not ev('__sb.state.settings.layers.area'))
        page.click('#btnArea'); page.wait_for_function('__sb.AREA.status === "ready"', timeout=60000); page.wait_for_timeout(1500)
        a = ev('(() => { const d = __sb.AREA.data; __sb.render(); const i = __sb.info().render; return { b: d.buildings.length, src: d.source.kind, ex: d.stats.excludedInEstate, hs: d.stats.heightSrc, meshes: __sb.AREA.pickMeshes.length, tri: i.triangles, calls: i.calls }; })()')
        check('area snapshot loaded (4,023 buildings, 11 replaced by the estate)', a['b'] == 4023 and a['src'] == 'snapshot' and a['ex'] == 11, a)
        check('area render budget', a['tri'] < 450000 and a['calls'] < 450, a)
        page.screenshot(path=f'{SHOTS}/area01.png')
        LAND = """(() => { const d = __sb.AREA.data, P = __sb.osmProjector(__sb.SITE().georef); const xy = (la, lo) => { const r = P(la, lo); return Array.isArray(r) ? r : [r.x, r.z]; };
          const pip = (x, z, f) => { let c = false; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) { const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
          const land = (la, lo) => { const [x, z] = xy(la, lo); return (d.land || []).some((r) => pip(x, z, r)); };
          return { rings: d.land ? d.land.length : 0, estate: land(1.4599, 103.8134), park: land(1.4614, 103.83678), straitN: land(1.4735, 103.8130), straitPark: land(1.4700, 103.8370) }; })()"""
        ld = ev(LAND)
        check('snapshot coastline: estate + Sembawang Park on land, Straits of Johor at sea', ld['rings'] >= 1 and {k: ld[k] for k in ('estate', 'park', 'straitN', 'straitPark')} == {'estate': True, 'park': True, 'straitN': False, 'straitPark': False}, ld)
        gx = ev("(() => { const d = __sb.AREA.data, e = d.ext; let out = 0; for (const b of d.buildings) for (let i = 0; i < b.r.length; i += 2) if (b.r[i] < e[0] || b.r[i] > e[2] || b.r[i + 1] < e[1] || b.r[i + 1] > e[3]) { out++; break; } return { out, ext: e }; })()")
        check('ground extent covers every building (incl. those straddling the query box)', gx['out'] == 0, gx)
        # coastline algorithm (synthetic shapes): bbox x 0..100, z 0..100 (z = south)
        c = ev("""(() => { const A = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
          const C = (r) => r.reduce((s, p) => s + p[1], 0) / r.length;
          const west = __sb.osmCoastLand([[[110, 50], [-10, 50]]], [0, 0, 100, 100]);
          const east = __sb.osmCoastLand([[[-10, 50], [110, 50]]], [0, 0, 100, 100]);
          const isl = __sb.osmCoastLand([[[20, 20], [20, 40], [40, 40], [40, 20], [20, 20]]], [0, 0, 100, 100]);
          return { w: [west.length, A(west[0]), C(west[0])], e: [east.length, A(east[0]), C(east[0])], i: [isl.length, A(isl[0])] }; })()""")
        check('coastline → land: westward coast keeps the south half', c['w'][0] == 1 and abs(c['w'][1] - 5000) < 1 and c['w'][2] > 50, c['w'])
        check('coastline → land: eastward coast keeps the north half', c['e'][0] == 1 and abs(c['e'][1] - 5000) < 1 and c['e'][2] < 50, c['e'])
        check('coastline → land: closed island ring kept', c['i'][0] == 1 and abs(c['i'][1] - 400) < 1, c['i'])
        # search + picking an OSM building
        r = ev("__sb.runSearch('Sembawang Park').map(x => x.kind + ':' + x.label)")
        check('search: Sembawang Park (OSM)', any(x.startswith('Park:Sembawang Park') for x in r), r[:3])
        addr = ev("(() => { const b = __sb.AREA.data.buildings.find(b => b.a && /^\\d+ \\w/.test(b.a) && b.l >= 10); return b && b.a; })()")
        r2 = ev(f"__sb.runSearch({json.dumps(addr)}).map(x => x.label + ' | ' + x.sub)") if addr else []
        check('search: OSM address', addr and any(addr in x for x in r2), (addr, r2[:3]))
        bi = ev("__sb.AREA.data.buildings.findIndex(b => b.n && b.h > 9)")
        ev(f"__sb.select({{kind:'osm', id:'x', bi:{bi}}}, {{fly:true}})"); page.wait_for_timeout(1400)
        pt = ev(f"""(() => {{ const b = __sb.AREA.data.buildings[{bi}]; let x = 0, z = 0, n = b.r.length / 2; for (let i = 0; i < b.r.length; i += 2) {{ x += b.r[i]; z += b.r[i + 1]; }}
            const v = new (__sb.camera.position.constructor)(x / n, b.h * 0.6, z / n).project(__sb.camera); const c = __sb.renderer.domElement.getBoundingClientRect();
            return [c.left + (v.x + 1) / 2 * c.width, c.top + (1 - v.y) / 2 * c.height]; }})()""")
        ev("__sb.select(null)"); page.mouse.click(pt[0], pt[1]); page.wait_for_timeout(400)
        sel = ev("__sb.state.selection && [__sb.state.selection.kind, __sb.state.selection.bi]")
        check('tap an OSM building → details', sel and sel[0] == 'osm' and 'OpenStreetMap' in page.inner_text('#infoBody'), (sel, page.inner_text('#infoBody')[:80]))
        page.screenshot(path=f'{SHOTS}/area02_pick.png')
        # sun hours for a flat with surrounding buildings counted
        sh = ev("(() => { const i = __sb.UNITS().idx.get('134'); const a = __sb.flatSunHours(i, 21, '2026-06-21'); const st = __sb.AREA.status; __sb.AREA.status = 'off'; const b = __sb.flatSunHours(i, 21, '2026-06-21'); __sb.AREA.status = st; return [a, b]; })()")
        check('sun hours include OSM surroundings (≤ estate-only)', sh[0]['withArea'] and sh[0]['hours'] <= sh[1]['hours'] + 1e-9, sh)
        # ---- sunlight frame: tight around the estate; in the area view it follows the view (shadows + sun path for the map) ----
        page.click('.preset[data-id="area"]'); page.wait_for_timeout(1800)
        fr = ev("""(() => { const f = __sb.sunFrame(), l = __sb.scene.children.find(o => o.isDirectionalLight), b = __sb.AREA.data.ext || __sb.AREA.data.bbox;
            return { half: f.half, area: f.area, cam: l.shadow.camera.right, covers: f.x - f.half <= b[0] && f.x + f.half >= b[2] && f.z - f.half <= b[1] && f.z + f.half >= b[3] }; })()""")
        check('area overview: sunlight + shadow frame covers the whole map', fr['area'] and fr['cam'] == fr['half'] and fr['covers'], fr)
        ev("(() => { const cb = document.querySelector('input[name=sunPath]'); cb.checked = true; cb.dispatchEvent(new Event('change')); })()"); page.wait_for_timeout(300)
        sp = ev("""(() => { const f = __sb.sunFrame(), line = __sb.G.sunPath.children.find(o => o.isLine), a = line.geometry.attributes.position; let r = 0;
            for (let i = 0; i < a.count; i++) r = Math.max(r, Math.hypot(a.getX(i) - f.x, a.getY(i), a.getZ(i) - f.z)); return Math.round(r); })()""")
        check('area view: sun path drawn over the whole map (not just the estate)', sp >= 2500, sp)
        page.screenshot(path=f'{SHOTS}/area06_sunpath.png')
        ev("(() => { const cb = document.querySelector('input[name=sunPath]'); cb.checked = false; cb.dispatchEvent(new Event('change')); })()")
        # pixel test: ground on the shadow side of a tall OSM building ≥ 1.5 km from the estate darkens when shadows are on
        ev("(() => { const d = document.getElementById('sunDate'); d.value = '2026-11-17'; d.dispatchEvent(new Event('change')); const t = document.getElementById('sunTime'); t.value = 1020; t.dispatchEvent(new Event('input')); document.getElementById('left').classList.remove('open'); })()")
        cand = ev("""(() => {
            const d = __sb.AREA.data, E = __sb.estateCentre(), s = __sb.sunAt('2026-11-17', 1020), th = (s.az + 180) * Math.PI / 180, dir = [Math.sin(th), -Math.cos(th)];
            const pip = (x, z, f) => { let c = false; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) { const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
            const inAny = (x, z) => d.buildings.some((b) => pip(x, z, b.r));
            const out = [];
            for (const b of d.buildings) {
              if (b.h < 40 || b.b) continue;
              let cx = 0, cz = 0, n = b.r.length / 2; for (let i = 0; i < b.r.length; i += 2) { cx += b.r[i]; cz += b.r[i + 1]; } cx /= n; cz /= n;
              if (Math.hypot(cx - E.x, cz - E.z) < 1500) continue;
              if (!pip(cx, cz, b.r)) continue;
              // walk out of the footprint along ±shadow direction, then 12 m past the wall (shadow ≥ 40 m / tan 25° ≈ 85 m long)
              const exit = (sg) => { let t = 0; while (pip(cx + sg * dir[0] * t, cz + sg * dir[1] * t, b.r) && t < 600) t += 1; return [cx + sg * dir[0] * (t + 12), cz + sg * dir[1] * (t + 12)]; };
              const S = exit(1), L = exit(-1);
              if (inAny(...S) || inAny(...L)) continue;
              out.push({ id: b.id, h: b.h, dist: Math.round(Math.hypot(cx - E.x, cz - E.z)), c: [cx, cz], S, L }); if (out.length >= 6) break;
            }
            return out; })()""")
        def shadow_probe(c):
            scr = ev(f"""(() => {{ const V = __sb.camera.position.constructor, c = {json.dumps(c)};
                __sb.camera.position.set(c.c[0], 1800, c.c[1] + 1); __sb.controls.target.set(c.c[0], 0, c.c[1]); __sb.controls.update(); __sb.render();
                const el = __sb.renderer.domElement, R = el.getBoundingClientRect();
                const px = (p) => {{ const v = new V(p[0], 0, p[1]).project(__sb.camera); const x = R.left + (v.x + 1) / 2 * R.width, y = R.top + (1 - v.y) / 2 * R.height; return [x, y, document.elementFromPoint(x, y) === el]; }};
                return {{ S: px(c.S), L: px(c.L), half: __sb.sunFrame().half }}; }})()""")
            if not (scr['S'][2] and scr['L'][2]): return None
            def lum(img, p):
                v = [sum(img.getpixel((int(p[0]) + dx, int(p[1]) + dy))[:3]) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]; return sum(v) / len(v)
            def shot():
                page.wait_for_timeout(700); return Image.open(io.BytesIO(page.screenshot())).convert('RGB')
            on = shot()
            ev("(() => { const cb = document.querySelector('input[name=shadows]'); cb.checked = false; cb.dispatchEvent(new Event('change')); })()"); off = shot()
            ev("(() => { const cb = document.querySelector('input[name=shadows]'); cb.checked = true; cb.dispatchEvent(new Event('change')); })()")
            return {'id': c['id'], 'h': c['h'], 'dist': c['dist'], 'half': scr['half'], 'shadow': round(lum(on, scr['S']) / max(1, lum(off, scr['S'])), 3), 'lit': round(lum(on, scr['L']) / max(1, lum(off, scr['L'])), 3)}
        probes = [r for r in (shadow_probe(c) for c in cand[:4]) if r]
        check('shadows cast by OSM buildings ≥ 1.5 km from the estate (17:00, 17 Nov)', len(probes) >= 3 and all(r['shadow'] < 0.85 and r['lit'] > 0.93 for r in probes), probes)
        page.screenshot(path=f'{SHOTS}/area07_far_shadow.png')
        # leaving the area → back to the tight estate frame
        ev("__sb.setAreaOn(false, false)"); page.wait_for_timeout(300)
        fr2 = ev("(() => { const f = __sb.sunFrame(), E = __sb.estateCentre(); return { half: f.half, area: f.area, atEstate: f.x === E.x && f.z === E.z }; })()")
        check('area off → sunlight frame back around the estate (330 m)', fr2 == {'half': 330, 'area': False, 'atEstate': True}, fr2)
        ev("__sb.setAreaOn(true, false); document.getElementById('left').classList.add('open')"); page.wait_for_timeout(500)
        page.click('.preset[data-id="sembawang-park"]'); page.wait_for_timeout(1400); page.screenshot(path=f'{SHOTS}/area03_park.png')
        if fixture:
            # converter parity: page converter on the same elements = bundled snapshot (built by Node from the same export)
            par = ev("""(async () => { const fc = await (await fetch('data/area-snapshot.json')).json(); return { n: fc.buildings.length, first: JSON.stringify(fc.buildings[0]) }; })()""")
            check('snapshot = Node build of the same converter', par['n'] == 4023, par['n'])
            # live update (B) end-to-end via the routed Overpass fixture
            page.click('#sec-area summary') if not page.is_visible('#areaUpdate') else None
            if not page.is_visible('#areaUpdate'): ev("document.getElementById('left').classList.add('open'); document.getElementById('sec-area').open = true")
            ev(f"__sb.select({{kind:'osm', id:'x', bi:{bi}}})")
            page.click('#areaUpdate'); page.wait_for_function('__sb.AREA.data && __sb.AREA.data.source.kind === "live"', timeout=90000); page.wait_for_timeout(800)
            check('stale OSM selection cleared after the data changes', ev('__sb.state.selection') is None)
            lv = ev("(() => { const d = __sb.AREA.data; return { b: d.buildings.length, land: d.land ? d.land.length : 0, ts: d.source.timestamp, first: JSON.stringify(d.buildings[0]) }; })()")
            check('live update: same buildings as the snapshot', lv['b'] == 4023 and lv['first'] == par['first'], {k: lv[k] for k in ('b', 'ts')})
            if real_coast:
                ld = ev(LAND)
                check('live update (real coastline): land + sea in the right places', ld['rings'] >= 2 and {k: ld[k] for k in ('estate', 'park', 'straitN', 'straitPark')} == {'estate': True, 'park': True, 'straitN': False, 'straitPark': False}, ld)
            else:
                check('live update: coastline → land polygon + sea', lv['land'] == 1, lv['land'])
            page.click('.preset[data-id="sembawang-park"]'); page.wait_for_timeout(1400); page.screenshot(path=f'{SHOTS}/area04_live_coast.png')
            page.reload(); page.wait_for_selector('body.ready'); page.wait_for_function('__sb.AREA.status === "ready"', timeout=60000)
            check('live data cached across reloads (IndexedDB)', ev('__sb.AREA.data.source.kind') == 'live')
            ev("document.getElementById('left').classList.add('open'); document.getElementById('sec-area').open = true"); page.wait_for_timeout(300)
            page.click('#areaSnapshot'); page.wait_for_function('__sb.AREA.status === "ready" && __sb.AREA.data.source.kind === "snapshot"', timeout=60000)
            check('back to the bundled snapshot', ev('__sb.AREA.data.source.kind') == 'snapshot')
        check('area: no console errors', not errors, errors[:5])
        ctx.close()
        ctx, page, errors = open_page(browser, 390, 844, mobile=True)
        page.tap('#btnArea'); page.wait_for_function('__sb.AREA.status === "ready"', timeout=60000); page.wait_for_timeout(1500)
        page.screenshot(path=f'{SHOTS}/area05_phone.png')
        check('area on phone: no console errors', not errors, errors[:5])
        ctx.close()
    if not only or 'render' in only:
        # ---- photo-real render (path tracing). Software GPU here: low resolution, few samples ----
        ctx, page, errors = open_page(browser, 960, 600)
        ev = page.evaluate
        ev("(() => { document.getElementById('left').classList.remove('open'); window.dispatchEvent(new Event('resize')); __sb.RENDER.scaleOverride = 0.5; })()")
        ev("(() => { const d = document.getElementById('sunDate'); d.value = '2026-11-17'; d.dispatchEvent(new Event('change')); const t = document.getElementById('sunTime'); t.value = 600; t.dispatchEvent(new Event('input')); })()")
        ev("__sb.goPreset('top')"); page.wait_for_timeout(1800)
        # ground points classified by a THIRD method: CPU rays toward the sun (3 slightly different sun directions must agree)
        pts = ev("""(() => {
          const T = __sb.THREE, sc = __sb.scene, cam = __sb.camera, G = __sb.G, s = __sb.sunAt('2026-11-17', 600);
          const skip = new Set([G.sunPath, G.tools, G.sky]); const meshes = [];
          sc.traverse((o) => { if (!o.isMesh) return; for (let c = o; c; c = c.parent) { if (skip.has(c) || !c.visible) return; } meshes.push(o); });
          const dir = (az, el) => { const r = Math.PI / 180; return new T.Vector3(Math.cos(el * r) * Math.sin(az * r), Math.sin(el * r), -Math.cos(el * r) * Math.cos(az * r)); };
          const dirs = [dir(s.az, s.el), dir(s.az + 0.6, s.el), dir(s.az, s.el + 0.6)];
          const rc = new T.Raycaster(); const R = __sb.renderer.domElement.getBoundingClientRect();
          const shade = [], lit = [];
          for (let x = -80; x <= 400; x += 6) for (let z = -190; z <= 0; z += 6) {
            const p = new T.Vector3(x, 0, z);
            rc.set(cam.position, p.clone().sub(cam.position).normalize()); const h = rc.intersectObjects(meshes, false)[0];
            if (!h || h.point.y > 0.6 || h.point.distanceTo(p) > 1.5) continue;     // the ground there is what the camera sees
            if (h.object.name !== 'groundPlane') continue;                                                   // one surface (grass), so brightness differs only by shade
            const o = h.point.clone(); o.y += 0.25;
            const blocked = dirs.map((d) => { rc.set(o, d); return rc.intersectObjects(meshes, false).length > 0; });
            if (blocked.some((b) => b !== blocked[0])) continue;                      // near a shadow edge: skip
            const v = h.point.clone().project(cam); const px = [R.left + (v.x + 1) / 2 * R.width, R.top + (1 - v.y) / 2 * R.height];
            if (px[0] < 20 || px[1] < 140 || px[0] > R.width - 20 || px[1] > R.height - 80) continue;
            (blocked[0] ? shade : lit).push(px);
          }
          const pick = (a) => a.filter((_, i) => i % Math.max(1, Math.floor(a.length / 25)) === 0).slice(0, 25);
          return { shade: pick(shade), lit: pick(lit), n: [shade.length, lit.length] };
        })()""")
        def lum_at(img, p):
            v = [sum(img.getpixel((int(p[0]) + dx, int(p[1]) + dy))[:3]) / 3 for dx in (-1, 0, 1) for dy in (-1, 0, 1)]; return sum(v) / len(v)
        def classify(img):
            S = [lum_at(img, p) for p in pts['shade']]; L = [lum_at(img, p) for p in pts['lit']]
            mS, mL = sum(S) / len(S), sum(L) / len(L); cut = (mS + mL) / 2
            agree = (sum(v < cut for v in S) + sum(v >= cut for v in L)) / (len(S) + len(L))
            return {'ratio': round(mS / max(1, mL), 2), 'agree': round(agree, 2)}
        shot = lambda: Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        ev("__sb.render()"); page.wait_for_timeout(300); raster = classify(shot())
        # Stop pressed while the ray tracer is still loading: the start must be abandoned
        ev("(() => { document.getElementById('btnRender').click(); document.getElementById('renderStop').click(); })()"); page.wait_for_timeout(2500)
        rc = ev("({ on: __sb.RENDER.on, open: document.body.classList.contains('render-open'), loaded: !!__sb.RENDER.lib })")
        check('render: Stop during loading cancels the start', rc == {'on': False, 'open': False, 'loaded': True}, rc)
        page.click('#btnRender')
        page.wait_for_function('__sb.RENDER.on && __sb.RENDER.pt && __sb.RENDER.pt.samples >= 6', timeout=600000, polling=1000)
        st = ev("({ samples: __sb.RENDER.pt.samples, info: __sb.RENDER.info, labels: document.getElementById('labels').style.visibility, status: document.getElementById('renderStatus').textContent })")
        check('render: path tracer runs (lazy-loaded, samples accumulate, labels hidden)', st['samples'] >= 6 and st['info']['meshes'] > 150 and st['labels'] == 'hidden', st)
        ev("document.getElementById('renderbar').style.visibility = 'hidden'"); page.wait_for_timeout(200)
        traced = classify(shot()); page.screenshot(path=f'{SHOTS}/render01_top.png')
        ev("document.getElementById('renderbar').style.visibility = ''")
        # vertex colours: the traced scene must hold RGBA colours only (RGB gets read out of step → speckled confetti)
        cs = ev("(() => { const bad = []; __sb.RENDER.scene.traverse((o) => { const c = o.isMesh && o.geometry.attributes.color; if (c && c.itemSize !== 4) bad.push(c.itemSize); }); return bad.length; })()")
        check('render: colour attributes are RGBA in the traced scene', cs == 0, cs)
        sk = ev("(() => { let n = 0; __sb.RENDER.scene.traverse((o) => { if (o.name === 'skyDome' || o.name === 'sun3d') n++; }); return n; })()")
        check('render: the live sky and 3D sun are not in the traced scene', sk == 0, sk)
        crowns = ev("""(() => { const T = __sb.THREE, cam = __sb.camera, R = __sb.renderer.domElement.getBoundingClientRect(), out = [];
            __sb.G.landscape.traverse((o) => { if (!o.isInstancedMesh || !o.instanceColor) return; const m = new T.Matrix4(), p = new T.Vector3();
              for (let i = 0; i < o.count && out.length < 60; i += 3) { o.getMatrixAt(i, m); p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); const v = p.project(cam);
                const x = R.left + (v.x + 1) / 2 * R.width, y = R.top + (1 - v.y) / 2 * R.height; if (x > 20 && y > 140 && x < R.width - 20 && y < R.height - 80) out.push([x, y]); } });
            return out; })()""")
        timg = Image.open(f'{SHOTS}/render01_top.png').convert('RGB')
        if crowns:
            mc = [sum(timg.getpixel((int(x), int(y)))[k] for x, y in crowns) / len(crowns) for k in range(3)]
        else:
            mc = [0, 0, 0]
        check('render: tree crowns come out green (not speckled)', len(crowns) >= 10 and mc[1] > mc[0] * 1.08 and mc[1] > mc[2] * 1.08, {'crowns': len(crowns), 'mean rgb': [round(v) for v in mc]})
        check('render: shadows fall where CPU sun rays say (traced image)', len(pts['shade']) >= 10 and len(pts['lit']) >= 10 and traced['ratio'] < 0.7 and traced['agree'] >= 0.9, {'traced': traced, 'points': pts['n']})
        check('render: …and where the live shadow map puts them', raster['ratio'] < 0.75 and raster['agree'] >= 0.9, {'raster': raster})
        # taps don't select while rendering
        page.mouse.click(480, 330); page.wait_for_timeout(400)
        check('render: tapping does not select', ev('__sb.state.selection') is None)
        # layer change → the traced scene is rebuilt
        before = ev('__sb.RENDER.info.tris')
        ev("(() => { const cb = document.querySelector('input[name=landscape]'); cb.checked = false; cb.dispatchEvent(new Event('change')); })()")
        page.wait_for_function(f'__sb.RENDER.info.tris !== {before}', timeout=60000)
        after = ev('__sb.RENDER.info.tris')
        ev("(() => { const cb = document.querySelector('input[name=landscape]'); cb.checked = true; cb.dispatchEvent(new Event('change')); })()")
        page.wait_for_function(f'__sb.RENDER.info.tris === {before}', timeout=60000)
        check('render: hiding trees rebuilds the traced scene', after < before, {'with trees': before, 'without': after})
        # sky direction convention: looking at a low sun, the brightest sky is where the sun is
        ev("(() => { const t = document.getElementById('sunTime'); t.value = 1095; t.dispatchEvent(new Event('input')); })()")
        # (the controls never tilt above the horizontal, so look 2° down along the sun's azimuth: the sun, 18° up, is in the top of the frame)
        sg = ev("""(() => { const T = __sb.THREE, s = __sb.sunAt('2026-11-17', 1095), r = Math.PI / 180, cam = __sb.camera, c = __sb.controls;
            const d = new T.Vector3(Math.cos(s.el * r) * Math.sin(s.az * r), Math.sin(s.el * r), -Math.cos(s.el * r) * Math.cos(s.az * r));
            const hz = new T.Vector3(Math.sin(s.az * r), 0, -Math.cos(s.az * r)), p = new T.Vector3(150, 400, -90);
            cam.position.copy(p); c.target.copy(p).addScaledVector(hz, 100); c.target.y -= 100 * Math.tan(2 * r); c.update(); __sb.render();
            const v = cam.position.clone().addScaledVector(d, 5000).project(cam), R = __sb.renderer.domElement.getBoundingClientRect();
            const hp = new T.Vector3(p.x, -0.8, p.z).addScaledVector(hz, 29000).project(cam); // far-ground horizon
            return { el: s.el, az: s.az, px: [R.left + (v.x + 1) / 2 * R.width, R.top + (1 - v.y) / 2 * R.height], horizonY: R.top + (1 - hp.y) / 2 * R.height, inView: Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 }; })()""")
        page.wait_for_function('__sb.RENDER.pt.samples >= 4', timeout=300000, polling=1000)
        UI = "['renderbar', 'compass', 'presets', 'topbar', 'toast']"
        ev(f"{UI}.forEach((id) => {{ const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }})"); page.wait_for_timeout(200)
        img = shot(); ev(f"{UI}.forEach((id) => {{ const e = document.getElementById(id); if (e) e.style.visibility = ''; }})"); page.screenshot(path=f'{SHOTS}/render02_sun.png')
        from PIL import ImageFilter
        top = ev("document.getElementById('topbar').getBoundingClientRect().bottom")
        sm = img.filter(ImageFilter.GaussianBlur(8)); W, H = sm.size; best = (0, 0, 0)
        for y in range(int(top) + 10, int(sg['horizonY']) - 6, 3):   # sky only: sunlit ground mustn't win
            for x in range(10, W - 10, 3):
                v = sum(sm.getpixel((x, y))[:3])
                if v > best[0]: best = (v, x, y)
        off = math.hypot(best[1] - sg['px'][0], best[2] - sg['px'][1])
        check('render: sky glow sits on the sun (sky texture direction convention)', sg['inView'] and off < 0.06 * W, {'sun px': [round(v) for v in sg['px']], 'brightest px': best[1:], 'off px': round(off), 'sun': [round(sg['az']), round(sg['el'], 1)]})
        # camera move restarts sampling
        n0 = ev('__sb.RENDER.pt.samples'); ev("(() => { __sb.goPreset('top'); })()"); page.wait_for_timeout(600)
        check('render: moving the camera restarts the image', ev('__sb.RENDER.pt.samples') < n0, {'before': n0, 'after': ev('__sb.RENDER.pt.samples')})
        # save the image
        page.wait_for_function('__sb.RENDER.pt.samples >= 2', timeout=300000, polling=1000)
        with page.expect_download(timeout=60000) as dl:
            page.click('#renderSave')
        f = dl.value.path(); im = Image.open(f); cv = tuple(ev('[__sb.renderer.domElement.width, __sb.renderer.domElement.height]'))
        check('render: Save image downloads the traced PNG (canvas size)', dl.value.suggested_filename == 'sembawang-brook-render.png' and im.size == cv, {'name': dl.value.suggested_filename, 'size': im.size, 'canvas': cv, 'bytes': os.path.getsize(f)})
        # stop → live view back
        page.click('#renderStop'); page.wait_for_timeout(600)
        back = ev("(() => { __sb.render(); return { on: __sb.RENDER.on, labels: document.getElementById('labels').style.visibility, calls: __sb.info().render.calls, open: document.body.classList.contains('render-open') }; })()")
        check('render: Stop restores the live view', not back['on'] and back['labels'] == '' and back['calls'] > 20 and not back['open'], back)
        check('render: no console errors', not errors, errors[:5])
        ctx.close()
    if not only or 'sg' in only:
        # ---------- Singapore 3D map page (MapLibre + OpenFreeMap), fully offline ----------
        # tiles: OpenMapTiles-shaped fixture made from data/area-snapshot.json (Sembawang only) by tools/make_sg_tiles.mjs
        TILES = os.path.join(ROOT, 'tests', 'fixtures', 'sg-tiles')
        if not os.path.isfile(os.path.join(TILES, 'meta.json')):
            os.system(f'node "{os.path.join(ROOT, "tools", "make_sg_tiles.mjs")}"')
        tmeta = json.load(open(os.path.join(TILES, 'meta.json')))
        OFM = 'https://tiles.openfreemap.org'
        FIX_STYLE = {'version': 8, 'name': 'fixture (liberty-shaped)', 'sources': {'openmaptiles': {'type': 'vector', 'url': f'{OFM}/planet'}}, 'layers': [
            {'id': 'background', 'type': 'background', 'paint': {'background-color': '#F8F4F0'}},
            {'id': 'park', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'park', 'paint': {'fill-color': '#D8E8C8'}},
            {'id': 'water', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'water', 'paint': {'fill-color': '#A0C8F0'}},
            {'id': 'road', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'transportation', 'paint': {'line-color': '#FFFFFF', 'line-width': 2}},
            {'id': 'building', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'building', 'minzoom': 13, 'maxzoom': 14, 'paint': {'fill-color': 'hsl(35,8%,85%)'}},
            {'id': 'building-3d', 'type': 'fill-extrusion', 'source': 'openmaptiles', 'source-layer': 'building', 'minzoom': 14, 'filter': ['!', ['has', 'hide_3d']],
             'paint': {'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-color': 'hsl(35,8%,85%)', 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-opacity': 0.8}},
            {'id': 'road_label', 'type': 'symbol', 'source': 'openmaptiles', 'source-layer': 'transportation', 'layout': {}},
        ]}
        FIX_TJ = {'tilejson': '3.0.0', 'tiles': [f'{OFM}/fixture/{{z}}/{{x}}/{{y}}.pbf'], 'minzoom': 0, 'maxzoom': 14,
                  'attribution': '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'}
        net = {'geo': [], 'blocked': [], 'tiles': 0, 'style_fail': False, 'geo_fail': False}
        GEO_HIT = [{'lat': '1.4573', 'lon': '103.8163', 'name': 'Sembawang Drive', 'display_name': 'Sembawang Drive, Sembawang, North Region, Singapore',
                    'boundingbox': ['1.4521', '1.4632', '103.8098', '103.8215']}]
        def route_ofm(route):
            u = route.request.url
            if u.startswith(f'{OFM}/styles/liberty'):
                return route.abort() if net['style_fail'] else route.fulfill(body=json.dumps(FIX_STYLE), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
            if u.startswith(f'{OFM}/planet'):
                return route.fulfill(body=json.dumps(FIX_TJ), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
            m = re.match(rf'{re.escape(OFM)}/fixture/(\d+)/(\d+)/(\d+)\.pbf', u)
            if m:
                net['tiles'] += 1
                f = os.path.join(TILES, m[1], m[2], m[3] + '.pbf')
                return route.fulfill(body=open(f, 'rb').read() if os.path.isfile(f) else b'', headers={'content-type': 'application/x-protobuf', 'access-control-allow-origin': '*'})
            net['blocked'].append(u); route.abort()
        def route_geo(route):
            net['geo'].append((time.time(), route.request.url))
            if net['geo_fail']: return route.fulfill(status=503, body='busy', headers={'access-control-allow-origin': '*'})
            route.fulfill(body=json.dumps(GEO_HIT), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
        SG_URL = URL.replace('index.html?debug', 'singapore.html?debug')
        def open_sg(w, h, mobile=False, url=SG_URL, ctx=None):
            ctx = ctx or browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
            page = ctx.new_page(); errs = []
            page.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
            page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
            page.route('https://cdn.jsdelivr.net/npm/**', route_cdn)
            page.route(f'{OFM}/**', route_ofm)
            page.route('https://nominatim.openstreetmap.org/**', route_geo)
            page.goto(url)
            return ctx, page, errs
        IDLE = "() => new Promise((r) => { const m = __sg.map; const done = () => r(true); if (m.loaded() && !m.isMoving()) done(); else m.once('idle', done); setTimeout(() => r(false), 30000); })"
        def shot_px(page):
            return Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        def patch(im, x, y, r=3):
            px = [im.getpixel((int(x) + i, int(y) + j)) for i in range(-r, r + 1) for j in range(-r, r + 1)]
            return sum(sum(p) for p in px) / (3 * len(px))

        ctx, page, errs = open_sg(1440, 900)
        ev = page.evaluate
        page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000)
        idle = ev(IDLE)
        check('sg: page loads, style + tiles ready, no console errors', idle and not errs and net['tiles'] > 0, {'errors': errs[:4], 'tiles': net['tiles'], 'blocked': net['blocked'][:3]})
        st = ev("(() => { const ids = __sg.map.getStyle().layers.map((l) => l.id); return { ids, light: __sg.map.getLight(), sky: __sg.map.getSky(), view: { c: __sg.map.getCenter().toArray(), z: __sg.map.getZoom(), p: __sg.map.getPitch() }, est: __sg.PLACES[0].ll, hash: location.hash }; })()")
        ids = st['ids']
        check('sg: style 3D layer replaced by sg-3d, under the labels and over the 2D map',
              'building-3d' not in ids and 'sg-3d' in ids and ids.index('sg-3d') < ids.index('road_label') and ids.index('sg-3d') > ids.index('building'), ids)
        check('sg: estate outline drawn under the 3D buildings', ids.index('estate-fill') < ids.index('sg-3d') and ids.index('estate-line') < ids.index('sg-3d'), ids)
        dkm = math.hypot((st['view']['c'][0] - st['est'][0]) * 111.3, (st['view']['c'][1] - st['est'][1]) * 110.6)
        check('sg: first visit opens over the estate in 3D (z15.6, pitch 60) and writes the view to the URL', dkm < 0.05 and abs(st['view']['z'] - 15.6) < 0.01 and abs(st['view']['p'] - 60) < 0.5 and st['hash'].startswith('#view='), {**st['view'], 'km off': round(dkm, 3), 'hash': st['hash']})
        q = ev("(() => { const f = __sg.map.queryRenderedFeatures({ layers: ['sg-3d'] }); return { n: f.length, hidden: f.filter((x) => x.properties.hide_3d).length, tall: Math.max(0, ...f.map((x) => x.properties.render_height || 0)) }; })()")
        check('sg: OSM buildings extruded in view; hide_3d parts skipped', q['n'] > 50 and q['hidden'] == 0 and q['tall'] > 20, {**q, 'fixture hide_3d': tmeta['hidden']})
        im3d = shot_px(page); im3d.save(f'{SHOTS}/sg01_estate.png')
        ev("__sg.map.setLayoutProperty('sg-3d', 'visibility', 'none')"); ev(IDLE)
        im2d = shot_px(page)
        ev("__sg.map.setLayoutProperty('sg-3d', 'visibility', 'visible')"); ev(IDLE)
        d = ImageChops.difference(im3d, im2d).split()
        diff = sum(ImageChops.add(ImageChops.add(d[0], d[1]), d[2]).point(lambda v: 255 if v > 30 else 0).histogram()[255:]) / (im3d.width * im3d.height)
        check('sg: 3D buildings visibly change the picture (pixels differing vs hidden)', diff > 0.05, f'{diff:.1%}')
        hint = ev("getComputedStyle(document.getElementById('zoomHint')).opacity")
        check('sg: zoom hint hidden at building zoom', float(hint) < 0.05, hint)
        lt = st['light']; sp = ev("(() => { const c = __sg.map.getCenter(), s = __sg.sun; return sunPosition(sgtDate(s.date, s.min), c.lat, c.lng); })()")
        check('sg: light comes from the sun position (map anchor, azimuth, polar = 90° - elevation)', lt.get('anchor') == 'map' and abs(lt['position'][1] - sp['az']) < 0.01 and abs(lt['position'][2] - min(89, max(0, 90 - sp['el']))) < 0.01, {'light': lt['position'], 'sun': [round(sp['az'], 2), round(sp['el'], 2)]})

        # light direction convention, checked in pixels: a white test tower, camera south-west of it looking north-east
        ev("""(() => { const m = __sg.map, c = [103.8300, 1.4700], dx = 30 / 111284, dy = 30 / 110574;
          m.addSource('tbox', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[c[0]-dx, c[1]-dy], [c[0]+dx, c[1]-dy], [c[0]+dx, c[1]+dy], [c[0]-dx, c[1]+dy], [c[0]-dx, c[1]-dy]]] } } });
          m.addLayer({ id: 'tbox', type: 'fill-extrusion', source: 'tbox', paint: { 'fill-extrusion-color': '#FFFFFF', 'fill-extrusion-height': 90, 'fill-extrusion-vertical-gradient': false } });
          m.setLayoutProperty('sg-3d', 'visibility', 'none'); m.jumpTo({ center: c, zoom: 17.2, pitch: 55, bearing: 45 }); })()""")
        def faces(minutes):
            ev(f"(() => {{ __sg.sun.date = '2026-11-19'; __sg.sun.min = {minutes}; __sg.applySun(); }})()"); ev(IDLE); page.wait_for_timeout(300)
            im = shot_px(page)
            pw = ev("(() => { const m = __sg.map, c = [103.8300, 1.4700], dx = 30 / 111284, dy = 30 / 110574, r = m.getContainer().getBoundingClientRect(); const P = (x, y) => { const p = m.project([x, y]); return [p.x + r.left, p.y + r.top]; }; return { w: P(c[0] - dx, c[1]), s: P(c[0], c[1] - dy) }; })()")
            return {'W': round(patch(im, pw['w'][0], pw['w'][1] - 40)), 'S': round(patch(im, pw['s'][0], pw['s'][1] - 40)), 'sun': ev('__sg.lastSun()')}
        am, pm = faces(9 * 60), faces(16 * 60 + 30)
        check('sg: west wall lit in the afternoon, dark in the morning (sun azimuth sign); south wall changes less',
              pm['W'] - am['W'] > 20 and abs(pm['S'] - am['S']) < (pm['W'] - am['W']),
              {'09:00 W/S': [am['W'], am['S']], '16:30 W/S': [pm['W'], pm['S']], 'az 09:00': round(am['sun']['az']), 'az 16:30': round(pm['sun']['az'])})
        page.screenshot(path=f'{SHOTS}/sg02_lightbox_pm.png')
        ev("(() => { const m = __sg.map; m.removeLayer('tbox'); m.removeSource('tbox'); m.setLayoutProperty('sg-3d', 'visibility', 'visible'); })()")

        # sun bar: date + time inputs, readout, sky colours, play/pause
        page.fill('#sunDate', '2026-06-21')
        page.eval_on_selector('#sunTime', "(e) => { e.value = 780; e.dispatchEvent(new Event('input')); }")
        noon = ev("({ read: document.getElementById('sunRead').textContent, sun: __sg.lastSun(), sky: __sg.map.getSky() })")
        check('sg: date + time controls drive the sun (21 Jun 13:00 → high, from the north)', noon['sun']['date'] == '2026-06-21' and noon['sun']['el'] > 60 and (noon['sun']['az'] < 30 or noon['sun']['az'] > 330) and '13:00' in noon['read'], noon['read'])
        page.eval_on_selector('#sunTime', "(e) => { e.value = 1165; e.dispatchEvent(new Event('input')); }")
        dusk = ev("({ read: document.getElementById('sunRead').textContent, sun: __sg.lastSun(), sky: __sg.map.getSky(), light: __sg.map.getLight() })")
        lum = lambda h: sum(int(h[i:i + 2], 16) for i in (1, 3, 5))
        check('sg: sky and light follow the time (dusk sky darker, warm low light)', lum(dusk['sky']['sky-color']) < lum(noon['sky']['sky-color']) and dusk['sun']['el'] < 3 and dusk['light']['color'] != '#FFFFFF',
              {'noon sky': noon['sky']['sky-color'], 'dusk sky': dusk['sky']['sky-color'], 'dusk light': dusk['light']['color'], 'read': dusk['read']})
        page.eval_on_selector('#sunTime', "(e) => { e.value = 600; e.dispatchEvent(new Event('input')); }")
        m0 = ev('__sg.sun.min'); page.click('#sunPlay'); page.wait_for_timeout(1500)
        m1 = ev('__sg.sun.min'); pr = page.get_attribute('#sunPlay', 'aria-pressed'); page.click('#sunPlay'); page.wait_for_timeout(500)
        m2 = ev('__sg.sun.min'); page.wait_for_timeout(500); m3 = ev('__sg.sun.min')
        check('sg: play runs the day by elapsed time (~1 h per second) and pause stops it', pr == 'true' and 50 < m1 - m0 < 130 and m3 == m2, {'played min': round(m1 - m0), 'after pause': round(m3 - m2, 2)})
        page.click('#btnSun'); off = ev("({ hidden: getComputedStyle(document.getElementById('sunbar')).display, pressed: document.getElementById('btnSun').getAttribute('aria-pressed') })")
        page.click('#btnSun')
        check('sg: Sun button hides and shows the sun bar', off['hidden'] == 'none' and off['pressed'] == 'false' and page.is_visible('#sunbar'), off)

        # search: built-in places (keyboard) and OpenStreetMap (Nominatim) only on request
        page.click('#search'); page.keyboard.type('marina')
        opts = ev("[...document.querySelectorAll('#results [role=option]')].map((b) => b.firstChild.textContent)")
        check('sg: typing filters the built-in places (no network lookups while typing)', 'Marina Bay Sands' in opts and not net['geo'], {'options': opts, 'geocoder calls': len(net['geo'])})
        page.keyboard.press('ArrowDown'); page.keyboard.press('Enter')
        page.wait_for_timeout(300); ev(IDLE)
        c = ev('__sg.map.getCenter().toArray()')
        check('sg: Arrow + Enter flies to the place (Marina Bay Sands)', math.hypot((c[0] - 103.8607) * 111.3, (c[1] - 1.2834) * 110.6) < 0.1 and ev('document.getElementById("results").hidden'), c)
        page.fill('#search', 'sembawang drive'); page.wait_for_timeout(200)
        page.click('#res-osm'); page.wait_for_selector('#results [role=option]', timeout=8000)
        url0 = net['geo'][-1][1] if net['geo'] else ''
        check('sg: "Search OpenStreetMap" asks Nominatim once, limited to Singapore', len(net['geo']) == 1 and 'countrycodes=sg' in url0 and 'bounded=1' in url0 and 'q=sembawang%20drive' in url0, url0)
        page.click('#results [role=option]'); page.wait_for_timeout(300); ev(IDLE)
        c = ev('__sg.map.getCenter().toArray()')
        check('sg: picking an OpenStreetMap result frames it', math.hypot((c[0] - 103.81565) * 111.3, (c[1] - 1.45765) * 110.6) < 0.25, c)
        page.fill('#search', 'sembawang drive'); page.click('#res-osm'); page.wait_for_selector('#results [role=option]', timeout=8000)
        check('sg: repeated searches are cached (no second request)', len(net['geo']) == 1, len(net['geo']))
        net['geo_fail'] = True; t0 = time.time()
        page.fill('#search', 'admiralty road'); page.click('#res-osm'); page.wait_for_function("document.getElementById('results').textContent.includes('unavailable')", timeout=8000)
        gap = net['geo'][-1][0] - net['geo'][-2][0] if len(net['geo']) >= 2 else 0
        check('sg: geocoder errors are reported; requests stay ≥1 s apart (Nominatim policy)', len(net['geo']) == 2 and gap >= 0.95, {'gap s': round(gap, 2), 'text': ev("document.getElementById('results').textContent")[:90]})
        net['geo_fail'] = False; page.keyboard.press('Escape')

        # places panel, island overview, estate pin + links
        page.click('#btnPlaces'); page.click('#placeList button[data-id="island"]'); page.wait_for_timeout(300); ev(IDLE)
        ov = ev("({ z: __sg.map.getZoom(), hint: getComputedStyle(document.getElementById('zoomHint')).opacity, n: __sg.map.queryRenderedFeatures({ layers: ['sg-3d'] }).length })")
        page.screenshot(path=f'{SHOTS}/sg03_island.png')
        check('sg: "All of Singapore" zooms out; hint says to zoom in; no buildings below z13', abs(ov['z'] - 10.9) < 0.3 and float(ov['hint']) > 0.9 and ov['n'] == 0, ov)
        page.click('#placeList button[data-id="estate"]'); page.wait_for_timeout(300); ev(IDLE)
        page.click('.estate-pin'); page.wait_for_selector('.maplibregl-popup a', timeout=5000)
        links = ev("({ pop: document.querySelector('.maplibregl-popup a').getAttribute('href'), tab: document.querySelector('.pagetabs a').getAttribute('href'), cur: document.querySelector('.pagetabs [aria-current=page]').textContent, attr: document.querySelector('.maplibregl-ctrl-attrib').textContent })")
        page.screenshot(path=f'{SHOTS}/sg04_pin.png')
        check('sg: estate pin popup + Estate tab link back to the estate model; tile attribution shown', links['pop'] == 'index.html' and links['tab'] == 'index.html' and links['cur'] == 'Singapore' and 'OpenStreetMap' in links['attr'] and 'OpenMapTiles' in links['attr'], links)
        page.click('.pagetabs a'); page.wait_for_selector('body.ready', timeout=60000)
        check('sg: Estate tab opens the estate model', page.url.endswith('/index.html'), page.url)
        page.go_back(); page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000)
        # remembered view: reopen without a #view hash → last camera, sun bar state
        ev("__sg.map.jumpTo({ center: [103.8205, 1.4485], zoom: 16.8, pitch: 50, bearing: 30 })"); page.wait_for_timeout(900)
        page.click('#btnSun')
        page.goto(SG_URL); page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000)
        rv = ev("({ c: __sg.map.getCenter().toArray(), z: __sg.map.getZoom(), b: __sg.map.getBearing(), sunOff: document.body.classList.contains('sun-off') })")
        check('sg: reopening restores the last view and sun-bar setting', abs(rv['c'][0] - 103.8205) < 1e-4 and abs(rv['z'] - 16.8) < 0.02 and abs(rv['b'] - 30) < 0.2 and rv['sunOff'], rv)
        page.click('#btnSun')
        errs_real = [e for e in errs if 'status of 503' not in e]  # the 503 is the geocoder failure this test injects
        check('sg: no console errors (desktop; ignoring the injected geocoder 503)', not errs_real and len(errs) - len(errs_real) <= 1, errs[:5])
        ctx.close()

        # ---------- live location (Playwright geolocation emulation: no device heading, so direction comes from successive fixes) ----------
        HOME = (1.4565, 103.8170)
        def off(lat, lon, d, brg):  # d metres along bearing brg (deg) on a sphere
            R = 6371008.8; p1, l1, t = math.radians(lat), math.radians(lon), math.radians(brg)
            p2 = math.asin(math.sin(p1) * math.cos(d / R) + math.cos(p1) * math.sin(d / R) * math.cos(t))
            l2 = l1 + math.atan2(math.sin(t) * math.sin(d / R) * math.cos(p1), math.cos(d / R) - math.sin(p1) * math.sin(p2))
            return math.degrees(p2), math.degrees(l2)
        def hav(a, b):  # [lon, lat] pairs, metres
            R = 6371008.8; p1, p2 = math.radians(a[1]), math.radians(b[1])
            h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
            return 2 * R * math.asin(math.sqrt(h))
        LSTATE = """async () => { const m = __sg.map, mk = __sg.meMarker, me = document.querySelector('.me'), d = await m.getSource('me-acc').getData();
          const ring = d.geometry ? d.geometry.coordinates[0] : [];
          return { state: document.querySelector('.sg-locate').dataset.state, pressed: document.querySelector('.sg-locate').getAttribute('aria-pressed'),
            c: m.getCenter().toArray(), z: m.getZoom(), ll: me ? mk.getLngLat().toArray() : null, align: mk.getRotationAlignment(), rot: mk.getRotation(),
            moving: !!(me && me.classList.contains('moving')), ring0: ring[0] || null, n: ring.length, chip: document.getElementById('locChip').hidden ? '' : document.getElementById('locChip').textContent,
            heading: __sg.LOC.heading, hash: location.hash, stored: JSON.stringify(localStorage) }; }"""
        def rocket_mask(page):
            # pixels the 3D pin layer changes: screenshot with it, then without it
            page.evaluate(IDLE); a = shot_px(page)
            page.evaluate("__sg.map.setLayoutProperty('me-craft3d', 'visibility', 'none')"); page.evaluate(IDLE); page.wait_for_timeout(150); b = shot_px(page)
            page.evaluate("__sg.map.setLayoutProperty('me-craft3d', 'visibility', 'visible')"); page.evaluate(IDLE)
            d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 12 else 0)
            box = d.getbbox(); n = d.histogram()[255]
            lum = 0
            if n:
                px = [p for p, m in zip(a.convert('L').getdata(), d.getdata()) if m]
                lum = sum(px) / len(px)
            return {'n': n, 'box': box, 'lum': round(lum, 1), 'd': d}, a, b
        lctx = browser.new_context(viewport={'width': 1280, 'height': 800}, geolocation={'latitude': HOME[0], 'longitude': HOME[1], 'accuracy': 25}, permissions=['geolocation'])
        lctx, page, lerrs = open_sg(0, 0, ctx=lctx)
        ev = page.evaluate
        page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000); ev(IDLE)
        s0 = ev(LSTATE); hash0 = s0['hash']
        page.click('.sg-locate'); page.wait_for_selector('.me', timeout=15000)
        page.wait_for_function("__sg.CR.loaded.starship && __sg.CR.loaded.starship.state !== 'loading'", timeout=60000); page.wait_for_timeout(200); ev(IDLE)
        s1 = ev(LSTATE); me = [HOME[1], HOME[0]]
        check('location: off until asked; one tap finds you, flies there (z ≥ 16.5) and follows', s0['state'] == 'off' and s0['ll'] is None and s1['state'] == 'follow' and s1['pressed'] == 'true'
              and hav(s1['ll'], me) < 0.5 and hav(s1['c'], me) < 3 and s1['z'] >= 16.5, {k: s1[k] for k in ('state', 'c', 'z', 'll')})
        check('location: accuracy circle = reported accuracy (25 m), chip says ±25 m; rocket upright while still',
              s1['n'] == 65 and abs(hav(s1['ring0'], me) - 25) < 0.3 and '±25 m' in s1['chip'] and s1['align'] == 'viewport' and s1['rot'] == 0 and not s1['moving'],
              {'ring r m': round(hav(s1['ring0'], me), 2), 'chip': s1['chip'], 'align': s1['align']})
        r3 = ev("""(() => { const rec = __sg.CR.loaded.starship, svg = getComputedStyle(document.querySelector('.me-rocket')).display;
          const pins = Object.fromEntries([...document.querySelectorAll('.sg-pin')].map((b) => [b.dataset.pin, b.getAttribute('aria-pressed')]));
          return { state: rec && rec.state, layer: !!__sg.map.getLayer('me-craft3d'), svg, L: __sg.craftLengthM(), chip: document.getElementById('locChip').textContent,
            attr: document.querySelector('.maplibregl-ctrl-attrib').textContent, pins, f22: !!__sg.CR.loaded.f22, yaw: __sg.CR.yawNow, bearing: __sg.map.getBearing() }; })()""")
        check('3D pin: Starship (default) loads on demand and replaces the flat rocket; the F-22 is not fetched until chosen; maker credited (CC BY)',
              r3['state'] == 'ready' and r3['layer'] and r3['svg'] == 'none' and not r3['f22'] and r3['pins'] in ({'starship': 'true', 'f22': 'false'}, {}) and 'Clarence365' in r3['attr'] and 'CC BY 4.0' in r3['attr'],
              {k: r3[k] for k in ('state', 'layer', 'svg', 'pins', 'f22')})
        check('3D pin: before you move it is side-on, nose to the right of the screen (map bearing + 90°); real 124 m length at z16.5, and the chip says so',
              abs(((r3['yaw'] - r3['bearing'] - 90) + 540) % 360 - 180) < 0.5 and abs(r3['L'] - 124) < 1e-9 and 'Starship true size' in r3['chip'], {'yaw': r3['yaw'], 'map bearing': r3['bearing'], 'L': r3['L'], 'chip': r3['chip']})
        page.screenshot(path=f'{SHOTS}/sg07_location.png')

        def level_flight(key, tag):
            """Heading east, camera looking north: compare the craft's pixels with a red MapLibre extrusion of the same
            length at the same height (an independent renderer), drawn in the same place with the craft hidden."""
            ev(f"""(() => {{ const L = __sg.LOC; L.follow = false; L.heading = null; L.lastHeading = 90; __sg.CR.yawNow = 90; const f = L.fix.ll;
              __sg.map.setLayoutProperty('sg-3d', 'visibility', 'none'); __sg.map.jumpTo({{ center: f, zoom: 17, pitch: 50, bearing: 0 }}); }})()""")
            ev("(() => { __sg.sun.date = '2026-11-19'; __sg.sun.min = 780; __sg.applySun(); })()")
            mk, im, base_im = rocket_mask(page)
            im.save(f'{SHOTS}/sg07c_{tag}_level.png')
            geo = ev("(() => { const L = __sg.craftLengthM(), H = __sg.craftAltM(L), p = __sg.map.project(__sg.LOC.fix.ll), r = __sg.map.getContainer().getBoundingClientRect(); return { L, H, dot: [p.x + r.left, p.y + r.top] }; })()")
            ev(f"""(() => {{ const m = __sg.map, f = __sg.LOC.fix.ll, kx = 111320 * Math.cos(f[1] * Math.PI / 180), hx = {geo['L']} / 2 / kx, hy = 2 / 110574;
              m.addSource('tbar', {{ type: 'geojson', data: {{ type: 'Feature', properties: {{}}, geometry: {{ type: 'Polygon', coordinates: [[[f[0]-hx, f[1]-hy], [f[0]+hx, f[1]-hy], [f[0]+hx, f[1]+hy], [f[0]-hx, f[1]+hy], [f[0]-hx, f[1]-hy]]] }} }} }});
              m.addLayer({{ id: 'tbar', type: 'fill-extrusion', source: 'tbar', paint: {{ 'fill-extrusion-color': '#FF0000', 'fill-extrusion-base': {geo['H']} - 2, 'fill-extrusion-height': {geo['H']} + 2, 'fill-extrusion-vertical-gradient': false }} }});
              m.setLayoutProperty('me-craft3d', 'visibility', 'none'); }})()""")
            ev(IDLE); page.wait_for_timeout(150); bim = shot_px(page)
            ev("(() => { const m = __sg.map; m.removeLayer('tbar'); m.removeSource('tbar'); m.setLayoutProperty('me-craft3d', 'visibility', 'visible'); })()"); ev(IDLE)
            rp = [(x, y) for y in range(bim.height) for x in range(0, bim.width) if (lambda p: p[0] > 150 and p[1] < 90 and p[2] < 90)(bim.getpixel((x, y)))]
            bx0, bx1 = min(x for x, y in rp), max(x for x, y in rp); by = sorted(y for x, y in rp)[len(rp) // 2]
            cx0, cy0, cx1, cy1 = mk['box']
            # the craft's own rows (wider than the tether): level flight = a thin band that contains the bar's middle row
            d = mk['d']; widths = {y: sum(1 for x in range(cx0, cx1 + 1) if d.getpixel((x, y))) for y in range(cy0, cy1 + 1)}
            rows = [y for y, w in widths.items() if w > 8]
            row = (min(rows), max(rows)) if rows else (-1, -1)
            # tether: blue pixels in a narrow column between the dot and the craft
            dx, dy = geo['dot']
            teth = sum(1 for y in range(row[1] + 3, int(dy) - 12) if any((lambda p: p[2] > 200 and p[2] - p[0] > 80)(im.getpixel((x, y))) for x in range(int(dx) - 2, int(dx) + 3)))
            span = max(1, int(dy) - 12 - (row[1] + 3))
            return {'craft x': (cx0, cx1), 'bar x': (bx0, bx1), 'craft rows': row, 'bar row': by, 'bar w': bx1 - bx0, 'tether': round(teth / span, 2), 'L': round(geo['L'], 1), 'H': round(geo['H'], 1), 'mask': mk, 'im': im, 'base': base_im}
        def centroid_x(im, box, test):
            xs = [x for y in range(box[1], box[3] + 1) for x in range(box[0], box[2] + 1) if test(im.getpixel((x, y)))]
            return (sum(xs) / len(xs), len(xs)) if xs else (None, 0)
        lf = level_flight('starship', 'starship')
        check('3D pin: Starship flies level and nose-first at its real length: ends within 4 px of a 124 m MapLibre bar at the same height; tethered to your dot (pixels)',
              abs(lf['craft x'][0] - lf['bar x'][0]) <= 4 and abs(lf['craft x'][1] - lf['bar x'][1]) <= 4 and lf['craft rows'][0] <= lf['bar row'] <= lf['craft rows'][1]
              and lf['craft rows'][1] - lf['craft rows'][0] < 0.35 * lf['bar w'] and lf['tether'] > 0.8,
              {k: lf[k] for k in ('craft x', 'bar x', 'craft rows', 'bar row', 'bar w', 'tether', 'L', 'H')})
        # nose first: while "moving" east the engine flame must be at the west (left) end
        ev("(() => { __sg.LOC.heading = 90; __sg.map.triggerRepaint(); })()"); ev(IDLE); page.wait_for_timeout(300)
        mv, mim, _ = rocket_mask(page)
        fx, fn = centroid_x(mim, mv['box'], lambda p: p[0] > 220 and 60 < p[1] < 215 and p[2] < 110)
        ev("(() => { __sg.LOC.heading = null; __sg.map.triggerRepaint(); })()"); ev(IDLE)
        check('3D pin: Starship nose leads: heading east, its flame is at the west (left) end (pixels)', fn > 40 and fx < (mv['box'][0] + mv['box'][2]) / 2 - 0.3 * (mv['box'][2] - mv['box'][0]),
              {'flame px': fn, 'flame x': round(fx or 0), 'craft x': (mv['box'][0], mv['box'][2])})
        ev("(() => { __sg.sun.min = 1230; __sg.applySun(); })()")
        mk_night, _, _ = rocket_mask(page)
        check('3D pin: lit by the map sun (darker at 20:30 than at 13:00)', lf['mask']['lum'] - mk_night['lum'] > 25, {'13:00 mean': lf['mask']['lum'], '20:30 mean': mk_night['lum']})
        ev("(() => { __sg.map.setLayoutProperty('sg-3d', 'visibility', 'visible'); __sg.sun.min = 780; __sg.applySun(); })()")
        ev("__sg.map.jumpTo({ zoom: 13 })"); ev(IDLE)
        z13 = ev("({ L: __sg.craftLengthM(), chip: document.getElementById('locChip').textContent })")
        check('3D pin: zoomed far out it is drawn bigger so it stays visible, and the chip says by how much', z13['L'] > 124 * 2 and 'Starship ×' in z13['chip'], z13)
        page.click('.sg-locate'); page.wait_for_timeout(300); ev(IDLE)  # back to following
        hash0 = ev('location.hash'); stored0 = ev('JSON.stringify(localStorage)')
        # walk 60 m north-east: the rocket turns to point that way and the camera follows
        p2 = off(HOME[0], HOME[1], 60, 45); lctx.set_geolocation({'latitude': p2[0], 'longitude': p2[1], 'accuracy': 10})
        page.wait_for_function('__sg.LOC.heading !== null', timeout=10000); page.wait_for_timeout(900); ev(IDLE)
        s2 = ev(LSTATE); me2 = [p2[1], p2[0]]
        page.screenshot(path=f'{SHOTS}/sg07b_location_moving.png')
        page.wait_for_function("Math.abs(((__sg.CR.yawNow - 45) + 540) % 360 - 180) < 0.3", timeout=20000); ev(IDLE)
        pose = ev("(() => { const r = __sg.CR.loaded.starship; return { yaw: __sg.CR.yawNow, flame: r.flame.visible, heading: __sg.LOC.heading }; })()")
        page.screenshot(path=f'{SHOTS}/sg07d_starship_flying.png')
        ev("__sg.map.setLayoutProperty('sg-3d', 'visibility', 'none')"); ev(IDLE); page.wait_for_timeout(200)
        fim = shot_px(page); fim.save(f'{SHOTS}/sg07e_starship_flame.png')
        fpt = ev("(() => { const p = __sg.map.project(__sg.LOC.fix.ll), r = __sg.map.getContainer().getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; })()")
        orange = sum(1 for x in range(max(0, int(fpt[0]) - 260), min(fim.width, int(fpt[0]) + 261)) for y in range(max(0, int(fpt[1]) - 420), int(fpt[1]))
                     if (lambda p: p[0] > 220 and 60 < p[1] < 215 and p[2] < 110)(fim.getpixel((x, y))))
        ev("__sg.map.setLayoutProperty('sg-3d', 'visibility', 'visible')"); ev(IDLE)
        check('3D pin: moving 60 m NE → nose turns to the heading (45°) and the engines fire (pixels)', abs(pose['yaw'] - 45) < 0.3 and pose['flame'] and orange > 40, {**pose, 'flame px': orange})  # flame points nearly at the camera here; its placement is checked in level flight
        has_f22 = ev("Object.keys(__sg.CRAFTS).includes('f22')")
        if not has_f22:
            print('SKIP F-22 pin checks: assets/f22-raptor.glb is not in this build')
        else:
            # choose the F-22
            page.click('.sg-pin[data-pin="f22"]')
            page.wait_for_function("__sg.CR.loaded.f22 && __sg.CR.loaded.f22.state !== 'loading'", timeout=60000); page.wait_for_timeout(300); ev(IDLE)
            f2 = ev("""(() => { const C = __sg.CR.loaded; return { state: C.f22.state, pins: Object.fromEntries([...document.querySelectorAll('.sg-pin')].map((b) => [b.dataset.pin, b.getAttribute('aria-pressed')])),
              chip: document.getElementById('locChip').textContent, L: __sg.craftLengthM(), vis: [C.starship.size.visible, C.f22.size.visible], pin: JSON.parse(localStorage.getItem('sembawang-brook-3d.sg')).pin }; })()""")
            page.screenshot(path=f'{SHOTS}/sg07f_f22.png')
            check('3D pin: choosing F-22 swaps the pin and saves the choice; at z16.5 its 18.9 m would be ~22 px, so it is enlarged and the chip says so',
                  f2['state'] == 'ready' and f2['pins'] == {'starship': 'false', 'f22': 'true'} and f2['vis'] == [False, True] and f2['pin'] == 'f22' and f2['L'] > 18.9 * 2 and 'F\u201122 ×' in f2['chip'],
                  {k: f2[k] for k in ('state', 'pins', 'vis', 'pin', 'chip')})
            lf2 = level_flight('f22', 'f22')
            cx, cn = centroid_x(lf2['im'], lf2['mask']['box'], lambda p: p[0] > p[1] + 25 and p[1] > p[2] + 10)  # the canopy's amber tint
            mid = (lf2['mask']['box'][0] + lf2['mask']['box'][2]) / 2
            check('3D pin: F-22 flies level and nose-first: ends within 4 px of a MapLibre bar of its drawn length at the same height; canopy at the east end; tethered (pixels)',
                  abs(lf2['craft x'][0] - lf2['bar x'][0]) <= 4 and abs(lf2['craft x'][1] - lf2['bar x'][1]) <= 4 and lf2['craft rows'][0] <= lf2['bar row'] <= lf2['craft rows'][1]
                  and lf2['tether'] > 0.8 and cn > 5 and cx > mid + 0.2 * lf2['bar w'],
                  {**{k: lf2[k] for k in ('craft x', 'bar x', 'craft rows', 'bar row', 'bar w', 'tether', 'L', 'H')}, 'canopy px': cn, 'canopy x': round(cx or 0), 'mid': mid})
            ev("__sg.map.setLayoutProperty('sg-3d', 'visibility', 'visible')")
            page.click('.sg-locate'); page.wait_for_timeout(300); ev(IDLE)  # follow again (level_flight paused it)
        check('location: moving 60 m NE → rocket points along the way (heading 45°), camera follows', abs(s2['heading'] - 45) < 1 and s2['align'] == 'map' and abs(s2['rot'] - s2['heading']) < 1e-6
              and s2['moving'] and 'heading NE' in s2['chip'] and hav(s2['c'], me2) < 3 and hav(s2['ll'], me2) < 0.5, {'heading': round(s2['heading'], 2), 'chip': s2['chip'], 'centre off m': round(hav(s2['c'], me2), 2)})
        check('location: while following, your position stays out of the #view link and saved settings',
              s2['hash'] == hash0 and s2['stored'] == stored0 and f"{p2[0]:.4f}" not in s2['stored'] and f"{p2[0]:.4f}" not in s2['hash'], {'hash': s2['hash']})
        # drag the map: following pauses; the dot still moves; the button re-centres
        page.mouse.move(640, 450); page.mouse.down(); page.mouse.move(540, 400, steps=8); page.mouse.up(); page.wait_for_timeout(300); ev(IDLE)
        cA = ev('__sg.map.getCenter().toArray()')
        p3 = off(p2[0], p2[1], 40, 90); lctx.set_geolocation({'latitude': p3[0], 'longitude': p3[1], 'accuracy': 10})
        page.wait_for_function(f"Math.abs(__sg.meMarker.getLngLat().lng - {p3[1]}) < 1e-7", timeout=10000); page.wait_for_timeout(700)
        s3 = ev(LSTATE); me3 = [p3[1], p3[0]]
        check('location: dragging the map stops following (button "Centre on me"); the pin keeps updating', s3['state'] == 'free' and hav(s3['c'], cA) < 0.5 and hav(s3['ll'], me3) < 0.5 and abs(s3['heading'] - 90) < 1,
              {'state': s3['state'], 'camera moved m': round(hav(s3['c'], cA), 2), 'heading': round(s3['heading'], 1)})
        page.click('.sg-locate'); page.wait_for_timeout(300); ev(IDLE)
        s4 = ev(LSTATE)
        check('location: tapping again re-centres and follows', s4['state'] == 'follow' and hav(s4['c'], me3) < 3, {'state': s4['state'], 'off m': round(hav(s4['c'], me3), 2)})
        ev("__sg.goTo(__sg.PLACES.find((p) => p.id === 'bishan'))"); page.wait_for_timeout(300); ev(IDLE)
        s5 = ev(LSTATE)
        check('location: flying to a place pauses following but keeps tracking', s5['state'] == 'free' and hav(s5['c'], [103.8484, 1.3510]) < 50, {'state': s5['state']})
        page.click('.sg-locate'); page.wait_for_timeout(300); ev(IDLE)
        lctx.set_geolocation({'latitude': 3.1390, 'longitude': 101.6869, 'accuracy': 20}); page.wait_for_function("document.getElementById('locChip').textContent.includes('outside')", timeout=10000)
        page.wait_for_timeout(400); s6 = ev(LSTATE)
        check('location: outside Singapore → says so and leaves the map where it is', 'outside the map area' in s6['chip'] and hav(s6['c'], me3) < 3, {'chip': s6['chip'][:60], 'centre': s6['c']})
        page.click('.sg-locate'); page.wait_for_timeout(300)
        s7 = ev(LSTATE)
        lctx.set_geolocation({'latitude': HOME[0], 'longitude': HOME[1], 'accuracy': 25}); page.wait_for_timeout(1200)
        s8 = ev(LSTATE)
        gone, _, _ = rocket_mask(page)
        check('3D pin: gone when tracking stops', gone['n'] == 0, gone)
        check('location: tapping while following stops tracking (pin, circle and chip gone; no more updates)', s7['state'] == 'off' and s7['ll'] is None and s7['n'] == 0 and not s7['chip'] and s8['ll'] is None and s8['state'] == 'off', {'after stop': s7['state'], 'later': s8['state']})
        page.keyboard.press('l'); page.wait_for_selector('.me', timeout=15000)
        check('location: the L key starts it', ev("document.querySelector('.sg-locate').dataset.state") in ('follow', 'wait'), ev("document.querySelector('.sg-locate').dataset.state"))
        check('location: no console errors', not lerrs, lerrs[:5])
        lctx.close()
        # 3D model can't load → the flat rocket stays
        fctx = browser.new_context(viewport={'width': 1024, 'height': 700}, geolocation={'latitude': HOME[0], 'longitude': HOME[1], 'accuracy': 25}, permissions=['geolocation'])
        fctx.route('**/assets/*.glb', lambda r: r.fulfill(status=404, body='missing'))
        fctx, page, ferrs = open_sg(0, 0, ctx=fctx)
        page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000)
        page.click('.sg-locate'); page.wait_for_selector('.me', timeout=15000)
        page.wait_for_function("__sg.CR.loaded.starship && __sg.CR.loaded.starship.state === 'failed'", timeout=60000); page.wait_for_timeout(300); page.evaluate(IDLE)
        im = shot_px(page)
        pt = page.evaluate("(() => { const p = __sg.map.project(__sg.meMarker.getLngLat()), r = __sg.map.getContainer().getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; })()")
        red = sum(1 for x in range(int(pt[0]) - 20, int(pt[0]) + 21) for y in range(int(pt[1]) - 75, int(pt[1]) - 5)
                  if (lambda p: p[0] > 200 and p[1] < 110 and p[2] < 110)(im.getpixel((x, y))))
        blue = sum(1 for x in range(int(pt[0]) - 6, int(pt[0]) + 7) for y in range(int(pt[1]) - 6, int(pt[1]) + 7) if (lambda p: p[2] > 200 and p[0] < 60)(im.getpixel((x, y))))
        ferrs_real = [e for e in ferrs if '404' not in e]
        check('3D pin: if the model can\'t load, the flat rocket stays over the blue dot (pixels)', red > 40 and blue > 20 and not ferrs_real, {'red px': red, 'blue px': blue, 'errors': ferrs_real[:2]})
        fctx.close()
        # permission refused
        dctx = browser.new_context(viewport={'width': 1024, 'height': 700})
        dctx, page, derrs = open_sg(0, 0, ctx=dctx)
        page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000)
        page.click('.sg-locate'); page.wait_for_function("document.querySelector('.sg-locate').dataset.state === 'error'", timeout=15000)
        dn = page.evaluate("({ chip: document.getElementById('locChip').textContent, pin: !!document.querySelector('.me') })")
        check('location: permission refused → clear message, no pin', 'blocked' in dn['chip'] and not dn['pin'], dn)
        dctx.close()
        # the build offers only pins whose model files ship next to the page
        import shutil, tempfile
        tmp = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp, 'assets'))
        shutil.copy(os.path.join(ROOT, 'assets', 'starship-block3.glb'), os.path.join(tmp, 'assets'))
        out = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build.py'), '--out', os.path.join(tmp, 'index.html')], capture_output=True, text=True)
        pins = re.search(r'"pins":(\[[^\]]*\])', open(os.path.join(tmp, 'singapore.html')).read())
        check('build: a model that is not shipped is not offered (Starship only → no chooser, no F-22)', out.returncode == 0 and pins and json.loads(pins[1]) == ['starship'], pins and pins[1])
        shutil.rmtree(tmp, ignore_errors=True)
        # style unreachable → clear message instead of a blank page
        net['style_fail'] = True
        ctx, page, errs = open_sg(1024, 700)
        page.wait_for_selector('#status:not([hidden])', timeout=20000)
        msg = page.text_content('#status')
        check('sg: offline / blocked tiles → visible error message', 'Could not load the map style' in msg, msg)
        ctx.close(); net['style_fail'] = False

        # phone
        ctx, page, errs = open_sg(390, 844, mobile=True)
        page.wait_for_function('window.__sg && __sg.styleReady()', timeout=60000); page.evaluate(IDLE)
        page.screenshot(path=f'{SHOTS}/sg05_mobile.png')
        lay = page.evaluate("""(() => { const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
          return { search: R('.search'), tabs: R('.pagetabs'), sun: R('#sunbar'), vw: innerWidth, vh: innerHeight, title: getComputedStyle(document.querySelector('.title')).display, n: __sg.map.queryRenderedFeatures({ layers: ['sg-3d'] }).length }; })()""")
        check('sg mobile: header fits (tabs + search ≥ 140 px), sun bar inside the screen, buildings drawn',
              lay['search'][2] - lay['search'][0] >= 140 and lay['tabs'][2] <= lay['search'][0] and lay['sun'][0] >= 0 and lay['sun'][2] <= lay['vw'] and lay['sun'][3] <= lay['vh'] and lay['title'] == 'none' and lay['n'] > 30, lay)
        page.tap('#btnPlaces'); page.wait_for_timeout(300)
        pl = page.evaluate("(() => { const r = document.getElementById('places').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), innerWidth]; })()")
        page.screenshot(path=f'{SHOTS}/sg06_mobile_places.png')
        page.tap('#placeList button[data-id="raffles"]'); page.wait_for_timeout(400)
        check('sg mobile: places panel spans the screen and closes after a pick', pl[0] <= 8 and pl[1] >= pl[2] - 8 and not page.is_visible('#places'), pl)
        lb = page.evaluate("(() => { const r = document.querySelector('.sg-locate').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), innerWidth]; })()")
        ctx.grant_permissions(['geolocation']); ctx.set_geolocation({'latitude': 1.4565, 'longitude': 103.8170, 'accuracy': 15})
        page.tap('.sg-locate'); page.wait_for_selector('.me', timeout=15000); page.wait_for_timeout(1500)
        page.screenshot(path=f'{SHOTS}/sg08_mobile_location.png')
        mst = page.evaluate("document.querySelector('.sg-locate').dataset.state")
        check('sg mobile: location button (≥ 38 px touch target, top-right) tracks you', lb[2] >= 38 and lb[0] + lb[2] <= lb[4] and lb[1] > 56 and mst == 'follow', {'button': lb, 'state': mst})
        pb = page.evaluate("[...document.querySelectorAll('.sg-pin')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.pin, Math.round(r.width), Math.round(r.height), Math.round(r.right) <= innerWidth]; })")
        if page.evaluate("Object.keys(__sg.CRAFTS).includes('f22')"):
            page.tap('.sg-pin[data-pin="f22"]'); page.wait_for_function("__sg.CR.loaded.f22 && __sg.CR.loaded.f22.state === 'ready'", timeout=60000); page.wait_for_timeout(800)
            page.screenshot(path=f'{SHOTS}/sg09_mobile_f22.png')
            check('sg mobile: pin chooser buttons are touch-sized (≥ 38 px) and tapping F-22 switches the pin', all(w >= 38 and h >= 38 and inside for _, w, h, inside in pb) and page.evaluate("__sg.pin()") == 'f22', pb)
            page.tap('.sg-pin[data-pin="starship"]')
        else:
            check('sg mobile: with only the Starship shipped there is no chooser', pb == [], pb)
        page.tap('.sg-locate'); page.wait_for_timeout(300)
        # one-finger drag pans (MapLibre default touch gestures)
        page.evaluate("__sg.map.jumpTo({ center: [103.8130, 1.4599], zoom: 16, pitch: 50, bearing: 0 })"); page.evaluate(IDLE)
        c0 = page.evaluate('__sg.map.getCenter().toArray()'); b0 = page.evaluate('__sg.map.getBearing()')
        cdp = ctx.new_cdp_session(page); x0, y0 = 200, 500
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
        for k in range(1, 13):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 - 10 * k, 'y': y0 + 6 * k}]}); page.wait_for_timeout(16)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(1200)
        c1 = page.evaluate('__sg.map.getCenter().toArray()'); b1 = page.evaluate('__sg.map.getBearing()')
        mv = math.hypot((c1[0] - c0[0]) * 111300, (c1[1] - c0[1]) * 110600)
        check('sg mobile: one-finger drag pans the map (no rotation)', mv > 20 and abs(b1 - b0) < 0.5, {'moved m': round(mv), 'bearing change': round(b1 - b0, 2)})
        check('sg mobile: no console errors', not errs, errs[:5])
        ctx.close()
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
