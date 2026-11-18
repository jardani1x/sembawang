#!/usr/bin/env python3
"""Ad-hoc probe: run JS snippets / take close-up shots. Usage: probe.py script.json"""
import http.server, threading, functools, os, sys, json
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST = ROOT; VENDOR = os.path.join(ROOT, 'vendor', 'package')
SHOTS = os.path.join(ROOT, 'tests', 'shots'); os.makedirs(SHOTS, exist_ok=True); CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=DIST))
threading.Thread(target=srv.serve_forever, daemon=True).start()
steps = json.load(open(sys.argv[1]))
vw = steps.get('viewport', [1440, 900])
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME'), args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, is_mobile=steps.get('mobile', False), has_touch=steps.get('mobile', False), device_scale_factor=steps.get('dpr', 1))
    page = ctx.new_page(); errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    def vf(url):
        import re; m = re.match(r'https://cdn\.jsdelivr\.net/npm/([^/]+)/(.*)$', url)
        return os.path.join(VENDOR if m[1] == 'three@0.160.0' else os.path.join(ROOT, 'vendor', m[1], 'package'), m[2])
    page.route('https://cdn.jsdelivr.net/npm/**', lambda r: r.fulfill(path=vf(r.request.url), headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'}))
    page.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html?debug' + steps.get('query', ''))
    page.wait_for_selector("body.ready", timeout=60000); page.set_default_timeout(1800000); page.wait_for_timeout(800)
    for st in steps['steps']:
        if 'js' in st: print(st.get('name', 'js'), '→', json.dumps(page.evaluate(st['js']))[:1500])
        if 'click' in st: page.click(st['click'])
        if 'mouse' in st: page.mouse.click(*st['mouse'])
        if 'key' in st: page.keyboard.press(st['key'])
        if 'drag' in st:  # {"drag": [[x0, y0], [x1, y1]], "button": "left"|"right"}
            (x0, y0), (x1, y1) = st['drag']; btn = st.get('button', 'left')
            page.mouse.move(x0, y0); page.mouse.down(button=btn)
            for k in range(1, 13): page.mouse.move(x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12); page.wait_for_timeout(16)
            page.mouse.up(button=btn)
        if 'wait' in st: page.wait_for_timeout(st['wait'])
        if 'shot' in st: page.screenshot(path=os.path.join(SHOTS, st['shot']), clip=st.get('clip'))
    print('errors:', errs[:5])
    b.close()
