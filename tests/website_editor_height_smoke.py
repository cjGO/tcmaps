"""Browser regression check for sinking selected buildings with Alt-drag."""
import os
import sys
from playwright.sync_api import sync_playwright
import json
with sync_playwright() as pw:
 executable=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
 browser=pw.chromium.launch(**({'executable_path':executable} if executable else {}))
 page=browser.new_page(viewport={'width':1500,'height':1100})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4173')
 page.locator('#editor-tab').click()
 frame=page.frame_locator('iframe:not([hidden])')
 canvas=frame.locator('canvas.terrain-3d-surface')
 canvas.wait_for(timeout=60000)
 frame.locator('#editor-three-message').wait_for(state='hidden',timeout=60000)
 frame.locator('#asset').select_option('spr_village_house_e')
 frame.locator('#asset').evaluate("el=>window.MapEditor.placeAt(200,300)")
 page.wait_for_function("()=>!document.querySelector('iframe:not([hidden])').contentDocument.getElementById('editor-focus').disabled",timeout=60000)
 frame.locator('#editor-focus').click()
 canvas.scroll_into_view_if_needed()
 box=canvas.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
 page.keyboard.down('Alt');page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y+80,steps=8);page.mouse.up();page.keyboard.up('Alt')
 state=frame.locator('#asset').evaluate('el=>window.MapEditor.getState()')
 p=state['document']['placements'][0]
 assert p.get('z_offset_m')==-4,p
 assert p['x_m']==200 and p['y_m']==300,p
 frame.locator('#undo').click()
 assert frame.locator('#asset').evaluate('el=>window.MapEditor.getState().document.placements[0].z_offset_m||0')==0
 frame.locator('#redo').click()
 frame.locator('#point-list').select_option(p['id'])
 assert frame.locator('#z-offset').input_value()=='-4'
 frame.locator('#z-lower').click()
 assert frame.locator('#z-offset').input_value()=='-4.25'
 assert not errors,errors
 print(json.dumps({'placement':p,'errors':errors,'undo_redo':'passed'}))
 browser.close()
