"""Scatter browser check; run against a dev/preview server with Playwright."""
import json
import os
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}))
    page = browser.new_page(viewport={'width': 1500, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173')
    page.locator('#editor-tab').click()
    frame = page.frame_locator('iframe:not([hidden])')
    frame.locator('#editor-three-message').wait_for(state='hidden', timeout=60000)
    canvas = frame.locator('#editor-three canvas.terrain-3d-surface')
    canvas.wait_for(timeout=60000)
    frame.locator('#editor-camera').select_option('overhead')
    frame.locator('#editor-scatter').click()
    frame.locator('#scatter-density').fill('0.05')
    frame.locator('#scatter-coverage').fill('100')
    frame.locator('#scatter-generate').click()

    def ready():
        page.wait_for_function("""() => {
          const doc = document.querySelector('iframe:not([hidden])').contentDocument;
          return !doc.getElementById('scatter-place').disabled;
        }""", timeout=60000)

    def state():
        return page.evaluate("() => document.querySelector('iframe:not([hidden])').contentWindow.MapEditor.getState()")

    def click(x, y):
        canvas.scroll_into_view_if_needed()
        box = canvas.bounding_box()
        page.mouse.click(box['x'] + box['width'] * x, box['y'] + box['height'] * y)

    ready()
    print('Whole-map preview ready', flush=True)
    assert len(state()['document']['placements']) == 0
    ids = page.evaluate("() => Array.from(document.querySelector('iframe:not([hidden])').contentDocument.querySelectorAll('[id]'), el => el.id)")
    assert len(ids) == len(set(ids)), 'Duplicate control IDs'
    whole_count = int(frame.locator('#scatter-count').inner_text().split()[0])
    assert whole_count > 0
    frame.locator('#scatter-place').click()
    committed = state()['document']['placements']
    assert len(committed) == whole_count
    assert frame.locator('#scatter-place').is_disabled()
    frame.locator('#undo').click()
    assert len(state()['document']['placements']) == 0
    frame.locator('#redo').click()
    assert len(state()['document']['placements']) == whole_count
    frame.locator('#undo').click()

    print('Placement and undo/redo passed', flush=True)

    # A finished polygon can be adjusted without changing the saved map.
    frame.locator('#scatter-area').select_option('region')
    for x, y in [(0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6)]:
        click(x, y)
    assert '4 corners' in frame.locator('#scatter-region-summary').inner_text()
    frame.locator('#scatter-finish').click()
    frame.locator('#scatter-density').fill('3')
    assert frame.locator('#scatter-place').is_disabled()
    frame.locator('#scatter-generate').click()
    ready()
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    page.mouse.move(box['x'] + box['width'] * .4, box['y'] + box['height'] * .4)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] * .36, box['y'] + box['height'] * .36, steps=5)
    page.mouse.up()
    ready()
    assert '4 corners' in frame.locator('#scatter-region-summary').inner_text()
    assert len(state()['document']['placements']) == 0
    frame.locator('#scatter-view').select_option('heatmap')
    canvas.screenshot(path=os.environ.get('SCATTER_SCREENSHOT', '/tmp/editor-scatter-region.png'))
    frame.locator('#scatter-place').click()
    region_count = len(state()['document']['placements'])
    assert region_count > 0
    frame.locator('#undo').click()
    frame.locator('#editor-view-2d').click()
    assert state()['mode'] == 'select'
    assert frame.locator('.editor-scatter-panel').is_hidden()
    frame.locator('#editor-view-3d').click()
    frame.locator('#editor-scatter').click()
    assert frame.locator('#scatter-place').is_disabled()

    print('Region editing and view switching passed', flush=True)

    # Pattern presets produce visibly different density fields.
    frame.locator('#scatter-area').select_option('map')
    frame.locator('#scatter-preset').select_option('Winding bands')
    frame.locator('#scatter-density').fill('0.05')
    frame.locator('#scatter-generate').click()
    ready()
    canvas.screenshot(path='/tmp/editor-scatter-bands.png')
    frame.locator('#scatter-preset').select_option('Broken woodland')
    frame.locator('#scatter-density').fill('0.05')
    ready()
    canvas.screenshot(path='/tmp/editor-scatter-woodland.png')
    assert not errors, errors
    print(json.dumps({'whole_map': whole_count, 'region': region_count, 'errors': errors}))
    browser.close()
