#!/usr/bin/env python3
"""Headless test of index.html: console errors, data, every control, screenshots.

Setup:  pip install playwright && python -m playwright install chromium
        sh tools/fetch_three.sh          # local three.js r160 (CDN requests are intercepted)
Run:    python3 tests/run.py [desktop|mobile]
"""
import http.server, threading, functools, os, sys, json, time, math
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

def route_cdn(route):
    path = route.request.url[len(CDN):]
    f = os.path.join(VENDOR, path)
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
    page.route(CDN + '**', route_cdn)
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
        check('mobile: no console errors', not errors, errors[:5])
        ctx.close()
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
