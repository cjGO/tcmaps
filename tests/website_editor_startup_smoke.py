"""Check rotation-to-editor 3D startup, map/tab changes, and retained placements.

Requires Playwright Chromium. Pass the running site's URL as the first argument.
PLAYWRIGHT_CHROMIUM_EXECUTABLE can select an existing Chromium installation.
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(
        headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
        **({'executable_path': executable} if executable else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript', body=''))
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173')
    expect(page.locator('.topology-live canvas.terrain-3d-surface')).to_be_visible(timeout=60000)
    # Simulate editor code becoming unavailable after the page has loaded (e.g.
    # an older tab after deployment). Rotation already works; the editor must too.
    page.route('**/src/editor-3d.js*', lambda route: route.abort())
    page.route('**/assets/editor-3d-*.js', lambda route: route.abort())
    page.locator('#rotation-edit').click()
    frame = page.frame_locator('iframe:not([hidden])')

    def ready():
        expect(frame.locator('#editor-view-3d')).to_have_count(1, timeout=60000)
        expect(frame.locator('canvas.terrain-3d-surface')).to_be_visible(timeout=60000)
        expect(frame.locator('#editor-three-message')).to_be_hidden(timeout=60000)
        expect(frame.get_by_text('3D could not start.', exact=False)).to_have_count(0)

    ready()
    first = page.locator('#editor-map').input_value()
    frame.locator('#asset').evaluate('''() => {
        const api = window.MapEditor, spawn = api.getState().document.spawn_points[0];
        api.placeAt(spawn.x_m, spawn.y_m);
    }''')
    expect(frame.locator('#editor-focus')).to_be_enabled(timeout=60000)
    saved = frame.locator('#asset').evaluate('() => JSON.stringify(window.MapEditor.getState().document)')
    page.locator('#rotation-tab').click()
    page.locator('#editor-tab').click()
    ready()
    second = page.locator('#editor-map option').evaluate_all(
        '(options, first) => options.find(option => option.value !== first).value', first)
    page.locator('#editor-map').select_option(second)
    ready()
    page.locator('#editor-map').select_option(first)
    ready()
    assert frame.locator('#asset').evaluate('() => JSON.stringify(window.MapEditor.getState().document)') == saved
    expect(frame.locator('#count')).to_have_text('1 object')
    frame.locator('#editor-view-2d').click()
    expect(frame.locator('#viewport')).to_be_visible()
    frame.locator('#editor-view-3d').click()
    ready()
    assert not errors, errors
    browser.close()
print('PASS: rotation/editor 3D, map/tab reopening, 2D/3D switching, and retained placements.')
