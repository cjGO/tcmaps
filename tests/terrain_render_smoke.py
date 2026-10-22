"""Render regression for both 3D views; requires Playwright Chromium and Pillow.

uv run --with playwright --with pillow python tests/terrain_render_smoke.py URL
PLAYWRIGHT_CHROMIUM_EXECUTABLE optionally selects an existing Chromium binary.
MAPROOM_SCREENSHOT_DIR optionally retains rendering evidence.
"""
from io import BytesIO
import json
import os
from pathlib import Path
import sys

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
artifacts = Path(os.environ["MAPROOM_SCREENSHOT_DIR"]) if os.environ.get("MAPROOM_SCREENSHOT_DIR") else None
if artifacts:
    artifacts.mkdir(parents=True, exist_ok=True)
errors = []


def rendered(canvas, name):
    """The central canvas must contain a filled surface, not just its border."""
    image = Image.open(BytesIO(canvas.screenshot())).convert("RGB")
    if artifacts:
        image.save(artifacts / f"{name}.png")
    width, height = image.size
    background = image.getpixel((width // 2, 5))
    region = image.crop((int(width * .3), int(height * .38), int(width * .7), int(height * .78)))
    pixels = list(region.get_flattened_data() if hasattr(region, "get_flattened_data") else region.getdata())
    coverage = sum(max(abs(p[i] - background[i]) for i in range(3)) > 12 for p in pixels) / len(pixels)
    assert coverage > .12, f"{name}: terrain is missing ({coverage:.1%} of centre differs from sky)"
    assert not errors, "\n".join(errors)
    print(f"{name}: filled terrain covers {coverage:.1%} of centre", flush=True)
    return image


def assert_different(before, after, description):
    width, height = before.size
    box = (int(width * .3), int(height * .38), int(width * .7), int(height * .78))
    difference = ImageStat.Stat(ImageChops.difference(before.crop(box), after.crop(box)))
    assert max(difference.mean) > .5, f"{description}: rendered surface did not change"


with sync_playwright() as pw:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    browser = pw.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader"],
                                 **({"executable_path": executable} if executable else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
    # Vercel injects this optional analytics endpoint only on its hosting service.
    page.route("**/_vercel/insights/script.js", lambda route: route.fulfill(status=200, content_type="application/javascript", body=""))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.locator(".topology-live .terrain-experience").wait_for(state="visible")
    expect(page.locator("#rotation-filename")).to_have_text("scn_mp_custom_map_1.png")
    rotation = page.locator(".topology-live")
    canvas = rotation.locator(".terrain-3d-surface")
    natural = rendered(canvas, "rotation-natural")
    rotation.locator("summary").click()
    rotation.locator('[data-ui="surface"]').select_option("elevation")
    elevation = rendered(canvas, "rotation-elevation")
    assert_different(natural, elevation, "Natural/elevation toggle")
    rotation.locator('[data-ui="haze"]').uncheck()
    rotation.locator('[data-ui="shadows"]').uncheck()
    rendered(canvas, "rotation-no-haze-or-shadows")
    rotation.locator('[data-ui="surface"]').select_option("natural")
    rotation.locator('[data-ui="sun"]').fill("310")
    sun = rendered(canvas, "rotation-opposite-sun")
    assert_different(natural, sun, "Sun direction and atmospheric controls")
    rotation.locator("summary").click()
    page.locator("#topology-scale").select_option("2")
    rotation.locator('[data-ui="infantry"]').click()
    expect(rotation.locator('[data-ui="readout"]')).to_contain_text("Infantry")
    expect(page.locator("#topology-scale")).to_have_value("1")
    rendered(canvas, "rotation-infantry")
    assert rotation.locator('[data-ui="message"]').evaluate("""el => {
      const hud=el.closest('.terrain-hud').getBoundingClientRect(), message=el.getBoundingClientRect();
      return getComputedStyle(el).position==='static' && message.bottom<=hud.bottom;
    }"""), "Explorer status must stay inside its HUD"
    position = rotation.locator('[data-ui="position"]').inner_text()
    canvas.press("w", delay=350)
    expect(rotation.locator('[data-ui="position"]')).not_to_have_text(position)
    rotation.locator('[data-ui="mounted"]').click()
    expect(rotation.locator('[data-ui="readout"]')).to_contain_text("2.8 m")
    rendered(canvas, "rotation-mounted")
    rotation.locator('[data-ui="exit"]').click()
    expect(page.locator("#topology-scale")).to_have_value("2")

    page.locator("#rotation-edit").click()
    frame = page.frame_locator('iframe:not([hidden])')
    editor = frame.locator("#editor-three")
    editor.locator(".terrain-experience").wait_for(state="visible")
    expect(frame.locator("#editor-three-message")).to_be_hidden()
    terrain = editor.locator(".terrain-3d-surface")
    rendered(terrain, "editor-natural")
    document_frame = page.locator('iframe:not([hidden])').element_handle().content_frame()
    # Use the public placement bridge to provide a real native model for the render.
    document_frame.evaluate("""() => {
      const api=window.MapEditor, state=api.getState(), start=state.document.spawn_points[0];
      api.placeAt(start.x_m + 10, start.y_m + 10);
    }""")
    expect(frame.locator("#editor-focus")).to_be_enabled()
    # Pick a native prop in the visible palette and place it through the 3D canvas.
    document_frame.evaluate("window.MapEditor.setMode('place')")
    frame.locator('#asset-category').select_option('Furniture & containers')
    frame.locator('#search').fill('barrel')
    frame.locator('#asset').select_option('spr_barrel')
    frame.locator('#scale').fill('1.5')
    frame.locator('#scale').press('Tab')
    expect(frame.locator('#asset-preview-image img')).to_be_visible()
    page.wait_for_load_state('networkidle')
    size = terrain.bounding_box()
    terrain.click(position={'x': size['width'] * .5, 'y': size['height'] * .6})
    expect(frame.locator('#count')).to_have_text('2 objects')
    expect(frame.locator('#editor-focus')).to_be_enabled()
    frame.locator('#editor-focus').click()
    rendered(terrain, 'editor-barrel')
    for asset, category, x in [('spr_village_house_e', 'Buildings', 300),
                               ('spr_small_wall_a', 'Walls & fences', 330),
                               ('spr_stone_heap', 'Rocks & terrain', 360),
                               ('spr_bridge_wooden', 'Bridges & walkways', 390)]:
        document_frame.evaluate("window.MapEditor.setMode('place')")
        frame.locator('#search').fill('')
        frame.locator('#asset-category').select_option(category)
        frame.locator('#asset').select_option(asset)
        frame.locator('#scale').fill('1')
        frame.locator('#scale').press('Tab')
        frame.locator('#yaw').fill('90')
        frame.locator('#yaw').press('Tab')
        expect(frame.locator('#asset-preview-image img')).to_be_visible()
        document_frame.evaluate('(x) => window.MapEditor.placeAt(x, 320)', x)
        page.wait_for_load_state('networkidle')
        expect(frame.locator('#editor-focus')).to_be_enabled()
        frame.locator('#editor-focus').click()
        rendered(terrain, 'editor-' + asset)
        expect(frame.locator('.editor-model-info')).not_to_have_class('error')
    before = document_frame.evaluate("JSON.stringify(window.MapEditor.getState().document)")
    with page.expect_download() as download:
        frame.locator('#export').click()
    saved = Path(download.value.path()).read_text()
    assert json.loads(saved) == json.loads(before)
    assert [p['asset'] for p in json.loads(saved)['placements']][1:] == [
        'spr_barrel', 'spr_village_house_e', 'spr_small_wall_a', 'spr_stone_heap', 'spr_bridge_wooden']
    frame.locator('#delete').click()
    expect(frame.locator('#count')).to_have_text('5 objects')
    frame.locator('#file').set_input_files({'name': 'mixed-props.placements.json', 'mimeType': 'application/json', 'buffer': saved.encode()})
    expect(frame.locator('#count')).to_have_text('6 objects')
    assert document_frame.evaluate("JSON.stringify(window.MapEditor.getState().document)") == before
    # Select the building for a useful final render and player-height exploration.
    document_frame.evaluate("() => {const api=window.MapEditor;api.select(api.getState().document.placements[2].id);}")
    page.wait_for_load_state('networkidle')
    if artifacts:
        (artifacts / 'mixed-props.placements.json').write_text(saved)
    frame.locator("#editor-focus").click()
    rendered(terrain, "editor-selected-asset")
    editor.locator('[data-ui="infantry"]').click()
    rendered(terrain, "editor-infantry")
    position = editor.locator('[data-ui="position"]').inner_text()
    terrain.press("w", delay=350)
    expect(editor.locator('[data-ui="position"]')).not_to_have_text(position)
    editor.locator('[data-ui="mounted"]').click()
    rendered(terrain, "editor-mounted")
    editor.locator('[data-ui="exit"]').click()
    assert document_frame.evaluate("JSON.stringify(window.MapEditor.getState().document)") == before
    assert not errors, "\n".join(errors)
    print("PASS: both terrain views compile/render; graphics controls, infantry/mounted movement, overview restore, scenery placement and mixed loadout round trips work.")
    browser.close()
