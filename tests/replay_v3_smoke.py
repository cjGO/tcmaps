"""V3 browser acceptance against existing v2 data. No recorder/server changes."""
import json, os, sys, time
from urllib.parse import quote
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4181'
output = Path('tests/artifacts/replay-v3'); output.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=60000)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader'],
        **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']} if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page = browser.new_page(viewport={'width': 1560, 'height': 1100}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: (errors.append(str(e)), print('PAGE ERROR:', e, flush=True)))
    page.on('console', lambda e: errors.append(e.text) if e.type == 'error' and ('THREE.' in e.text or 'WebGL' in e.text) else None)
    pending = set()
    page.on('request', lambda r: pending.add(r.url))
    page.on('requestfinished', lambda r: pending.discard(r.url))
    page.on('requestfailed', lambda r: print('REQUEST FAILED:', r.url, r.failure, flush=True))
    page.route('**/_vercel/insights/script.js', lambda r: r.fulfill(status=200, body=''))
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
    print('Opening v3 tab', flush=True)
    try:
        page.goto(url + '/?tab=rotation', wait_until='domcontentloaded', timeout=120000)
    except Exception:
        print('Pending requests:', sorted(pending), flush=True)
        raise
    expect(page.locator('#replay3-viewer')).to_have_count(0)
    page.locator('#replay3-tab').click()
    expect(page.locator('#replay3-tab')).to_have_attribute('aria-selected', 'true')
    e = lambda key: page.locator('[data-v3="'+key+'"]')
    expect(e('file')).to_be_visible()
    print('Loading synthetic capture', flush=True)
    e('file').set_input_files('tests/fixtures/SYNTHETIC-replay-v3.jsonl')
    expect(e('title')).to_have_text('SYNTHETIC-replay-v3')
    expect(e('play')).to_be_enabled()
    expect(e('metrics')).to_contain_text('16')
    expect(e('hit-count')).to_have_text('(16)')
    expect(e('volleys').locator('button')).to_have_count(2)
    e('hit-list').get_by_role('button', name='Inspect shot', exact=False).first.click()
    expect(e('shot-facts')).to_contain_text('500 ms')
    expect(e('shot-evidence')).to_contain_text('inferred_from_recorded_shot_and_hit')
    expect(e('visible')).to_contain_text('inferred hit paths')
    e('frame-shot').click()
    e('stage').scroll_into_view_if_needed(); page.screenshot(path=str(output/'synthetic-inferred-hit.png'))
    def scrub(t): e('timeline').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input",{bubbles:true}))}', t)
    scrub(3350); first=e('combat-live').inner_text(); scrub(9000); scrub(3350); assert first==e('combat-live').inner_text()
    e('paths').uncheck(); expect(e('visible')).to_contain_text('0 inferred hit paths'); e('paths').check()
    e('hit-search').fill('not-a-player'); expect(e('hit-count')).to_have_text('(0)'); e('hit-search').fill('')
    e('hit-order').select_option('range'); e('hit-next').click(); expect(e('hit-page')).to_have_text('2 / 2'); e('hit-prev').click()
    e('watch-shot').click(); expect(e('play')).to_have_attribute('aria-pressed','true')
    expect(e('play')).to_have_attribute('aria-pressed','false',timeout=15000)
    e('volleys').locator('button').first.click(); expect(e('clip-status')).to_contain_text('12-shot volley'); e('play').click()
    with page.expect_download() as download: e('export-paths').click()
    csv=Path(download.value.path()).read_text(); assert len(csv.splitlines())==17 and 'inferred_from_recorded_shot_and_hit' in csv
    print('Synthetic paths, seeking, playback and CSV passed', flush=True)
    # Shared encoder, independent v3 composition. Compare rendered frames with
    # inferred paths enabled/disabled, then encode and decode a short real MP4.
    scrub(3250); e('mp4').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Scrub the preview', timeout=60000)
    expect(page.locator('[data-video=preview] canvas')).to_have_count(1)
    page.locator('[data-video=start]').fill('2'); page.locator('[data-video=start]').dispatch_event('change')
    page.locator('[data-video=end]').fill('3'); page.locator('[data-video=end]').dispatch_event('change')
    expect(page.locator('[data-video=status]')).to_contain_text('Scrub the preview')
    def preview_at(t):
        page.locator('[data-video=timeline]').evaluate('(e,t)=>{e.value=t;e.dispatchEvent(new Event("input"))}',t)
        return page.locator('[data-video=preview] canvas').evaluate('e=>e.toDataURL()')
    enabled_frame=preview_at(2.25)
    page.screenshot(path=str(output/'v3-video-preview.png'))
    page.locator('[data-video=close]').click(); e('paths').uncheck(); e('mp4').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Scrub the preview')
    disabled_frame=preview_at(2.25)
    assert enabled_frame!=disabled_frame, 'Inferred paths missing from export composition'
    page.locator('[data-video=close]').click(); e('paths').check(); e('mp4').click()
    expect(page.locator('[data-video=status]')).to_contain_text('Scrub the preview')
    page.evaluate("""() => {
      window.videoFile={bytes:new Uint8Array(0),committed:false};
      window.showSaveFilePicker=async()=>({createWritable:async()=>({
        async write({data,position}) { const next=new Uint8Array(Math.max(videoFile.bytes.length,position+data.byteLength));
          next.set(videoFile.bytes);next.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),position);videoFile.bytes=next; },
        async close(){videoFile.committed=true;window.videoBlob=new Blob([videoFile.bytes],{type:'video/mp4'});},
        async abort(){videoFile.aborted=true;}
      })});
      for(const [key,value] of Object.entries({start:'2',end:'2.25',speed:'0.25',resolution:'720'})) document.querySelector(`[data-video=${key}]`).value=value;
      document.querySelector('[data-video=resolution]').dispatchEvent(new Event('change'));
    }""")
    expect(page.locator('[data-video=save]')).to_be_enabled()
    page.locator('[data-video=save]').click()
    expect(page.locator('[data-video=status]')).to_have_text('MP4 saved.',timeout=180000)
    video_info=page.evaluate("""async()=>{const video=document.createElement('video');video.muted=true;video.src=URL.createObjectURL(videoBlob);
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
      const info={width:video.videoWidth,height:video.videoHeight,duration:video.duration,bytes:videoFile.bytes.length,committed:videoFile.committed};
      URL.revokeObjectURL(video.src);return info;}""")
    assert video_info['width']==1280 and video_info['height']==720 and abs(video_info['duration']-1)<.04 and video_info['committed'],video_info
    print('V3 MP4 encoded and decoded:',video_info,flush=True)
    page.locator('[data-video=close]').click()
    # A malformed import retains the valid session.
    e('file').set_input_files({'name':'bad.jsonl','mimeType':'application/x-ndjson','buffer':b'{bad}\n'})
    expect(e('status')).to_contain_text('Malformed JSON'); expect(e('title')).to_have_text('SYNTHETIC-replay-v3')
    expect(e('play')).to_be_enabled()
    print('Video preview and invalid input passed', flush=True)
    # Real captures, selected by content, not by a current map-slot assignment.
    candidates=sorted(Path('experimental_replays').glob('*.jsonl'),key=lambda p:p.stat().st_size,reverse=True)
    real=next(p for p in candidates if json.loads(p.open().readline()).get('version')==2)
    start=time.monotonic(); e('file').set_input_files(str(real)); expect(e('title')).to_have_text(real.stem)
    expect(e('play')).to_be_enabled(timeout=120000); import_ms=(time.monotonic()-start)*1000
    path_count=int(e('hit-count').inner_text().strip('()').replace(',','')); assert path_count>0
    e('hit-list').get_by_role('button',name='Inspect shot',exact=False).first.click()
    e('stage').scroll_into_view_if_needed(); page.screenshot(path=str(output/'real-musket-path.png'))
    real_title=e('title').inner_text()
    print('Real capture loaded with', path_count, 'inferred paths', flush=True)
    # Pause/release v3 graphics when leaving; v1/v2 remain usable.
    page.locator('#replays-tab').click(); expect(e('stage').locator('canvas')).to_have_count(0)
    expect(page.locator('#replays-tab')).to_have_attribute('aria-selected','true')
    page.locator('#replay3-tab').click(); expect(e('play')).to_be_enabled(); expect(e('title')).to_have_text(real_title)
    page.set_viewport_size({'width':390,'height':844}); e('stage').scroll_into_view_if_needed()
    page.screenshot(path=str(output/'mobile.png'))
    overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')
    if overflow: print('Mobile overflow:',page.evaluate('''()=>[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,cls:String(e.className),right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+2).slice(0,20)'''),flush=True)
    assert not overflow, 'mobile horizontal overflow'
    page.set_viewport_size({'width':1560,'height':1100})
    page.goto(url+'/?tab=replay3&replay='+quote(real_title)+'&t=1',wait_until='domcontentloaded')
    expect(e('title')).to_have_text(real_title); expect(e('play')).to_be_enabled()
    expect(e('time')).to_contain_text('0:01.000')
    assert 'tab=replay3' in page.url and 'replay=' in page.url
    assert not errors, errors
    (output/'acceptance.json').write_text(json.dumps({'real_capture':real.name,'real_inferred_paths':path_count,'import_ms':import_ms,'video':video_info,'browser_errors':errors,'mobile_overflow':overflow},indent=2))
    print((output/'acceptance.json').read_text(),flush=True)
    browser.close()
