"""Direct replay links, clip playback, sharing, and history in Chromium/WebGL."""
import os
import sys
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4175'
recording = '20261027T052501Z-62-1-78'
link = f'{base}/?replay={recording}&t=90&end=92&follow=1'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
        **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    page.set_default_navigation_timeout(60000)
    errors = []
    requests = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url) if '.replay.json' in request.url else None)
    page.route('**/_vercel/insights/**', lambda route: route.fulfill(status=200, body=''))
    page.goto(link, wait_until='domcontentloaded')
    play = page.locator('[data-replay=play]')
    timeline = page.locator('[data-replay=timeline]')
    follow = page.locator('[data-replay=follow]')
    expect(page.locator('#replays-tab')).to_have_attribute('aria-selected', 'true')
    expect(play).to_be_enabled(timeout=60000)
    expect(timeline).to_have_value('131000')
    expect(follow).to_have_value('1')
    expect(play).to_have_attribute('aria-pressed', 'false')
    assert len(requests) == 1, requests
    play.click()
    expect(play).to_have_attribute('aria-pressed', 'false', timeout=15000)
    expect(timeline).to_have_value('133000')

    def scrub(value):
        timeline.evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input",{bubbles:true}))}', str(value))

    scrub(131000)
    page.locator('[data-replay=share]').click()
    expect(page.locator('[data-replay=share-status]')).to_contain_text('Link copied')
    shared = page.locator('[data-replay=share-link]').input_value()
    assert page.evaluate('navigator.clipboard.readText()') == shared
    params = parse_qs(urlparse(shared).query)
    assert params == {'replay': [recording], 't': ['90'], 'end': ['92'], 'follow': ['1']}, params
    page.locator('[data-replay=clip-end]').fill('92.125')
    page.locator('[data-replay=share]').click()
    assert parse_qs(urlparse(page.locator('[data-replay=share-link]').input_value()).query)['end'] == ['92.125']
    page.locator('[data-replay=clip-end]').fill('92')
    page.locator('[data-replay=share]').click()
    page.reload(wait_until='domcontentloaded')
    expect(play).to_be_enabled(timeout=60000)
    expect(timeline).to_have_value('131000')
    expect(follow).to_have_value('1')
    page.locator('#rotation-tab').click()
    assert parse_qs(urlparse(page.url).query) == {'tab': ['rotation']}
    page.go_back(wait_until='domcontentloaded')
    expect(play).to_be_enabled(timeout=60000)
    expect(timeline).to_have_value('131000')
    expect(page.locator('#replays-tab')).to_have_attribute('aria-selected', 'true')

    # Clipboard denial still leaves a selectable URL.
    page.evaluate('Object.defineProperty(navigator, "clipboard", {configurable:true, value:{writeText:async()=>{throw new Error("denied")}}})')
    page.locator('[data-replay=share]').click()
    expect(page.locator('[data-replay=share-status]')).to_contain_text('Copy the selected link')
    expect(page.locator('[data-replay=share-link]')).to_be_focused()

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile overflow'
    page.set_viewport_size({'width': 1280, 'height': 900})
    permalink = page.locator('#replay-catalog a').first.get_attribute('href')
    assert parse_qs(urlparse(permalink).query) == {'replay': [recording]}
    page.locator('[data-replay=files]').set_input_files('tests/fixtures/SYNTHETIC-tactical-demo.replay.json')
    expect(page.locator('[data-replay=time]')).to_contain_text('SYNTHETIC', timeout=60000)
    expect(page.locator('[data-replay=share]')).to_be_disabled()
    expect(page.locator('[data-replay=share-status]')).to_contain_text('Publish this local recording')
    assert 'replay' not in parse_qs(urlparse(page.url).query)

    page.goto(f'{base}/?replay=missing', wait_until='domcontentloaded')
    expect(page.locator('#replays-tab')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('[data-replay=status]')).to_contain_text('not available')
    page.goto(f'{base}/?tab=server', wait_until='domcontentloaded')
    expect(page.locator('#server-tab')).to_have_attribute('aria-selected', 'true')
    assert not errors, errors
    browser.close()
print('PASS: direct links, single replay download, paused timestamp/follow, clip stop, clipboard/fallback, reload/back, mobile layout, local-file restriction, missing replay, tab link')
