# The project lead's review switcher: a saved sign-in for one review, a link to another, the switcher and the list.
from playwright.sync_api import sync_playwright
import json, os
API = 'http://localhost:8791'; APP = 'http://localhost:8766/index.html'; SECTION = 'http://localhost:8768/index.html'
G, C = 'joebtay/greylit-review-data', 'joebtay/cogimp-review-data'
errs = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name, extra)
    if not cond: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or None)
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    # as on Joe's laptop: the token sign-in saved for the cognitive review, from before the switcher
    ctx.add_init_script("sessionStorage.getItem('seeded')||(sessionStorage.setItem('seeded','1'),localStorage.setItem('rc:config', JSON.stringify({repo:'%s',token:'joe-token',api:'%s'})))" % (C, API))
    pg = ctx.new_page(); logs = []
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    cfg = lambda: pg.evaluate("JSON.parse(localStorage.getItem('rc:config'))")
    # 1. the link opens the grey literature review, not the saved one
    pg.goto(APP + '?repo=' + G + '&api=' + API); pg.wait_for_selector('.page')
    pg.wait_for_function("document.querySelector('#review-switch option:checked') && document.querySelector('#review-switch option:checked').textContent.includes('grey')", timeout=30000)
    check('a ?repo= link opens that review over the saved one', 'Made-up grey literature review' in pg.inner_text('#review-switch option:checked'))
    check('the saved sign-in now points at the linked review', cfg()['repo'] == G)
    # 2. the switcher fills itself from GitHub: both masters, never the platform repo or a team repo
    pg.wait_for_function("document.querySelectorAll('#review-switch option').length >= 3", timeout=30000)
    opts = pg.eval_on_selector_all('#review-switch option', 'os => os.map(o => o.value)')
    check('the switcher lists both reviews and the full list', opts == [G, C, '#reviews'], str(opts))
    check('the platform repo and team repo are left out', 'joebtay/review-coder' not in opts and 'joebtay/cogimp-team' not in opts)
    pg.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'switcher.png'))
    # 3. switching opens the other review with the same token, no sign-in
    pg.select_option('#review-switch', C)
    pg.wait_for_function("document.querySelector('#review-switch option:checked') && document.querySelector('#review-switch option:checked').textContent.includes('cognitive')", timeout=30000)
    from urllib.parse import unquote
    check('switching opens the other review without signing in', pg.locator('#token').count() == 0)
    check('the address and the saved sign-in follow the switch', ('repo=' + C) in unquote(pg.url) and cfg()['repo'] == C)
    # 4. a plain reload stays on the review last opened
    pg.goto(APP + '?api=' + API); pg.wait_for_selector('#review-switch')
    check('a plain address opens the review last opened', pg.eval_on_selector('#review-switch', 's => s.value') == C)
    # 5. the full list
    pg.select_option('#review-switch', '#reviews'); pg.wait_for_selector('#reviews-page')
    rows = pg.eval_on_selector_all('.review-row', 'rs => rs.map(r => r.dataset.repo)')
    check('Your reviews lists both, open one first', rows == [C, G], str(rows))
    pg.screenshot(path=os.path.join(os.environ.get('SHOTS', '.'), 'reviews.png'))
    pg.click('.review-row[data-repo="%s"] >> text=Open' % G)
    pg.wait_for_function("document.querySelector('#review-switch') && document.querySelector('#review-switch').value === '%s'" % G, timeout=30000)
    check('Open on the list switches review', cfg()['repo'] == G)
    # 6. remove from list, and Look for reviews brings nothing hidden back
    pg.goto(APP + '?api=' + API + '#/reviews'); pg.wait_for_selector('#reviews-page')
    pg.click('.review-row[data-repo="%s"] >> text=Remove from list' % C)
    pg.click('#reviews-find'); pg.wait_for_function("document.getElementById('reviews-msg').textContent && !document.getElementById('reviews-msg').textContent.includes('Looking')")
    rows = pg.eval_on_selector_all('.review-row', 'rs => rs.map(r => r.dataset.repo)')
    check('a removed review stays off the list after looking again', rows == [G], str(rows))
    pg.fill('#reviews-add', C); pg.click('#reviews-add-go')
    pg.wait_for_function("document.querySelector('#review-switch') && document.querySelector('#review-switch').value === '%s'" % C, timeout=30000)
    check('Add and open brings it back', C in pg.eval_on_selector_all('#review-switch option', 'os => os.map(o => o.value)'))
    # 7. sign out still clears everything
    pg.once('dialog', lambda d: d.accept())
    pg.click('text=Sign out'); pg.wait_for_selector('#token')
    check('sign out clears the saved sign-in and the list', cfg() is None)
    # 8. the coders' Cloudflare section: name-and-password sign-in, no switcher
    pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
    pg2.goto(SECTION); pg2.wait_for_selector('#signin-form')
    check('the Cloudflare section shows its own sign-in and no switcher', pg2.locator('#review-switch').count() == 0 and pg2.locator('#token').count() == 0)
    check('no page errors', not logs, '; '.join(logs))
    b.close()
print('ALL PASS' if not errs else 'FAILED: ' + ', '.join(errs))
raise SystemExit(1 if errs else 0)
