"""Cinematic camera acceptance for both players and real MP4 encode/decode.

Run with Playwright installed: python tests/replay_cinematic_smoke.py [local URL]
"""
import base64
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4175'
artifacts = Path('tests/artifacts/cinematic')
artifacts.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=60000)
with sync_playwright() as p:
    launch = {'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'], **launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    page.set_default_timeout(60000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(body=''))
    page.add_init_script('''
      window.showSaveFilePicker = async () => {
        let bytes = new Uint8Array(0);
        return { createWritable: async () => ({
          async write({ data, position }) {
            const next = new Uint8Array(Math.max(bytes.length, position + data.byteLength));
            next.set(bytes); next.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), position); bytes = next;
          },
          async close() { window.videoBlob = new Blob([bytes], {type: 'video/mp4'}); },
          async abort() {}
        }) };
      };
    ''')
    for version, recording_id, fixture in [
        (1, '20261026T162731Z-15-1-1', 'tests/fixtures/SYNTHETIC-tactical-demo.replay.json'),
        (2, 'EXP-20261030T151732Z-1', 'tests/fixtures/SYNTHETIC-experimental-artillery.jsonl'),
    ]:
        suffix = '.replay.json' if version == 1 else '.jsonl'
        page.route('**/' + recording_id + suffix, lambda route: route.fulfill(path=fixture))
        page.goto(url + '/?tab=replays&replay=' + recording_id, wait_until='domcontentloaded')
        prefix = 'replay' if version == 1 else 'exp'
        e = lambda key: page.locator(f'[data-{prefix}="{key}"]')
        v = lambda key: page.locator(f'[data-video="{key}"]')
        expect(e('mp4')).to_be_enabled()
        print(f'v{version} player ready', flush=True)

        def enable():
            if version == 1:
                e('cinematic').check()
            else:
                e('camera').select_option('cinematic')

        enable()
        panel = page.locator('#replay-v1-viewer' if version == 1 else '#experimental-panel')
        controls = panel.locator('.replay-cinematic')
        expect(controls).to_be_visible()
        controls.locator('[data-cinematic=orbit]').evaluate('(e) => { e.value = -3; e.dispatchEvent(new Event("input")); }')
        expect(controls.locator('output').first).to_have_text('-3°/s')
        if version == 2:
            e('height').select_option('4')
            e('speed').select_option('2')
            expect(e('camera')).to_have_value('cinematic')

        # Advancing and reversing the player must preserve cinematic mode.
        initial = float(e('timeline').input_value())
        e('play').click()
        page.wait_for_function('([prefix, initial]) => Number(document.querySelector(`[data-${prefix}="timeline"]`).value) > initial + 500', arg=[prefix, initial])
        e('play').click()
        e('timeline').evaluate('(e, t) => { e.value = t; e.dispatchEvent(new Event("input")); }', initial + 2000)
        e('timeline').evaluate('(e, t) => { e.value = t; e.dispatchEvent(new Event("input")); }', initial)
        stage = panel.locator('canvas.terrain-3d-surface')
        stage.screenshot(path=str(artifacts / f'player-v{version}.png'))
        stage.focus()
        page.keyboard.press('Escape')
        expect(controls).to_be_hidden()
        enable()
        follow_id = e('follow').locator('option').nth(1).get_attribute('value')
        e('follow').select_option(follow_id)
        expect(controls).to_be_hidden()
        enable()
        expect(e('follow')).to_have_value('')

        e('mp4').click()
        expect(v('save')).to_be_enabled()
        expect(v('camera')).to_have_value('cinematic')
        if version == 2:
            expect(v('speed')).to_have_value('2')
        expect(page.locator('dialog [data-cinematic=orbit]')).to_have_value('-3')
        start = float(v('start').input_value())
        page.evaluate('''start => {
          const el = key => document.querySelector(`[data-video="${key}"]`);
          el('end').value = start + 2; el('speed').value = '5'; el('resolution').value = '720';
          el('resolution').dispatchEvent(new Event('change'));
        }''', start)
        expect(v('save')).to_be_enabled()

        def scrub(t):
            v('timeline').evaluate('(e,t) => {e.value=t; e.dispatchEvent(new Event("input"));}', t)
            return v('preview').locator('canvas').evaluate('(e) => e.toDataURL()')

        first, last = scrub(start), scrub(start + 1.5)
        assert first != last, 'Cinematic preview failed to advance'
        assert scrub(start) == first, 'Reverse seeking changed the cinematic path'
        (artifacts / f'preview-v{version}.png').write_bytes(base64.b64decode(first.split(',')[1]))
        page.locator('dialog [data-cinematic=context]').evaluate('(e) => {e.value=100; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change"));}')
        expect(v('save')).to_be_enabled()
        assert scrub(start) != first, 'Cinematic parameters did not change the export frame'
        v('save').click()
        expect(page.locator('dialog [data-cinematic=orbit]')).to_be_disabled()
        expect(v('status')).to_have_text('MP4 saved.', timeout=180000)
        dimensions = page.evaluate('''async () => {
          const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(videoBlob);
          await new Promise((resolve,reject) => {video.onloadeddata=resolve; video.onerror=reject;});
          return [video.videoWidth, video.videoHeight, video.duration];
        }''')
        assert dimensions[:2] == [1280, 720] and abs(dimensions[2] - .4) < .04, dimensions
        print(f'v{version} cinematic MP4 encoded and decoded', flush=True)
        v('close').click()
        expect(page.locator('.replay-video-offscreen')).to_have_count(0)
        expect(controls).to_be_visible()
        e('mp4').click()
        expect(v('save')).to_be_enabled()
        expect(page.locator('dialog [data-cinematic=context]')).to_have_value('35')
        v('camera').select_option('overhead')
        expect(page.locator('dialog .replay-cinematic')).to_be_hidden()
        expect(v('save')).to_be_enabled()
        v('close').click()
        print(f'v{version} cinematic player, seek, parameters, handoff and MP4 encode/decode passed', flush=True)
    assert not errors, errors
    browser.close()
