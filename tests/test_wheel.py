# Mouse wheel / trackpad page turning on desktop
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:8787'
with sync_playwright() as p:
    br=p.chromium.launch(); ctx=br.new_context(viewport={'width':1280,'height':860})
    ctx.route('https://www.gutenberg.org/**', lambda r: r.abort()); ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg=ctx.new_page()
    pg.goto(B+'/'); pg.wait_for_selector('#lf'); pg.fill('input[name=pass]','test pass 123'); pg.click('#lf button'); pg.wait_for_selector('.shelf, .wz')
    if pg.locator('.wz').count():
        for _ in range(4): pg.click('#next'); pg.wait_for_timeout(200)
    pg.goto(B+'/#/read/2680'); pg.wait_for_selector('.rd-ch', timeout=15000); pg.wait_for_timeout(600)
    import sys; fails=[]
    def ok(c,m): print(('PASS ' if c else 'FAIL ')+m); c or fails.append(m)
    pg.mouse.move(640,400)
    for d in [120,120,120]: pg.mouse.wheel(0,d); pg.wait_for_timeout(350)
    a=pg.inner_text('.rd-pinfo'); ok(not a.startswith('Page 1 of'), 'wheel down turns pages: '+a)
    n=lambda: int(pg.inner_text('.rd-pinfo').split()[1])
    p0=n(); pg.mouse.wheel(0,-120); pg.wait_for_timeout(350); ok(n()==p0-1, 'wheel up goes back one page')
    p0=n()
    for k in range(10): pg.mouse.wheel(0,15); pg.wait_for_timeout(20)
    pg.wait_for_timeout(400); ok(n()==p0+1, 'one trackpad flick turns exactly one page')
    sys.exit(1 if fails else 0)
