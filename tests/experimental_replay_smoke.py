"""Local WebGL acceptance and measured main-thread frame timings; no deployment."""
import json, os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

expect.set_options(timeout=30000)

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4176'
output = Path('tests/artifacts/experimental-replay'); output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
        **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    page.set_default_timeout(30000)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/_vercel/insights/script.js', lambda r: r.fulfill(status=200, body=''))
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    page.goto(url + '/?tab=experimental', wait_until='domcontentloaded')
    e = lambda key: page.locator('[data-exp="' + key + '"]')
    expect(page.locator('#experimental-tab')).to_have_attribute('aria-selected', 'true')
    start = time.monotonic()
    e('file').set_input_files('experimental_replays/EXP-20261029T074033Z-1.jsonl')
    expect(e('play')).to_be_enabled()
    import_ms = (time.monotonic() - start) * 1000
    expect(e('summary')).to_contain_text('2:11.893')
    expect(e('summary')).to_contain_text('82 entity lifetimes')
    expect(e('summary')).to_contain_text('498 records')
    expect(e('display-status')).to_contain_text('Build-matched declared troop roles applied')
    expect(e('display-status')).to_contain_text('82 classified units')
    expect(e('alignment')).to_contain_text('Unaligned')
    expect(e('terrain')).to_have_value('')
    expect(e('visible')).to_contain_text('soldiers')
    expect(e('stage').locator('canvas.terrain-3d-surface')).to_have_count(1)
    e('play').click(); page.wait_for_function('Number(document.querySelector("[data-exp=timeline]").value)>50606')
    e('play').click(); expect(e('play')).to_have_attribute('aria-pressed', 'false')
    def scrub(t): e('timeline').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input",{bubbles:true}))}', t)
    e('type').select_option('shot'); expect(e('results')).to_contain_text('207 matching')
    e('events').locator('button').first.click(); expect(e('raw')).to_contain_text('weapon_transform_not_verified_projectile_direction')
    expect(e('time')).to_contain_text('sequence')
    e('next').click(); e('previous').click()
    e('search').fill('not-a-field'); expect(e('results')).to_contain_text('0 matching')
    e('search').fill(''); expect(e('results')).to_contain_text('207 matching')
    scrub(80000); e('camera').select_option('overhead'); e('height').select_option('4')
    e('stage').scroll_into_view_if_needed(); page.screenshot(path=str(output / 'real-neutral-grid.png'))
    e('terrain').select_option('0'); expect(e('alignment')).to_contain_text('UNVERIFIED terrain overlay')
    expect(e('play')).to_be_enabled(); expect(e('metadata')).to_contain_text('"available": false')
    e('terrain').select_option(''); expect(e('alignment')).to_contain_text('Unaligned'); expect(e('play')).to_be_enabled()
    # Stable import and playback continue to work after the experimental session.
    page.locator('#replays-tab').click(); expect(e('stage').locator('canvas')).to_have_count(0)
    page.locator('[data-replay=files]').set_input_files('tests/fixtures/SYNTHETIC-tactical-demo.replay.json')
    expect(page.locator('[data-replay=play]')).to_be_enabled(timeout=120000)
    expect(page.locator('[data-replay=time]')).to_contain_text('320 visible', timeout=120000)
    page.locator('#experimental-tab').click(); expect(e('play')).to_be_enabled()
    expect(e('title')).to_have_text('EXP-20261029T074033Z-1')
    # Labelled artillery example, linked overrides, same-time stepping.
    e('examples').select_option(label='SYNTHETIC · artillery, contacts & fragments'); e('example').click()
    expect(e('summary')).to_contain_text('SYNTHETIC fixture'); expect(e('play')).to_be_enabled()
    e('type').select_option('damage_override'); e('events').locator('button').first.click()
    expect(e('raw')).to_contain_text('incoming_hit'); expect(e('raw')).to_contain_text('"value": 20')
    scrub(4500); page.locator('[data-layer=radii]').check(); page.locator('[data-layer=trails]').check()
    e('stage').scroll_into_view_if_needed(); page.screenshot(path=str(output / 'synthetic-artillery.png'))
    # Standard display parity, with explicit synthetic names/classes as a sidecar.
    e('display-status').locator('..').locator('summary').click()
    e('display-file').set_input_files('tests/fixtures/SYNTHETIC-experimental-display.json')
    expect(e('display-status')).to_contain_text('User-supplied display metadata loaded')
    expect(e('play')).to_be_enabled()
    expect(e('soldier').locator('option[value="2"]')).to_contain_text('Synthetic Captain')
    scrub(8000); expect(e('visible')).to_contain_text('1 bot death markers')
    assert int(re.search(r'(\d+) trail segments', e('visible').inner_text())[1]) > 0
    page.locator('[data-layer=deaths]').uncheck()
    expect(e('visible')).to_contain_text('1 bot death markers')
    scrub(1000); expect(e('visible')).to_contain_text('0 bot death markers')
    scrub(8000); expect(e('visible')).to_contain_text('1 bot death markers')
    e('bots').uncheck(); expect(e('visible')).to_contain_text('0 bot death markers')
    e('bots').check()
    e('death-types').locator('input[value=cavalry]').uncheck()
    expect(e('visible')).to_contain_text('0 bot death markers')
    e('death-types').locator('input[value=cavalry]').check()
    e('squad').select_option('Demonstration squad'); expect(e('visible')).to_contain_text('1 soldiers')
    e('squad').select_option('')
    scrub(3500); e('follow').select_option('1'); expect(e('follow-status')).to_contain_text('Following recorded')
    scrub(8000); expect(e('follow-status')).to_contain_text('holding the final recorded position')
    scrub(3500); expect(e('follow-status')).to_contain_text('Following recorded')
    e('follow').select_option(''); e('camera').select_option('overhead')
    e('heatmap').check()
    with page.expect_download() as download:
        e('export-heat').click()
    csv = Path(download.value.path()).read_text()
    assert csv.startswith('x_m,y_m,soldier_seconds\n') and len(csv.splitlines()) > 1
    e('heatmap').uncheck(); scrub(8000)
    expect(e('strength').locator('[aria-label="Team 2 bots alive"]')).to_have_text('0')
    e('stage').scroll_into_view_if_needed(); page.screenshot(path=str(output / 'movement-parity.png'))
    e('clear-metadata').click(); expect(e('display-status')).to_contain_text('Using recorded fields')
    expect(e('play')).to_be_enabled()
    expect(e('soldier').locator('option[value="2"]')).to_contain_text('Player #2')
    # Measure frames on an explicit generated 600-soldier, 800-projectile burst fixture.
    stress = Path('tests/artifacts/experimental-replay/stress.jsonl')
    if stress.exists():
        e('file').set_input_files(str(stress)); expect(e('summary')).to_contain_text('602 entity lifetimes'); expect(e('play')).to_be_enabled()
        scrub(3000); expect(e('visible')).to_contain_text('128 projectiles')
        e('density').select_option('512'); expect(e('visible')).to_contain_text('512 projectiles')
        e('density').select_option('128')
        expect(e('visible')).to_contain_text('600 soldiers')
        timing = page.evaluate('''async () => {
          const timeline = document.querySelector('[data-exp=timeline]'), samples = [], intervals = [];
          let prev;
          for (let i=0;i<120;i++) {
            await new Promise(requestAnimationFrame); const start = performance.now();
            if(prev) intervals.push(start-prev); prev=start;
            timeline.value = 2900+i*5; timeline.dispatchEvent(new Event('input',{bubbles:true}));
            samples.push(performance.now()-start);
          }
          const stats = a => { a.sort((a,b)=>a-b); return {median_ms:a[Math.floor(a.length*.5)],p95_ms:a[Math.floor(a.length*.95)]}; };
          return {update_draw_submission:stats(samples),frame_interval:stats(intervals),frames:samples.length};
        }''')
    else: timing = None
    # Malformed imports preserve the prior valid session; torn files remain incomplete.
    e('file').set_input_files({'name': 'bad.jsonl', 'mimeType': 'application/x-ndjson', 'buffer': b'{bad}\n'})
    expect(e('status')).to_contain_text('Line 1: Malformed JSON')
    raw = Path('experimental_replays/EXP-20261029T074033Z-1.jsonl').read_bytes()
    e('file').set_input_files({'name': 'torn.jsonl', 'mimeType': 'application/x-ndjson', 'buffer': raw.rsplit(b'\n', 2)[0] + b'\n{"t":'})
    expect(e('summary')).to_contain_text('INCOMPLETE'); expect(e('warnings')).to_contain_text('Unterminated final line')
    expect(e('play')).to_be_enabled()
    # No capabilities means unavailable, while supplied events remain inspectable.
    rows = [json.loads(line) for line in raw.splitlines()]; rows[0]['capabilities'] = {}
    e('file').set_input_files({'name': 'no-capabilities.jsonl', 'mimeType': 'application/x-ndjson', 'buffer': ('\n'.join(json.dumps(r) for r in rows)+'\n').encode()})
    expect(e('summary')).to_contain_text('Complete capture'); expect(e('play')).to_be_enabled()
    expect(page.locator('[data-layer=artillery]')).to_be_disabled()
    expect(page.locator('[data-layer=shots]')).to_be_enabled()
    # A newer import owns the worker result, even when it replaces a busy parser.
    if stress.exists():
        e('file').set_input_files(str(stress))
        rows[0]['id'] = 'SYNTHETIC-latest-import'; rows[0]['synthetic'] = True
        e('file').set_input_files({'name': 'latest.jsonl', 'mimeType': 'application/x-ndjson', 'buffer': ('\n'.join(json.dumps(r) for r in rows)+'\n').encode()})
        expect(e('title')).to_have_text('SYNTHETIC-latest-import'); expect(e('play')).to_be_enabled()
    assert not errors, errors
    report = {'browser': browser.version, 'renderer': 'Chromium headless / SwiftShader software WebGL', 'real_import_to_viewer_ms': round(import_ms, 1), 'stress': timing, 'page_errors': errors}
    (output / 'performance.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2)); browser.close()
