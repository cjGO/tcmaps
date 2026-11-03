"""Portrait export acceptance: both replay versions, margins, reveal, MP4 dimensions.

Run with Playwright installed: python tests/replay_portrait_smoke.py [local URL]
"""
import base64
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4175'
artifacts = Path('tests/artifacts/portrait')
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
    page.route('https://fonts.googleapis.com/**', lambda route: route.fulfill(body='', content_type='text/css'))
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
        print(f'v{version}: replay page loaded', flush=True)
        prefix = 'replay' if version == 1 else 'exp'
        page.locator(f'[data-{prefix}=mp4]').click()
        v = lambda key: page.locator(f'[data-video="{key}"]')
        expect(v('save')).to_be_enabled()
        print(f'v{version}: export preview ready', flush=True)
        start = float(v('start').input_value())

        def settings(**values):
            page.evaluate('''values => {
              let el;
              for (const [key, value] of Object.entries(values)) {
                el = document.querySelector(`[data-video="${key}"]`); el.value = value;
              }
              el.dispatchEvent(new Event('change'));
            }''', values)
            expect(v('save')).to_be_enabled()

        def capture(t):
            v('timeline').evaluate('(e,t) => {e.value=t; e.dispatchEvent(new Event("input"));}', t)
            return v('preview').locator('canvas').evaluate('(e) => e.toDataURL()')

        settings(layout='portrait', camera='overhead', start=start, end=start + 2, speed='5')
        expect(v('preview').locator('canvas')).to_have_attribute('width', '1080')
        expect(v('preview').locator('canvas')).to_have_attribute('height', '1920')
        first = capture(start)
        (artifacts / f'portrait-v{version}-1080.png').write_bytes(base64.b64decode(first.split(',')[1]))
        assert capture(start + 2) != first
        assert capture(start) == first, 'Reverse seek failed to conceal future data'
        # Top/bottom branding bands and side margins must remain entirely blank.
        # The future half of the plot may contain grid lines but no team colors.
        assert v('preview').locator('canvas').evaluate('''canvas => {
          const ctx = canvas.getContext('2d');
          for (const box of [[0,0,1080,192], [0,1728,1080,192], [0,192,64,1536], [1016,192,64,1536]]) {
            const pixels = ctx.getImageData(...box).data;
            for (let i=0; i<pixels.length; i+=4) if (pixels[i]!==16 || pixels[i+1]!==29 || pixels[i+2]!==41) return false;
          }
          const future = ctx.getImageData(550,1430,426,200).data;
          for (let i=0; i<future.length; i+=4) {
            if ((future[i]===98 && future[i+1]===167 && future[i+2]===255) ||
                (future[i]===255 && future[i+1]===120 && future[i+2]===111)) return false;
          }
          return true;
        }''')
        settings(resolution='720', camera='cinematic')
        expect(v('preview').locator('canvas')).to_have_attribute('width', '720')
        expect(v('preview').locator('canvas')).to_have_attribute('height', '1280')
        v('save').click()
        expect(v('status')).to_have_text('MP4 saved.', timeout=180000)
        dimensions = page.evaluate('''async () => {
          const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(videoBlob);
          await new Promise((resolve,reject) => {video.onloadeddata=resolve; video.onerror=reject;});
          return [video.videoWidth, video.videoHeight, video.duration];
        }''')
        assert dimensions[:2] == [720, 1280] and abs(dimensions[2] - .4) < .04, dimensions
        settings(camera='current')
        capture(start)
        settings(layout='landscape')
        expect(v('preview').locator('canvas')).to_have_attribute('width', '1280')
        expect(v('preview').locator('canvas')).to_have_attribute('height', '720')
        v('close').click()
        expect(page.locator('.replay-video-offscreen')).to_have_count(0)
        print(f'v{version}: portrait preview, margins, reveal, camera modes, encode/decode and landscape switch passed', flush=True)
    assert not errors, errors
    browser.close()
