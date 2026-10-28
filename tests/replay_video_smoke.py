"""Real H.264 encode/decode acceptance; file picker is replaced with a transactional sink.

uv run --with playwright python tests/replay_video_smoke.py http://127.0.0.1:4175
Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chrome build with H.264 encoding if needed.
"""
import base64
import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4175'
artifacts = Path('tests/artifacts/replay-video')
artifacts.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    launch = {'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'], **launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    page.set_default_timeout(120000)
    page.set_default_navigation_timeout(180000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(status=200, body=''))
    page.route('https://fonts.googleapis.com/**', lambda route: route.fulfill(status=200, content_type='text/css', body=''))
    page.add_init_script('''
      window.videoFiles = [];
      window.videoStatsText = [];
      const drawText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(value, ...args) {
        if (String(value).endsWith(' recorded deaths')) window.videoStatsText.push(String(value));
        return drawText.call(this, value, ...args);
      };
      window.failVideoWrite = false;
      window.showSaveFilePicker = async () => {
        const file = { bytes: new Uint8Array(0), committed: false, aborted: false, writes: 0 };
        window.videoFiles.push(file);
        return { createWritable: async () => ({
          async write({ data, position }) {
            if (window.failVideoWrite) throw new Error('Test disk full');
            if (position + data.byteLength > file.bytes.length) {
              const next = new Uint8Array(position + data.byteLength); next.set(file.bytes); file.bytes = next;
            }
            file.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), position); file.writes++;
          },
          async close() { file.committed = true; window.videoBlob = new Blob([file.bytes], { type: 'video/mp4' }); },
          async abort() { file.aborted = true; file.bytes = new Uint8Array(0); }
        }) };
      };
    ''')
    page.goto(url + '/?tab=replays', wait_until='domcontentloaded')
    print('Loaded replay page', flush=True)
    page.locator('[data-replay=files]').set_input_files('tests/fixtures/SYNTHETIC-tactical-demo.replay.json')
    print('Imported synthetic replay', flush=True)
    expect(page.locator('[data-replay=mp4]')).to_be_enabled(timeout=60000)
    print('Export MP4 button ready', flush=True)
    page.locator('#replays-topology-camera').select_option('overhead')
    page.locator('[data-replay=trails]').check()
    original_time = page.locator('[data-replay=timeline]').input_value()
    page.locator('[data-replay=mp4]').click()
    preview = page.locator('[data-video=preview] canvas')
    expect(preview).to_be_visible(timeout=60000)
    print('Preview rendered:', page.locator('[data-video=compatibility]').inner_text(), flush=True)
    expect(page.locator('[data-video=save]')).to_be_enabled(timeout=60000)

    def settings(**values):
        page.evaluate('''values => {
          let last;
          for (const [key, value] of Object.entries(values)) {
            last = document.querySelector(`[data-video="${key}"]`); last.value = value;
          }
          last.dispatchEvent(new Event('change', {bubbles:true}));
        }''', values)
        expect(page.locator('[data-video=save]')).to_be_enabled(timeout=60000)
        print('Settings', values, flush=True)

    def capture(canvas, filename):
        # Capture the actual video bitmap, independent of dialog scrolling/layout.
        data = canvas.evaluate('(canvas) => canvas.toDataURL().split(",")[1]')
        (artifacts / filename).write_bytes(base64.b64decode(data))

    settings(start='40', end='50', speed='5', resolution='720', camera='overhead')
    expect(page.locator('[data-video=duration]')).to_contain_text('2.00 seconds')
    capture(preview, 'preview-overhead.png')
    page.locator('[data-video=save]').click()
    expect(page.locator('[data-video=status]')).to_have_text('MP4 saved.', timeout=180000)
    print('Encoded MP4', flush=True)
    assert page.evaluate('videoFiles.at(-1).committed && !videoFiles.at(-1).aborted && videoFiles.at(-1).writes > 0')
    encoded = page.evaluate('''async () => {
      const reader = new FileReader();
      return await new Promise(resolve => {reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(videoBlob);});
    }''')
    (artifacts / 'overhead-720p.mp4').write_bytes(base64.b64decode(encoded))
    assert page.evaluate('videoStatsText.includes("0 recorded deaths") && videoStatsText.includes("15 recorded deaths") && videoStatsText.includes("14 recorded deaths")'), 'Live casualty counts did not advance'
    dimensions = page.evaluate('''async () => {
      const video = document.createElement('video'); video.id = 'export-decoded'; video.muted = true;
      document.body.append(video);
      const presented = new Promise((resolve, reject) => {video.requestVideoFrameCallback(resolve); video.onerror = reject;});
      video.src = URL.createObjectURL(videoBlob);
      await presented;
      return [video.videoWidth, video.videoHeight, video.duration];
    }''')
    assert dimensions[:2] == [1280, 720], dimensions
    assert abs(dimensions[2] - 2) < .04, dimensions
    samples = []
    for time, name in [(0, 'first'), (1, 'middle'), (1.96, 'last')]:
        samples.append(page.evaluate('''async t => {
          const video = document.getElementById('export-decoded');
          if (Math.abs(video.currentTime - t) > .001) await new Promise(resolve => {video.onseeked = resolve; video.currentTime = t;});
          let canvas = document.getElementById('decoded-frame');
          if (!canvas) {canvas = document.createElement('canvas'); canvas.id = 'decoded-frame'; document.querySelector('[data-video=preview]').append(canvas);}
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
          // Sample map pixels and retain a compressed image for frame comparisons.
          const pixels = ctx.getImageData(100, 100, 600, 400).data;
          const colors = pixels.slice(0, 20000).filter((_, index) => index % 4 !== 3);
          return { range: Math.max(...colors) - Math.min(...colors), image: canvas.toDataURL() };
        }''', time))
        capture(page.locator('#decoded-frame'), f'decoded-{name}.png')
    assert all(sample['range'] > 50 for sample in samples), 'Black or blank map'
    assert samples[0]['image'] != samples[-1]['image'], 'Frames did not change'
    page.locator('#decoded-frame').evaluate('(element) => element.remove()')

    # Cancellation and write failure must abort the real file transaction.
    settings(end='120')
    page.locator('[data-video=save]').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Rendering MP4', timeout=60000)
    page.locator('[data-video=cancel]').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Export canceled', timeout=60000)
    assert page.evaluate('videoFiles.at(-1).aborted && !videoFiles.at(-1).committed')
    settings(end='41')
    page.evaluate('window.failVideoWrite = true')
    page.locator('[data-video=save]').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Test disk full', timeout=60000)
    assert page.evaluate('videoFiles.at(-1).aborted && !videoFiles.at(-1).committed')
    page.evaluate('window.failVideoWrite = false')

    # Follow view uses the same timeline semantics as the interactive player.
    page.locator('[data-video=close]').click()
    expect(page.locator('[data-replay=timeline]')).to_have_value(original_time)
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)
    page.locator('[data-replay=follow]').select_option('2')
    page.locator('[data-replay=mp4]').click()
    expect(page.locator('[data-video=save]')).to_be_enabled(timeout=60000)
    settings(start='44', end='46')
    capture(preview, 'preview-follow.png')
    page.locator('[data-video=save]').click()
    expect(page.locator('[data-video=status]')).to_have_text('MP4 saved.', timeout=180000)
    page.locator('[data-video=close]').click()
    expect(page.locator('[data-replay=follow]')).to_have_value('2')
    expect(page.locator('[data-replay=timeline]')).to_have_value(original_time)
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)

    # Unsupported encoding leaves preview available but prevents saving.
    page.evaluate('window.VideoEncoder = undefined')
    page.locator('[data-replay=mp4]').click()
    expect(page.locator('[data-video=compatibility]')).to_contain_text('does not provide video encoding', timeout=60000)
    expect(page.locator('[data-video=save]')).to_be_disabled()
    expect(preview).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)
    assert not errors, errors
    browser.close()
print('PASS: real H.264 MP4 encode/decode, timing, stats composition, overhead/follow, cancel, write failure, compatibility, disposal')
