"""Browser integration check; run against npm run preview or the dev server."""
import json
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'lib/editor-maps.json').read_text())
errors = []
with sync_playwright() as pw, tempfile.TemporaryDirectory() as downloads:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.click('#review-tab')
    page.click('#keep')
    assert page.locator('#keep-count').inner_text() == '1 kept'
    page.click('#good-tab')
    selected = page.locator('#good-filename').inner_text()
    page.click('#good-edit')
    assert page.locator('#editor-tab').get_attribute('aria-selected') == 'true'
    assert page.locator('#editor-map option').count() == len(manifest)
    frame = page.frame_locator('iframe:not([hidden])')
    frame.locator('#asset option').first.wait_for(state='attached')
    assert frame.locator('#scene-name').inner_text() == selected[:-4]
    assert frame.locator('#asset option').count() == 282
    frame.locator('#heatmap').evaluate('(img) => img.decode()')
    frame.locator('#overlay').click(position={'x': 2, 'y': 2})
    assert frame.locator('#count').inner_text() == '0 objects'
    frame.locator('#overlay').click()
    assert frame.locator('#count').inner_text() == '1 object'
    frame.locator('#yaw').fill('123')
    frame.locator('#yaw').press('Tab')
    frame.locator('#scale').fill('1.4')
    frame.locator('#scale').press('Tab')
    frame.locator('#biome').select_option('snow_forest')
    frame.locator('#fog').select_option('medium')
    frame.locator('#precipitation').select_option('snow')
    frame.locator('#precipitation_intensity').fill('15')
    frame.locator('#precipitation_intensity').press('Tab')
    frame.locator('#thunder').select_option('lightning')
    frame.locator('#thunder_frequency').fill('30')
    frame.locator('#thunder_frequency').press('Tab')
    frame.locator('#undo').click()
    assert frame.locator('#thunder_frequency').input_value() == '50'
    frame.locator('#redo').click()
    assert frame.locator('#thunder_frequency').input_value() == '30'
    frame.locator('#zoom').select_option('2')
    frame.locator('#zoom').select_option('1')
    frame.locator('#select').click()
    frame.locator('#point-list').select_option(index=0)
    frame.locator('#x').fill('400.123')
    frame.locator('#x').press('Tab')
    frame.locator('#overlay').scroll_into_view_if_needed()
    marker = frame.locator('.point circle').bounding_box()
    page.mouse.move(marker['x'] + marker['width']/2, marker['y'] + marker['height']/2)
    page.mouse.down()
    page.mouse.move(marker['x'] + 30, marker['y'] + 15, steps=5)
    page.mouse.up()
    assert frame.locator('#x').input_value() != '400.123'
    frame.locator('#undo').click()
    frame.locator('#point-list').select_option(index=0)
    assert frame.locator('#x').input_value() == '400.123'
    with page.expect_download() as download:
        frame.locator('#export').click()
    saved = Path(downloads) / download.value.suggested_filename
    download.value.save_as(saved)
    data = json.loads(saved.read_text())
    first_map = manifest[0]
    project = json.loads((ROOT / 'public' / first_map['project']).read_text())
    assert data['version'] == 2 and data['source'] == project['source']
    assert len(data['placements']) == 1
    assert data['placements'][0]['x_m'] == 400.123
    assert data['placements'][0]['yaw_deg'] == 123 and data['placements'][0]['scale'] == 1.4
    assert data['settings'] == dict(biome='snow_forest', fog='medium', precipitation='snow', precipitation_intensity=15, thunder='lightning', thunder_frequency=30)
    frame.locator('#delete').click()
    assert frame.locator('#count').inner_text() == '0 objects'
    frame.locator('#file').set_input_files(saved)
    assert frame.locator('#count').inner_text() == '1 object'
    page.click('#review-tab')
    assert page.locator('#keep-count').inner_text() == '1 kept'
    page.click('#editor-tab')
    assert frame.locator('#count').inner_text() == '1 object'
    for map_info in manifest[1:]:
        page.select_option('#editor-map', map_info['id'])
        frame.locator('#asset option').first.wait_for(state='attached')
        frame.locator('#heatmap').evaluate('(img) => img.decode()')
        assert frame.locator('#scene-name').inner_text() == map_info['id']
        assert frame.locator('#count').inner_text() == '0 objects'
    frame.locator('#file').set_input_files(saved)
    assert 'different map' in frame.locator('#status').inner_text()
    assert frame.locator('#count').inner_text() == '0 objects'
    page.select_option('#editor-map', first_map['id'])
    assert frame.locator('#count').inner_text() == '1 object'
    assert frame.locator('#biome').input_value() == 'snow_forest'
    # Hidden editor sessions still protect against accidental page exit.
    page.click('#good-tab')
    with page.expect_event('dialog') as event:
        page.evaluate('setTimeout(() => location.reload(), 0)')
    assert event.value.type == 'beforeunload'
    event.value.dismiss()
    page.click('#editor-tab')
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    frame.locator('#export').scroll_into_view_if_needed()
    assert frame.locator('#export').is_visible()
    assert not errors, errors
    browser.close()
print(f'PASS: {len(manifest)} maps, editing, import/export, map/tab preservation, unsaved warning, mobile layout.')
