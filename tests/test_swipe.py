# Touch swipes and taps turn pages on a phone-sized screen
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:8787'
with sync_playwright() as p:
    br=p.chromium.launch()
    ctx=br.new_context(viewport={'width':390,'height':800}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx.route('https://www.gutenberg.org/**', lambda r: r.abort()); ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B+'/'); pg.wait_for_selector('#lf'); pg.fill('input[name=pass]','test pass 123'); pg.click('#lf button')
    pg.wait_for_selector('.wz, .shelf')
    if pg.locator('.wz').count():
        for _ in range(4): pg.click('#next'); pg.wait_for_timeout(200)
    pg.goto(B+'/#/read/2680'); pg.wait_for_selector('.rd-ch svg', timeout=15000); pg.wait_for_timeout(500)
    cdp=ctx.new_cdp_session(pg)
    def swipe(x0,x1,y=400,steps=8):
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x0,'y':y}]})
        for k in range(1,steps+1):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x0+(x1-x0)*k/steps,'y':y+k}]}); pg.wait_for_timeout(16)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(400)
    info=lambda: pg.inner_text('.rd-pinfo')
    import sys; fails=[]
    def ok(c,m): print(('PASS ' if c else 'FAIL ')+m); c or fails.append(m)
    print('start', info())
    swipe(300,80); ok('Page 1 of' in info() and 'Chapter 1' in info(), 'swipe left goes to next page: '+info())
    swipe(300,80); swipe(300,80); ok(info().startswith('Page 3 of'), 'two more swipes: '+info())
    swipe(80,300); ok(info().startswith('Page 2 of'), 'swipe right goes back: '+info())
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':370,'y':400}]}); cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(400)
    ok(info().startswith('Page 3 of'), 'tap right edge: '+info())
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':195,'y':400}]}); cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.querySelector('.rd').classList.contains('bars')"), 'middle tap shows the menu bars')
    pg.evaluate("document.querySelector('.rd').classList.remove('bars')")
    before=info(); swipe(200,200,y=300); ok(info()==before, 'vertical swipe does not turn the page')
    print('errors', errs); sys.exit(1 if fails or errs else 0)
