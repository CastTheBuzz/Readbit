# Regression tests for bugs found by QA: unreachable pages, position drift, read-aloud failure, back button, listen page, sign-out, bad URLs
import re
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:8787'; fails=[]
def ok(c,m): print(('PASS ' if c else 'FAIL ')+m); c or fails.append(m)
with sync_playwright() as p:
    br=p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx=br.new_context(viewport={'width':390,'height':800}, is_mobile=True, has_touch=True)
    ctx.route('https://www.gutenberg.org/**', lambda r: r.abort()); ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B+'/'); pg.wait_for_selector('#lf'); pg.fill('input[name=pass]','test pass 123'); pg.click('#lf button'); pg.wait_for_selector('.wz, .shelf')
    if pg.locator('.wz').count():
        for _ in range(4): pg.click('#next'); pg.wait_for_timeout(200)
    info=lambda: pg.inner_text('.rd-pinfo')
    pg.goto(B+'/#/read/2680'); pg.wait_for_selector('.rd-ch', timeout=15000); pg.wait_for_timeout(800)
    # 1 ch2 with image: last paragraph reachable
    pg.evaluate("document.querySelector('[data-a=toc]').click()"); pg.wait_for_timeout(200)
    pg.locator('.p-item', has_text='Chapter 2').first.click(); pg.wait_for_timeout(1200)
    tot=int(re.search(r'of (\d+)', info()).group(1))
    lastp=pg.evaluate("""(()=>{const r=document.querySelector('.rd-ch'),cr=r.getBoundingClientRect(),pw=document.querySelector('.rd-view').clientWidth;const ps=r.querySelectorAll('p');const b=ps[ps.length-1].getClientRects();const x=b[b.length-1];return Math.floor((x.left-cr.left+r.scrollLeft)/pw)+1})()""")
    ok(lastp<=tot, f'ch2 last paragraph on page {lastp} of {tot}')
    # 7 rapid next at chapter end
    pg.evaluate(f"(()=>{{}})()")
    for _ in range(tot+2): pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(5)
    pg.wait_for_timeout(1500)
    ok('Chapter 3' in pg.inner_text('.rd-chname'), 'rapid next stops in chapter 3: '+pg.inner_text('.rd-chname')+' '+info())
    # 5 drift: font +4 / -4 and rotation
    for _ in range(3): pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(120)
    start=info(); first=pg.evaluate("(()=>{const v=document.querySelector('.rd-view').getBoundingClientRect();const r=document.caretRangeFromPoint(v.left+30,v.top+8);return r.startContainer.textContent.slice(r.startOffset,r.startOffset+25)})()")
    def bars():
        if not pg.evaluate("document.querySelector('.rd').classList.contains('bars')"): pg.evaluate("document.querySelector('.rd').classList.add('bars')"); pg.wait_for_timeout(250)
    bars()
    pg.click('[data-a=bm]'); pg.wait_for_timeout(200)
    pg.click('[data-a=aa]')
    for _ in range(4): pg.click('[data-a="p:size"][data-d="1"]'); pg.wait_for_timeout(250)
    for _ in range(4): pg.click('[data-a="p:size"][data-d="-1"]'); pg.wait_for_timeout(250)
    pg.click('[data-a="p:close"]'); pg.wait_for_timeout(300)
    ok(info()==start, f'font +4/-4 keeps page ({start} -> {info()})')
    ok(pg.evaluate("document.querySelector('[data-a=bm]').classList.contains('on')"), 'bookmark still shown after font change')
    for w,h in [(800,390),(390,800),(800,390),(390,800)]: pg.set_viewport_size({'width':w,'height':h}); pg.wait_for_timeout(500)
    ok(info()==start, f'rotation x4 keeps page ({start} -> {info()})')
    # 2 reload right after a page turn
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(50); want=info()
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    pg.reload(); pg.wait_for_selector('.rd-ch p', timeout=15000); pg.wait_for_timeout(1200)
    ok(info()==want, f'reload right after turn reopens same page ({want} -> {info()})')
    # 10 back closes panel
    bars()
    pg.click('[data-a=toc]'); pg.wait_for_timeout(200); pg.go_back(); pg.wait_for_timeout(500)
    ok('/#/read/' in pg.url and pg.evaluate("document.querySelector('.rd-panel').hidden"), 'back closes panel, stays in book')
    bars(); pg.click('[data-a=toc]'); pg.wait_for_timeout(200); pg.click('[data-a="p:close"]'); pg.wait_for_timeout(300)
    bars(); pg.click('[data-a=back]'); pg.wait_for_timeout(800)
    ok('/#/read/' not in pg.url, 'back arrow leaves book after a panel was open: '+pg.url)
    # 3 TTS failure stops
    pg.goto(B+'/#/read/2680'); pg.wait_for_selector('.rd-ch p', timeout=15000); pg.wait_for_timeout(600); before=info()
    pg.evaluate("document.querySelector('[data-a=more]').click()"); pg.wait_for_timeout(100); pg.evaluate("document.querySelector('[data-a=\"p:tts\"]').click()"); pg.wait_for_timeout(3000)
    ok(pg.inner_text('.rd-chname')!='Chapter 6' and pg.is_hidden('.rd-tts'), f'read-aloud failure stops ({before} -> {info()})')
    # listen page handler leak
    pg.goto(B+'/#/book/2680'); pg.wait_for_selector('#aud-find, #aud-go'); pg.click('#aud-find, #aud-go'); pg.wait_for_timeout(1000)
    if pg.locator('.aud button').count(): pg.click('.aud button')
    pg.wait_for_selector('.lis'); pg.wait_for_timeout(800)
    a=lambda: pg.evaluate("document.getElementById('audio').paused")
    pg.click('[data-c=toggle]'); pg.wait_for_timeout(300); p1=a()
    for _ in range(2):
        pg.goto(B+'/#/'); pg.wait_for_timeout(300); pg.goto(B+'/#/listen/2680'); pg.wait_for_selector('.lis'); pg.wait_for_timeout(300)
    pg.click('[data-c=toggle]'); pg.wait_for_timeout(500)
    ok(p1 and not a(), 'listen page play/pause works after revisits')
    # sign out stops audio
    pg.goto(B+'/#/settings'); pg.wait_for_selector('#out'); pg.click('#out'); pg.wait_for_selector('#lf'); pg.wait_for_timeout(300)
    ok(a() and pg.is_hidden('#mini'), 'sign out stops audio and hides player')
    ok(pg.evaluate("localStorage.getItem('rb_state_v1')") in ('{}', None), 'sign out clears local data')
    pg.fill('input[name=pass]','test pass 123'); pg.click('#lf button'); pg.wait_for_timeout(1500); pg.goto(B+'/#/'); pg.wait_for_timeout(1500)
    ok(pg.locator('.shelf').count()>0, 'signing in again restores data from server (no welcome)')
    pg.goto(B+'/#/cat/all?len=zz&sort=zz'); pg.wait_for_timeout(500); ok(pg.locator('.li').count()>0, 'bad filters ignored')
    pg.goto(B+'/#/welcome?s=9'); pg.wait_for_timeout(500); ok('😕' not in pg.inner_text('#main'), 'welcome step clamped')
    pg.goto(B+'/#/author/' + str(pg.evaluate("(async()=>{const m=await import('/catalog.js');const i=m.C.byId.get(4650);return m.C.auth[i][0]})()"))); pg.wait_for_timeout(500)
    ok(pg.locator('.li').count()>0, 'French-only author shows books for English reader')
    print('ERRORS', errs)
print(len(fails),'failed')
import sys; sys.exit(1 if fails or errs else 0)
