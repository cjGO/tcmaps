"""Browser/WebGL acceptance with labelled synthetic soldiers and measured terrain."""
import json
from pathlib import Path
import sys
import os
from playwright.sync_api import sync_playwright, expect

url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4175'
output=Path('tests/artifacts/replay'); output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--use-gl=angle','--use-angle=swiftshader'],
        **({'executable_path':os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page=browser.new_page(viewport={'width':1440,'height':1200},device_scale_factor=1)
    errors=[]
    page.route('**/_vercel/insights/script.js',lambda r:r.fulfill(status=200,body=''))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.goto(url)
    page.locator('.topology-live canvas.terrain-3d-surface').wait_for()
    page.locator('[data-replay=files]').set_input_files('tests/fixtures/SYNTHETIC-tactical-demo.replay.json')
    expect(page.locator('[data-replay=time]')).to_contain_text('320 visible',timeout=20000)
    expect(page.locator('[data-replay=time]')).to_contain_text('SYNTHETIC')
    page.locator('#topology-camera').select_option('overhead')
    canvas=page.locator('.topology-live canvas.terrain-3d-surface')
    def shot(name):
        canvas.evaluate('(e)=>e.scrollIntoView({block:"center"})')
        page.screenshot(path=str(output/name))
    shot('formations-cavalry.png')
    def scrub(t):
        page.locator('[data-replay=timeline]').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input",{bubbles:true}))}',str(t))
    scrub(45000); expect(page.locator('[data-replay=time]')).to_contain_text('291 visible')
    shot('deaths.png')
    scrub(60000); expect(page.locator('[data-replay=time]')).to_contain_text('292 visible')
    page.locator('#topology-scale').select_option('4')
    page.locator('#topology-camera').select_option('aerial')
    shot('height-4x.png')
    scrub(90000); expect(page.locator('[data-replay=time]')).to_contain_text('0 visible')
    scrub(110000); expect(page.locator('[data-replay=time]')).to_contain_text('292 visible')
    page.locator('[data-replay=bots]').uncheck(); expect(page.locator('[data-replay=time]')).to_contain_text('9 visible')
    page.locator('[data-replay=bots]').check()
    page.locator('[data-replay=heat]').check()
    shot('heatmap.png')
    with page.expect_download() as download: page.locator('[data-replay=export]').click()
    download.value.save_as(output/'heatmap.json')
    assert json.loads((output/'heatmap.json').read_text())['soldier_seconds']>0
    scrub(20000); page.locator('[data-replay=play]').click()
    page.wait_for_function('Number(document.querySelector("[data-replay=timeline]").value)>20000',timeout=15000)
    page.locator('[data-replay=play]').click(); expect(page.locator('[data-replay=play]')).to_have_text('Play')
    page.locator('[data-mode=heatmap]').click(); expect(canvas).to_have_count(0)
    page.locator('[data-mode="3d"]').click(); expect(page.locator('[data-replay=time]')).to_contain_text('visible')
    page.locator('[data-replay=clear]').click(); expect(page.locator('[data-replay=transport]')).to_be_hidden()
    bad=json.loads(Path('tests/fixtures/SYNTHETIC-tactical-demo.replay.json').read_text()); bad['terrain_sha256']='0'*64
    page.locator('[data-replay=files]').set_input_files({'name':'bad.replay.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
    expect(page.locator('[data-replay=status]')).to_contain_text('checksum mismatch')
    engine=Path('tests/artifacts/replay/ENGINE-PROBE-101.replay.json')
    if engine.exists():
        page.locator('[data-replay=files]').set_input_files(str(engine))
        try: expect(page.locator('[data-replay=time]')).to_contain_text('400 visible',timeout=60000)
        except Exception:
            print(page.locator('.rotation-topology').inner_text() if page.locator('.rotation-topology').count() else page.locator('body').inner_text()[-5000:])
            print('Browser errors:',errors)
            raise
        scrub(250000)
        expect(page.locator('[data-replay=time]')).to_contain_text('400 visible')
        shot('engine-400.png')
    assert not errors,errors
    browser.close()
print('PASS: replay controls, 320 soldiers, cavalry, deaths, gap hiding, respawn, player filter, height 4x, heatmap export, disposal, checksum rejection')
