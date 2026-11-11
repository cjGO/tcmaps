"""App/editor startup must not wait for a slow or unavailable replay catalogue."""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(**({'executable_path': executable} if executable else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    pending, errors = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*virtual:replays*', lambda route: pending.append(route))
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(status=200, body=''))
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
    started = time.monotonic()
    page.goto(url, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("() => document.querySelector('#editor-map')?.options.length > 0", timeout=60000)
    assert page.evaluate("getComputedStyle(document.body).margin") == '0px'
    assert not pending, 'Ordinary startup must not request the replay catalogue'
    print(json.dumps({'startup_seconds': round(time.monotonic() - started, 2), 'catalog_requests': len(pending)}), flush=True)

    page.locator('#replays-tab').click()
    expect(page.locator('#replay-catalog')).to_contain_text('Loading available recordings')
    # Keep the module request pending indefinitely while using the editor.
    page.locator('#editor-tab').click()
    frame = page.frame_locator('iframe:not([hidden])')
    expect(frame.locator('#editor-three-message')).to_be_hidden(timeout=60000)
    frame.locator('#editor-scatter').click()
    expect(frame.locator('#scatter-contrast')).to_be_visible()
    assert len(pending) == 1
    print('Editor and scatter work while replay catalogue is pending', flush=True)

    pending.pop().fulfill(status=200, content_type='application/javascript', body='export default []')
    expect(page.locator('#replay-filter-count')).to_have_text('0 of 0 replays')
    expect(page.locator('#editor-tab')).to_have_attribute('aria-selected', 'true')
    page.locator('#replays-tab').click()
    expect(page.locator('#replay-catalog')).to_contain_text('No published replays')
    page.locator('#replay3-tab').click()
    expect(page.locator('#replay3-panel h1')).to_have_text('Replay v3.')

    # A direct replay link also leaves other tabs usable while discovery waits.
    page.goto(url + '/?replay=missing', wait_until='domcontentloaded', timeout=60000)
    expect(page.locator('#replay-catalog')).to_contain_text('Loading available recordings')
    page.locator('#editor-tab').click()
    assert len(pending) == 1
    pending.pop().fulfill(status=200, content_type='application/javascript', body='export default []')
    expect(page.locator('#replay-filter-count')).to_have_text('0 of 0 replays')
    expect(page.locator('#editor-tab')).to_have_attribute('aria-selected', 'true')
    assert not errors, errors
    print('PASS: styled startup, deferred catalogue, editable scatter and cancelled replay navigation', flush=True)
    browser.close()
