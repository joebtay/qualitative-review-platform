from playwright.sync_api import sync_playwright
import sys
errs=[]
with sync_playwright() as p:
    import os; b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or None)
    pg=b.new_page(viewport={'width':1440,'height':1000})
    pg.on('pageerror',lambda e:errs.append('PAGEERROR '+str(e)))
    pg.on('console',lambda m:errs.append('CONSOLE '+m.text) if m.type=='error' else None)
    pg.goto('http://localhost:8765/index.html?demo')
    pg.wait_for_selector('.page')
    pg.screenshot(path='project.png')
    pg.click('nav a[data-k=documents]'); pg.wait_for_selector('table.docs'); pg.screenshot(path='docs.png')
    pg.click('table.docs a'); pg.wait_for_selector('.crumbs'); pg.screenshot(path='doc.png')
    pg.click('nav a[data-k=verify]'); pg.wait_for_selector('text=Draw a verification sample')
    pg.click('text=Preview draw'); pg.wait_for_selector('text=Lock and save'); pg.screenshot(path='sampler.png')
    pg.click('text=Lock and save'); pg.wait_for_selector('.ucard'); pg.screenshot(path='verify.png')
    print('verify ok')
print('\n'.join(errs) or 'no errors')
