"""Verify all-size viewing/editing and bounded renderer lifetime in the browser.

uv run --with playwright python tests/rotation_heightmaps_smoke.py URL
"""
import json
import os
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
maps = json.loads((root / 'lib/editor-maps.json').read_text())
url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
artifacts = Path(os.environ['MAPROOM_SCREENSHOT_DIR']) if os.environ.get('MAPROOM_SCREENSHOT_DIR') else None
if artifacts:
    artifacts.mkdir(parents=True, exist_ok=True)

with sync_playwright() as pw:
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
                                 **({'executable_path': executable} if executable else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' or 'Too many active WebGL contexts' in message.text else None)
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    page.goto(url)
    # The first six maps include all three fixed sizes in this rotation.
    seen = set()
    for row in maps[:6]:
        expect(page.locator('#rotation-filename')).to_have_text(row['filename'])
        expect(page.locator('#rotation-state')).to_be_hidden(timeout=30000)
        expect(page.locator('.topology-live .terrain-3d-surface')).to_be_visible()
        expect(page.locator('#topology-metrics')).to_contain_text('201 × 201 measured points')
        if row['pool'] not in seen:
            seen.add(row['pool'])
            if artifacts:
                page.locator('.topology-live .terrain-3d-surface').screenshot(path=str(artifacts / f"viewer-{row['pool']}.png"))
            page.locator('[data-mode="heatmap"]').click()
            expect(page.locator('#rotation-image')).to_be_visible()
            page.locator('[data-mode="3d"]').click()
            expect(page.locator('#rotation-state')).to_be_hidden(timeout=30000)
        if row != maps[5]:
            page.locator('#rotation-next').click()
    assert seen == {'tiny', 'small', 'medium'}
    page.locator('#rotation-edit').click()
    expect(page.locator('#editor-map option')).to_have_count(len(maps))
    saved = {}
    for row in maps[:20]:
        page.locator('#editor-map').select_option(row['id'])
        frame = page.frame_locator('iframe:not([hidden])')
        expect(frame.locator('#editor-three-message')).to_be_hidden(timeout=30000)
        expect(frame.locator('#editor-three .terrain-3d-surface')).to_be_visible(timeout=30000)
        active = page.locator('iframe:not([hidden])').element_handle().content_frame()
        # At most one editor renderer may exist, even after visiting many maps.
        assert page.evaluate("[...document.querySelectorAll('iframe')].reduce((n,f)=>n+f.contentDocument.querySelectorAll('#editor-three canvas.terrain-3d-surface').length,0)") == 1
        if row['pool'] not in saved:
            active.evaluate("""() => {
              const api=window.MapEditor, p=api.getState().document.spawn_points[0];
              api.setMode('place');
              api.placeAt(p.x_m + 5, p.y_m + 5);
            }""")
            expect(frame.locator('#editor-focus')).to_be_enabled(timeout=30000)
            before = active.evaluate('window.MapEditor.getState().document')
            frame.locator('#editor-view-2d').click()
            expect(frame.locator('#viewport')).to_be_visible()
            frame.locator('#editor-view-3d').click()
            with page.expect_download() as download:
                frame.locator('#export').click()
            document = json.loads(Path(download.value.path()).read_text())
            assert document == before
            assert document['source']['scene_id'] == row['id']
            saved[row['pool']] = (row['id'], before)
            if artifacts:
                frame.locator('#editor-three .terrain-3d-surface').screenshot(path=str(artifacts / f"editor-{row['pool']}.png"))
        assert not errors, errors
        print('Verified editor ' + row['id'], flush=True)
    for map_id, before in saved.values():
        page.locator('#editor-map').select_option(map_id)
        frame = page.frame_locator('iframe:not([hidden])')
        expect(frame.locator('#editor-three-message')).to_be_hidden(timeout=30000)
        expect(frame.locator('#editor-focus')).to_be_enabled(timeout=30000)
        active = page.locator('iframe:not([hidden])').element_handle().content_frame()
        assert active.evaluate('window.MapEditor.getState().document') == before
        page.locator('#rotation-tab').click()
        assert page.evaluate("[...document.querySelectorAll('iframe')].every(f=>!f.contentDocument.querySelector('#editor-three'))")
        page.locator('#editor-tab').click()
        expect(frame.locator('#editor-three-message')).to_be_hidden(timeout=30000)
        expect(frame.locator('#editor-focus')).to_be_enabled(timeout=30000)
        assert active.evaluate('window.MapEditor.getState().document') == before
        frame.locator('#undo').click()
        expect(frame.locator('#count')).to_have_text('0 objects')
        frame.locator('#redo').click()
        expect(frame.locator('#count')).to_have_text('1 object')
        assert active.evaluate('window.MapEditor.getState().document') == before
    assert not errors, errors
    print(f'PASS: {len(maps)} editor options; all three sizes viewed/edited; 20 map switches with one renderer; JSON, placements and undo survive switching.')
    browser.close()
