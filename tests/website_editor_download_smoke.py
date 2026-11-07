"""Download an edited, ready-to-install map in Chromium and inspect its ZIP."""
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import zipfile
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw, tempfile.TemporaryDirectory() as temporary:
    browser = pw.chromium.launch(headless=True,
        args=['--use-gl=angle', '--use-angle=swiftshader'],
        **({'executable_path': os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']}
           if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/_vercel/insights/script.js', lambda route: route.fulfill(
        status=200, content_type='application/javascript', body=''))
    page.goto(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5173')
    page.locator('#editor-tab').click()
    frame = page.frame_locator('iframe:not([hidden])')
    button = frame.locator('#download-files')
    expect(button).to_be_visible(timeout=60000)
    # Current unsaved edits must be included.
    expected = frame.locator('#asset').evaluate("""() => {
        const api=window.MapEditor, doc=api.exportDocument(), spawn=doc.spawn_points[0];
        api.placeAt(spawn.x_m,spawn.y_m);
        const edited=api.exportDocument();
        edited.placements[0].z_offset_m=-1.25;
        edited.placements[0].yaw_deg=47;
        edited.placements[0].scale=1.5;
        edited.settings.fog='350';
        edited.spawn_points[0].x_m+=1;
        api.loadDocument(edited);
        return api.exportDocument();
    }""")
    with page.expect_download(timeout=60000) as result:
        button.click()
    download = result.value
    destination = Path(temporary) / download.suggested_filename
    download.save_as(destination)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == 4
        assert not any(name.endswith('.py') for name in archive.namelist())
        assert json.loads(archive.read('placements.json')) == expected
        sco = archive.read('SceneObj/' + expected['source']['scene_id'] + '.sco')
        assert struct.unpack_from('<II', sco) == (0xfffffd33, 4)
        recipe = archive.read('scenes-snippet.txt').decode()
        assert len(recipe.splitlines()) == 4
        assert recipe.split()[2] == '256'
        assert 'No Python' in archive.read('README.txt').decode()
    expect(button).to_be_enabled()
    # A blocked export and a failed fetch must keep the current document intact.
    frame.locator('#asset').evaluate("""() => {
        const d=window.MapEditor.exportDocument(); d.settings.biome='snow';
        window.MapEditor.loadDocument(d);
    }""")
    button.click()
    expect(frame.locator('#status')).to_contain_text('Keep source')
    frame.locator('#asset').evaluate("""() => {
        const d=window.MapEditor.exportDocument(); d.settings.biome='source';
        window.MapEditor.loadDocument(d);
    }""")
    page.route('**/editor-downloads/**', lambda route: route.fulfill(status=503, body='Unavailable'))
    button.click()
    expect(frame.locator('#status')).to_contain_text('retry', timeout=30000)
    actual = frame.locator('#asset').evaluate('() => window.MapEditor.exportDocument()')
    assert actual == expected
    assert not errors, errors
    browser.close()
print('PASS: finished SCO ZIP, current edits, weather/spawns, biome blocking, and retry without lost edits.')
