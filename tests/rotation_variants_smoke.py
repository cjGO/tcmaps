"""Check every bundled rotation variant with real model loading in Chromium.

Run with Playwright installed: python tests/rotation_variants_smoke.py [URL]
"""
import json
import os
from pathlib import Path
import re
import sys

from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
variants = {}
for file in sorted((root / 'maps').glob('*/test_map_*/variants/*')):
    if not re.search(r'\.(json|placements)$', file.name):
        continue
    map_id = file.parent.parent.name
    name = re.sub(r'\.(placements(\.json)?|json)$', '', file.name)[len(map_id) + 1:]
    variants.setdefault(map_id, {})[name.lower()] = len(json.loads(file.read_text())['placements'])

with sync_playwright() as pw:
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
                                 **({'executable_path': executable} if executable else {}))
    page = browser.new_page(viewport={'width': 1100, 'height': 850})
    page.set_default_timeout(60000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def console_message(message):
        if message.type == 'error' or 'Topology preview unavailable' in message.text:
            errors.append(message.text)
            print(message.text, flush=True)
    page.on('console', console_message)
    page.route('**/_vercel/insights/**', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173', wait_until='domcontentloaded', timeout=120000)
    state = page.locator('#rotation-state')
    note = page.locator('#rotation-panel .topology-info p:last-child')
    for map_id, loadouts in sorted(variants.items()):
        page.locator('#rotation-feedback .feedback-map-link').filter(has_text=re.compile('^' + map_id + '$')).evaluate('(button) => button.click()')
        expect(state).to_be_hidden(timeout=60000)
        expect(note).to_contain_text('Installed loadout')
        expect(note).to_contain_text('Statistics include all variants.')
        options = page.locator('#rotation-variant option').evaluate_all('(options) => options.map(o => o.value)')
        assert len(options) == len(set(options)), options
        for variant_id, count in sorted(loadouts.items()):
            page.locator('#rotation-variant').select_option(variant_id)
            expect(state).to_be_hidden(timeout=60000)
            expect(note).to_contain_text(f'{count} placements.')
            expect(page.locator('#rotation-panel canvas.terrain-3d-surface')).to_be_visible()
            if map_id == 'test_map_111' and variant_id == 'annafreud':
                expect(note).to_contain_text('Archived measured source terrain')
            if map_id == 'test_map_199':
                expect(note).to_contain_text('Installed loadout')
                page.locator('#topology-scale').select_option('2')
                expect(page.locator('#topology-scale-note')).to_contain_text('2')
                page.locator('#rotation-panel [data-mode=heatmap]').click()
                expect(page.locator('#rotation-image')).to_be_visible()
                page.locator('#rotation-panel [data-mode="3d"]').click()
                expect(state).to_be_hidden(timeout=60000)
                expect(note).to_contain_text(f'{count} placements.')
            print(f'PASS {map_id} {variant_id}: {count} placements', flush=True)
        page.locator('#rotation-variant').select_option('source')
        expect(state).to_be_hidden(timeout=60000)
        expect(note).not_to_contain_text('Variant assets loaded')
        assert page.locator('#rotation-panel canvas.terrain-3d-surface').count() == 1
    # A fast switch must not allow an earlier asynchronous asset load to win.
    page.locator('#rotation-variant').select_option(next(iter(loadouts)))
    page.locator('#rotation-variant').select_option('source')
    expect(state).to_be_hidden(timeout=60000)
    expect(note).not_to_contain_text('Variant assets loaded')
    assert not errors, errors
    page.locator('#rotation-variant').select_option(next(iter(loadouts)))
    expect(state).to_be_hidden(timeout=60000)
    page.locator('#rotation-panel .image-stage').screenshot(path='/tmp/rate-maps-variant-preview.png')
    print(f'PASS: {sum(map(len, variants.values()))} variants; default installed assets; RAW, scale, heatmap and rapid switching; no browser errors.')
    browser.close()
