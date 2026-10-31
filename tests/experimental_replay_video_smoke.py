"""V2 MP4 acceptance. Run with the same Playwright setup as replay_video_smoke.py.

uv run --with playwright python tests/experimental_replay_video_smoke.py http://127.0.0.1:4175
"""
import os
import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
expect.set_options(timeout=60000)

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4175'
with sync_playwright() as p:
    launch = {'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'], **launch)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    page.set_default_timeout(60000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(body=''))
    page.add_init_script('''
      window.videoFiles = [];
      window.exportMeshDraws = 0;
      const drawElements = WebGL2RenderingContext.prototype.drawElements;
      WebGL2RenderingContext.prototype.drawElements = function(...args) {
        if (this.canvas.closest('.replay-video-offscreen')) window.exportMeshDraws++;
        return drawElements.apply(this, args);
      };
      window.failVideoWrite = false;
      window.showSaveFilePicker = async () => {
        const file = { bytes: new Uint8Array(0), committed: false, aborted: false };
        videoFiles.push(file);
        return { createWritable: async () => ({
          async write({ data, position }) {
            if (failVideoWrite) throw new Error('Test disk full');
            const next = new Uint8Array(Math.max(file.bytes.length, position + data.byteLength));
            next.set(file.bytes); next.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), position);
            file.bytes = next;
          },
          async close() { file.committed = true; window.videoBlob = new Blob([file.bytes], {type: 'video/mp4'}); },
          async abort() { file.aborted = true; }
        }) };
      };
    ''')
    page.goto(url + '/?tab=replays&replay=local-video-test', wait_until='domcontentloaded')
    page.locator('#open-experimental-recording').click()
    e = lambda key: page.locator('[data-exp="' + key + '"]')
    v = lambda key: page.locator('[data-video="' + key + '"]')
    e('file').set_input_files('tests/fixtures/SYNTHETIC-experimental-artillery.jsonl')
    expect(e('title')).to_have_text('SYNTHETIC-experimental-artillery')
    expect(e('mp4')).to_be_enabled()
    print('V2 recording ready', flush=True)
    original_time = e('timeline').input_value()
    e('mp4').click()
    expect(v('save')).to_be_enabled()
    print('V2 MP4 preview ready', flush=True)
    expect(v('start')).to_have_value('0')
    expect(v('end')).to_have_value('10')

    def settings(**values):
        page.evaluate('''values => {
          let input;
          for (const [key, value] of Object.entries(values)) {
            input = document.querySelector(`[data-video="${key}"]`); input.value = value;
          }
          input.dispatchEvent(new Event('change'));
        }''', values)
        expect(v('save')).to_be_enabled()

    def scrub(time):
        v('timeline').evaluate('(e, t) => {e.value=t; e.dispatchEvent(new Event("input"));}', time)
        return v('preview').locator('canvas').evaluate('(canvas) => canvas.toDataURL()')

    settings(start='1', end='9', speed='5', resolution='720', camera='overhead')
    first, last = scrub(1), scrub(8)
    assert first != last, 'Preview failed to advance movement, effects and stats'
    v('save').click()
    expect(v('status')).to_have_text('MP4 saved.', timeout=180000)
    print('V2 MP4 encoded', flush=True)
    dimensions = page.evaluate('''async () => {
      const video = document.createElement('video'); video.muted = true;
      video.src = URL.createObjectURL(videoBlob);
      await new Promise((resolve, reject) => {video.onloadeddata=resolve; video.onerror=reject;});
      return [video.videoWidth, video.videoHeight, video.duration];
    }''')
    assert dimensions[:2] == [1280, 720], dimensions
    assert abs(dimensions[2] - 1.6) < .04, dimensions
    assert page.evaluate('videoFiles.at(-1).committed && !videoFiles.at(-1).aborted')
    settings(start='0', end='10', speed='1')
    v('save').click()
    expect(v('status')).to_contain_text('Rendering MP4')
    v('cancel').click()
    expect(v('status')).to_contain_text('Export canceled')
    assert page.evaluate('videoFiles.at(-1).aborted && !videoFiles.at(-1).committed')
    settings(start='1', end='2')
    page.evaluate('window.failVideoWrite = true')
    v('save').click()
    expect(v('status')).to_contain_text('Test disk full')
    assert page.evaluate('videoFiles.at(-1).aborted && !videoFiles.at(-1).committed')
    page.evaluate('window.failVideoWrite = false')
    v('close').click()
    expect(e('timeline')).to_have_value(original_time)
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)

    # Combat toggles must affect the export composition at the same instant.
    e('mp4').click()
    expect(v('save')).to_be_enabled()
    effects = scrub(1.2)
    v('close').click()
    e('loaded').locator('[data-layer=artillery]').uncheck()
    e('mp4').click()
    expect(v('save')).to_be_enabled()
    assert scrub(1.2) != effects, 'Artillery/projectile layer was ignored by export'
    v('close').click()
    e('follow').select_option('1')
    e('mp4').click()
    expect(v('save')).to_be_enabled()
    settings(start='4', end='6', speed='5')
    v('save').click()
    expect(v('status')).to_have_text('MP4 saved.', timeout=180000)
    v('close').click()
    expect(e('follow')).to_have_value('1')
    expect(e('timeline')).to_have_value(original_time)

    # VarA's recorded placements must load into the independent export scene.
    e('follow').select_option('')
    e('file').set_input_files('experimental_replays/EXP-20261030T151732Z-1.jsonl')
    expect(e('assets')).to_contain_text('138 placements')
    expect(e('mp4')).to_be_enabled()
    manifest_url = json.loads(Path('lib/editor-models.json').read_text())['manifest_url']
    held = []
    page.route('**' + manifest_url, lambda route: held.append(route))
    with page.expect_request('**' + manifest_url):
        e('mp4').click()
    expect(v('status')).to_have_text('Loading map assets…')
    expect(v('save')).to_be_disabled()
    assert held, 'Export did not request the placed asset library'
    page.unroute('**' + manifest_url)
    held[0].continue_()
    expect(v('save')).to_be_enabled()
    settings(start='0', end='0.2', speed='5', resolution='720', camera='overhead')
    page.evaluate('window.exportMeshDraws = 0')
    scrub(0.1)
    assert page.evaluate('exportMeshDraws >= 138'), 'Placed asset meshes were not drawn in the export scene'
    v('save').click()
    expect(v('status')).to_have_text('MP4 saved.', timeout=180000)
    assert page.evaluate('videoFiles.at(-1).committed && !videoFiles.at(-1).aborted')
    v('close').click()
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)

    # Closing during an asset load must remove the scene and abort its request.
    held.clear()
    page.route('**' + manifest_url, lambda route: held.append(route))
    with page.expect_request('**' + manifest_url):
        e('mp4').click()
    v('close').click()
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)
    page.unroute('**' + manifest_url)
    for request in held:
        request.continue_()
    print('VarA placed assets rendered and encoded; pending loads clean up', flush=True)

    page.evaluate('window.VideoEncoder = undefined')
    e('mp4').click()
    expect(v('compatibility')).to_contain_text('does not provide video encoding')
    expect(v('save')).to_be_disabled()
    expect(v('preview').locator('canvas')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.replay-video-offscreen')).to_have_count(0)
    assert not errors, errors
    browser.close()
print('PASS: v2 MP4 encode/decode, timing, combat toggles, VarA placements, overhead/follow, cancellation, failure, compatibility and cleanup')
