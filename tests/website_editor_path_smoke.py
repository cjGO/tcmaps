"""Connected-path browser check; run against the dev or preview server."""
import os
import sys
from playwright.sync_api import sync_playwright
import json
with sync_playwright() as pw:
 executable=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
 browser=pw.chromium.launch(**({'executable_path':executable} if executable else {}))
 page=browser.new_page(viewport={'width':1500,'height':1100})
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4173')
 page.locator('#editor-tab').click()
 frame=page.frame_locator('iframe:not([hidden])')
 frame.locator('#editor-three canvas.terrain-3d-surface').wait_for(timeout=60000)
 frame.locator('#editor-three-message').wait_for(state='hidden',timeout=60000)
 frame.locator('#asset-favorite').click()
 frame.locator('.modes button',has_text='Place on line').click()
 frame.locator('#line-favorites .line-asset-row > label input').first.check()
 canvas=frame.locator('#editor-three canvas.terrain-3d-surface')
 canvas.scroll_into_view_if_needed()
 box=canvas.bounding_box()
 def click(x,y):
  page.mouse.click(box['x']+box['width']*x,box['y']+box['height']*y)
 click(.35,.5);click(.55,.5);click(.55,.65);click(.4,.65)
 summary=frame.locator('#line-path-summary').inner_text()
 # Drag the start marker, retaining all segments and changing the route length.
 canvas.scroll_into_view_if_needed();box=canvas.bounding_box()
 page.mouse.move(box['x']+box['width']*.35,box['y']+box['height']*.5)
 page.mouse.down()
 page.mouse.move(box['x']+box['width']*.32,box['y']+box['height']*.47,steps=5)
 page.mouse.up()
 dragged=frame.locator('#line-path-summary').inner_text()
 assert '3 segments' in dragged,dragged
 assert dragged!=summary,(summary,dragged)
 summary=dragged
 assert '3 segments' in summary,summary
 assert frame.locator('#line-place').is_disabled()
 frame.locator('#line-finish').click()
 frame.locator('#line-place').wait_for(state='visible')
 page.wait_for_function("() => !document.querySelector('iframe:not([hidden])').contentDocument.getElementById('line-place').disabled",timeout=60000)
 # Clicking terrain after finishing does not extend the path.
 canvas.scroll_into_view_if_needed();box=canvas.bounding_box();click(.7,.65)
 assert frame.locator('#line-path-summary').inner_text()==summary
 frame.locator('#line-finish').click()
 canvas.scroll_into_view_if_needed();box=canvas.bounding_box();click(.65,.6)
 assert '4 segments' in frame.locator('#line-path-summary').inner_text()
 frame.locator('#line-remove').click()
 assert frame.locator('#line-path-summary').inner_text()==summary
 frame.locator('#line-finish').click()
 canvas.scroll_into_view_if_needed()
 frame.locator('#line-place').click()
 assert frame.locator('#count').inner_text()=='10 objects'
 frame.locator('#undo').click()
 assert frame.locator('#count').inner_text()=='0 objects'
 assert not errors,errors
 print(json.dumps({'summary':summary,'errors':errors,'placed_and_undone':10}))
 browser.close()
