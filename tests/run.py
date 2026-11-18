#!/usr/bin/env python3
"""Headless test of index.html: console errors, data, every control, screenshots.

Setup:  pip install playwright && python -m playwright install chromium
        sh tools/fetch_three.sh          # local three.js r160 (CDN requests are intercepted)
Run:    python3 tests/run.py [desktop|mobile|area]
        OSM_EXPORT=export.geojson[:coastline.geojson] python3 tests/run.py area   # + live-update tests
"""
import http.server, threading, functools, os, sys, json, time, math, re, io
from PIL import Image
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
        route.fulfill(path=f, headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'})
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
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
