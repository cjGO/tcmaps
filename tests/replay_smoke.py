"""Browser/WebGL acceptance with labelled synthetic soldiers and measured terrain."""
import json
from pathlib import Path
import sys
import os
import re
from playwright.sync_api import sync_playwright, expect

url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4175'
output=Path('tests/artifacts/replay'); output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--use-gl=angle','--use-angle=swiftshader'],
        **({'executable_path':os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page=browser.new_page(viewport={'width':1440,'height':1200},device_scale_factor=1)
    page.set_default_timeout(120000)
    page.add_init_script('''window.replayLabelText = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (String(text).startsWith('Player #') || text === '<Recorded player>') window.replayLabelText.push(text);
        return fillText.call(this, text, ...args);
      };''')
    errors=[]
    page.route('**/_vercel/insights/script.js',lambda r:r.fulfill(status=200,body=''))
    page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''))
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.goto(url, wait_until='domcontentloaded', timeout=120000)
    page.locator('.topology-live canvas.terrain-3d-surface').wait_for()
    page.locator('#replays-tab').click()
    expect(page.locator('#replay-catalog button').first).to_have_attribute('aria-pressed','true')
    expect(page.locator('[data-replay=play]')).to_be_enabled(timeout=30000)
    expect(page.locator('#replays-panel canvas.terrain-3d-surface')).to_have_count(1)
    page.locator('#rotation-tab').click()
    expect(page.locator('#rotation-replays')).to_be_hidden()
    # Rotation order and permanent map IDs evolve independently of scene slots.
    # Find a map with recordings instead of assuming the third image has them.
    page.locator('#rotation-panel [data-mode=heatmap]').click()
    found=page.evaluate('''() => {
      const total = Number(document.getElementById('rotation-count').textContent.split('/')[1]);
      for (let i=0; i<total; i++) {
        document.getElementById('rotation-next').click();
        if (!document.getElementById('rotation-replays').hidden) return true;
      }
      return false;
    }''')
    assert found, 'No current rotation map has replay links'
    expect(page.locator('#rotation-filename')).to_have_text(re.compile(r'test_map_\d+'))
    expect(page.locator('#rotation-replays')).to_be_visible()
    page.locator('#rotation-replays').click()
    expect(page.locator('#replays-tab')).to_have_attribute('aria-selected','true')
    expect(page.locator('#rotation-panel [data-replay=files]')).to_have_count(0)
    catalog=page.locator('#replay-catalog button')
    if catalog.count():
        catalog.first.click()
        expect(page.locator('[data-replay=play]')).to_be_enabled(timeout=30000)
        expect(page.locator('#replays-panel canvas.terrain-3d-surface')).to_have_count(1)
        page.locator('[data-replay=clear]').click()
    page.locator('[data-replay=files]').set_input_files('tests/fixtures/SYNTHETIC-tactical-demo.replay.json')
    expect(page.locator('[data-replay=play]')).to_be_enabled(timeout=120000)
    expect(page.locator('[data-replay=time]')).to_contain_text('320 visible',timeout=20000)
    expect(page.locator('[data-replay=time]')).to_contain_text('SYNTHETIC')
    strength=page.locator('[data-replay=strength]')
    team1=strength.get_by_label('Team 1 bots alive',exact=True)
    team2=strength.get_by_label('Team 2 bots alive',exact=True)
    expect(team1).to_have_text('152'); expect(team2).to_have_text('160')
    page.locator('#replays-topology-camera').select_option('overhead')
    page.locator('[data-replay=player-names]').check()
    assert page.evaluate('window.replayLabelText.includes("Player #1")')
    canvas=page.locator('#replays-panel .topology-live canvas.terrain-3d-surface')
    def shot(name):
        canvas.evaluate('(e)=>e.scrollIntoView({block:"center"})')
        page.screenshot(path=str(output/name), timeout=60000)
    shot('formations-cavalry.png')
    def scrub(t):
        page.locator('[data-replay=timeline]').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input",{bubbles:true}))}',str(t))
    follow=page.locator('[data-replay=follow]')
    follow_status=page.locator('[data-replay=follow-status]')
    follow.select_option('2')
    expect(follow_status).to_contain_text('following recorded position and facing')
    expect(page.locator('[data-replay=time]')).to_contain_text('319 visible')
    expect(page.locator('#replays-panel [data-ui=exit]')).to_have_text('Exit soldier view')
    scrub(45000)
    expect(follow_status).to_contain_text('died; camera held')
    page.locator('[data-replay=play]').click()
    page.wait_for_function('Number(document.querySelector("[data-replay=timeline]").value)>45000')
    expect(follow_status).to_contain_text('died; camera held')
    page.locator('[data-replay=play]').click()
    scrub(22500)
    expect(follow_status).to_contain_text('following recorded position and facing')
    shot('soldier-pov.png')
    canvas.focus();page.keyboard.press('Escape')
    expect(follow).to_have_value('')
    scrub(20000);follow.select_option('321')
    expect(follow_status).to_contain_text('waiting for first recorded position')
    scrub(60000)
    expect(follow_status).to_contain_text('following recorded position and facing')
    follow.select_option('1');scrub(90000)
    expect(follow_status).to_contain_text('recording gap; camera held')
    scrub(110000)
    expect(follow_status).to_contain_text('following recorded position and facing')
    page.locator('#replays-panel [data-ui=explore]').click()
    expect(follow).to_have_value('')
    page.locator('#replays-panel [data-ui=exit]').click()
    page.locator('#replays-topology-camera').select_option('overhead')
    scrub(45000); expect(page.locator('[data-replay=time]')).to_contain_text('291 visible')
    page.locator('[data-replay=deaths]').check()
    shot('deaths.png')
    page.locator('[data-replay=deaths]').uncheck()
    page.locator('[data-replay=deaths]').check()
    scrub(60000); expect(page.locator('[data-replay=time]')).to_contain_text('292 visible')
    page.locator('#replays-topology-scale').select_option('4')
    page.locator('#replays-topology-camera').select_option('aerial')
    shot('height-4x.png')
    scrub(90000); expect(page.locator('[data-replay=time]')).to_contain_text('0 visible')
    expect(team1).to_have_text('138'); expect(team2).to_have_text('145')
    scrub(110000); expect(page.locator('[data-replay=time]')).to_contain_text('292 visible')
    page.locator('[data-replay=bots]').uncheck(); expect(page.locator('[data-replay=time]')).to_contain_text('9 visible')
    expect(team1).to_have_text('138'); expect(team2).to_have_text('145')
    chart=strength.locator('svg')
    chart.click(position={'x':45,'y':60})
    expect(team1).to_have_text('152'); expect(team2).to_have_text('160')
    scrub(110000)
    page.locator('[data-replay=bots]').check()
    page.locator('[data-replay=trails]').check()
    shot('trails.png')
    page.locator('[data-replay=squad]').select_option('1:2')
    expect(page.locator('[data-replay=time]')).to_contain_text('visible')
    shot('squad-trails.png')
    page.locator('[data-replay=squad]').select_option('')
    page.locator('[data-replay=soldier]').select_option('1')
    expect(page.locator('[data-replay=time]')).to_contain_text('1 visible')
    shot('soldier-trail.png')
    page.locator('[data-replay=soldier]').select_option('')
    page.locator('[data-replay=heat]').check()
    shot('heatmap.png')
    scrub(20000); shot('history-rewound.png')
    scrub(110000)
    with page.expect_download() as download: page.locator('[data-replay=export]').click()
    download.value.save_as(output/'heatmap.json')
    assert json.loads((output/'heatmap.json').read_text())['soldier_seconds']>0
    scrub(20000); page.locator('[data-replay=play]').click()
    page.wait_for_function('Number(document.querySelector("[data-replay=timeline]").value)>20000',timeout=15000)
    page.locator('[data-replay=play]').click(); expect(page.locator('[data-replay=play]')).to_have_text(re.compile(r'Play$'))
    page.locator('#rotation-tab').click(); expect(canvas).to_have_count(0)
    page.locator('#replays-tab').click(); expect(page.locator('[data-replay=time]')).to_contain_text('visible')
    page.locator('[data-replay=clear]').click(); expect(page.locator('[data-replay=transport]')).to_be_hidden()
    named=json.loads(Path('tests/fixtures/SYNTHETIC-tactical-demo.replay.json').read_text())
    rows=[json.loads(line) for line in named['journal'].splitlines()]
    rows[0]['id'] += '-named'
    for row in rows:
        if row['type']=='entity' and row['id']==40:
            row['player_name']='<Recorded player>'; row['unit_category']='artillery'
    named['journal']=''.join(json.dumps(row)+'\n' for row in rows)
    page.locator('[data-replay=files]').set_input_files({'name':'named.replay.json','mimeType':'application/json','buffer':json.dumps(named).encode()})
    expect(page.locator('[data-replay=play]')).to_be_enabled(timeout=120000)
    expect(page.locator('[data-replay=time]')).to_contain_text('320 visible',timeout=20000)
    assert page.evaluate('window.replayLabelText.includes("<Recorded player>")')
    page.locator('[data-replay=player-names]').uncheck()
    page.locator('[data-replay=player-names]').check()
    shot('player-names-and-artillery.png')
    page.locator('[data-replay=clear]').click()
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
