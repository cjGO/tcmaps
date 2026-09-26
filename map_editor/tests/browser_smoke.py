"""Exercise a prepared standalone editor in Chromium (optional Playwright check)."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('--browser', help='Optional Chromium executable path')
    args = parser.parse_args()
    project = args.project.resolve()
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.browser)
        page = browser.new_page(viewport={'width':1440,'height':1000}, device_scale_factor=1.5)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((project/'editor.html').as_uri())
        page.locator('#heatmap').wait_for()
        page.wait_for_function('document.getElementById("heatmap").complete')
        assert page.locator('#asset option').count() > 50
        page.select_option('#biome','snow_forest')
        page.select_option('#fog','medium')
        page.click('#undo');assert page.input_value('#fog')=='source'
        page.click('#redo');assert page.input_value('#fog')=='medium'
        page.select_option('#precipitation','snow')
        page.fill('#precipitation_intensity','15');page.locator('#precipitation_intensity').press('Tab')
        page.select_option('#thunder','lightning')
        page.fill('#thunder_frequency','30');page.locator('#thunder_frequency').press('Tab')
        page.locator('summary').click()
        page.select_option('#asset', 'spr_mm_tree_pine1')

        def target(x=None, y=None, u=None, v=None):
            return page.evaluate('''p => {
              const project=JSON.parse(document.getElementById('project-data').textContent);
              const c=project.calibration, b=project.bounds;
              const image=p.u===null?MapCoordinates.worldToImage(p.x??(b.x_min_m+b.x_max_m)/2,p.y??(b.y_min_m+b.y_max_m)/2,c):{u:p.u,v:p.v};
              const svg=document.getElementById('overlay');
              const viewport=document.getElementById('viewport');
              viewport.scrollLeft=image.u*svg.getBoundingClientRect().width-viewport.clientWidth/2;
              viewport.scrollTop=image.v*svg.getBoundingClientRect().height-viewport.clientHeight/2;
              const r=svg.getBoundingClientRect();
              return {x:r.left+image.u*r.width,y:r.top+image.v*r.height};
            }''', dict(x=x,y=y,u=u,v=v))

        margin=target(u=.02,v=.02);page.mouse.click(**margin)
        assert page.locator('#count').inner_text()=='0 objects'
        centre=target();page.mouse.click(**centre)
        assert page.locator('#count').inner_text()=='1 object'
        initial_x=float(page.input_value('#x'));initial_y=float(page.input_value('#y'))
        page.fill('#yaw','123');page.locator('#yaw').press('Tab')
        page.fill('#scale','1.4');page.locator('#scale').press('Tab')
        marker=page.locator('.point circle').bounding_box()
        page.mouse.move(marker['x']+marker['width']/2,marker['y']+marker['height']/2)
        page.mouse.down();page.mouse.move(centre['x']+20,centre['y']+10,steps=4);page.mouse.up()
        assert float(page.input_value('#x'))!=initial_x
        page.click('#undo');page.select_option('#point-list',index=0)
        assert float(page.input_value('#x'))==initial_x
        page.click('#redo');page.select_option('#point-list',index=0)
        moved_x=float(page.input_value('#x'))
        page.click('#delete');assert page.locator('#count').inner_text()=='0 objects'
        page.click('#undo');assert page.locator('#count').inner_text()=='1 object'

        # Place another point after changing zoom, resizing, and scrolling.
        page.select_option('#zoom','2')
        page.set_viewport_size({'width':1050,'height':850})
        page.click('#place')
        point=target(x=initial_x-75,y=initial_y-50);page.mouse.click(**point)
        assert page.locator('#count').inner_text()=='2 objects'
        assert abs(float(page.input_value('#x'))-(initial_x-75))<1.5
        assert abs(float(page.input_value('#y'))-(initial_y-50))<1.5
        with page.expect_download() as download:
            page.click('#export')
        download.value.save_as(project/'browser.placements.json')
        document=json.loads((project/'browser.placements.json').read_text())
        assert document['version']==2
        assert document['settings']==dict(biome='snow_forest',fog='medium',precipitation='snow',precipitation_intensity=15,thunder='lightning',thunder_frequency=30)
        assert len(document['placements'])==2
        assert document['placements'][0]['x_m']==moved_x
        assert document['placements'][0]['yaw_deg']==123
        assert document['placements'][0]['scale']==1.4
        page.click('#delete');assert page.locator('#count').inner_text()=='1 object'
        page.set_input_files('#file',project/'browser.placements.json')
        page.wait_for_function('document.getElementById("count").textContent==="2 objects"')
        assert page.input_value('#biome')=='snow_forest'
        invalid=dict(document,source={})
        page.set_input_files('#file',{'name':'invalid.json','mimeType':'application/json','buffer':json.dumps(invalid).encode()})
        page.wait_for_function('document.getElementById("status").classList.contains("error")')
        assert page.locator('#count').inner_text()=='2 objects'
        page.select_option('#zoom','1');page.set_viewport_size({'width':1440,'height':1000})
        page.screenshot(path=str(project/'browser-check.png'),full_page=True)
        legacy=dict(document,version=1);del legacy['settings']
        page.set_input_files('#file',{'name':'legacy.json','mimeType':'application/json','buffer':json.dumps(legacy).encode()})
        page.wait_for_function('document.getElementById("fog").value==="source"')
        page.click('#undo');assert page.input_value('#fog')=='medium'
        assert errors==[], errors
        browser.close()
    print('PASS: offline browser placement, dragging, transforms, undo/redo, delete, zoom, resize, JSON export/import, invalid input; no page errors')


if __name__=='__main__':
    main()
