# Fake Project Gutenberg + LibriVox on 127.0.0.1:9000 for the tests (generated EPUBs and WAV audio)
import http.server, io, zipfile, json, re, wave, struct, math, random, urllib.parse
from PIL import Image
LOREM = ("It was the best of times and the worst of times. The river ran slowly past the mill, and the old man watched it without a word. "
 "He had learned, over many winters, that patience is a kind of courage. She asked him once what he wanted from life; he said only to understand it. "
 "Money comes and goes like the tide, he told the boy, but what you make of yourself stays. ")
def epub(bid):
    random.seed(bid)
    title = {2680:"Meditations",1342:"Pride and Prejudice"}.get(bid, f"Book {bid}")
    b = io.BytesIO(); z = zipfile.ZipFile(b, 'w')
    z.writestr('mimetype', 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    img = io.BytesIO(); Image.new('RGB', (600, 900), (120, 60, 30)).save(img, 'JPEG'); z.writestr('OEBPS/cover.jpg', img.getvalue())
    pic = io.BytesIO(); Image.new('RGB', (400, 300), (30, 90, 120)).save(pic, 'PNG'); z.writestr('OEBPS/images/fig1.png', pic.getvalue())
    chs = []
    z.writestr('OEBPS/wrap0000.xhtml', '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>Cover</title></head><body><div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><image width="600" height="900" xlink:href="cover.jpg"/></svg></div></body></html>')
    n = 6
    for i in range(n):
        paras = "".join(f"<p>{LOREM * random.randint(1,3)} (Chapter {i+1}, paragraph {k+1}.)</p>" for k in range(random.randint(25, 45)))
        head = '<section class="pg-boilerplate pgheader" id="pg-header"><h2>The Project Gutenberg eBook of ' + title + '</h2><p>This ebook is for the use of anyone anywhere in the United States and most other parts of the world at no cost. LICENSE TEXT LICENSE TEXT.</p></section>' if i == 0 else ''
        extra = '<p><img src="images/fig1.png" alt="figure"/></p><p>See <a href="part0003.xhtml#c4">chapter four</a> and <a href="https://example.org">a website</a>.</p>' if i == 1 else ''
        foot = '<section class="pg-boilerplate" id="pg-footer"><h2>THE FULL PROJECT GUTENBERG LICENSE</h2><p>' + 'License words. ' * 300 + '</p></section>' if i == n-1 else ''
        z.writestr(f'OEBPS/part{i:04d}.xhtml', f'<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>{title}</title><style>p{{color:red}}</style><script>alert(1)</script></head><body>{head}<h2 id="c{i+1}">CHAPTER {["ONE","TWO","THREE","FOUR","FIVE","SIX"][i]}</h2><p style="color:blue" onclick="alert(2)">{title} — chapter opening line.</p>{extra}{paras}{foot}</body></html>')
        chs.append(f'part{i:04d}.xhtml')
    z.writestr('OEBPS/license.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section id="pg-footer"><p>' + 'License. ' * 200 + '</p></section></body></html>')
    nav = "".join(f'<li><a href="{c}#c{i+1}">Chapter {i+1}</a></li>' for i, c in enumerate(chs))
    z.writestr('OEBPS/nav.xhtml', f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="wrap0000.xhtml">Cover</a></li><li><a href="part0000.xhtml#pg-header">THE PROJECT GUTENBERG EBOOK</a></li>{nav}<li><a href="license.xhtml">THE FULL PROJECT GUTENBERG LICENSE</a></li></ol></nav></body></html>')
    items = "".join(f'<item id="p{i}" href="{c}" media-type="application/xhtml+xml"/>' for i, c in enumerate(chs))
    spine = "".join(f'<itemref idref="p{i}"/>' for i in range(len(chs)))
    z.writestr('OEBPS/content.opf', f'<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="cov" href="cover.jpg" media-type="image/jpeg"/><item id="fig" href="images/fig1.png" media-type="image/png"/><item id="wrap" href="wrap0000.xhtml" media-type="application/xhtml+xml"/>{items}<item id="lic" href="license.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="wrap"/>{spine}<itemref idref="lic"/></spine></package>')
    z.close(); return b.getvalue()
def wav():
    b = io.BytesIO(); w = wave.open(b, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b''.join(struct.pack('<h', int(3000*math.sin(i/8))) for i in range(8000*20))); w.close(); return b.getvalue()
WAV = wav()
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ct):
        self.send_response(code); self.send_header('content-type', ct); self.send_header('content-length', str(len(body))); self.send_header('access-control-allow-origin', '*'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        m = re.match(r'/cache/epub/(\d+)/pg\d+-images-3\.epub', p.path)
        if m:
            if m.group(1) == '404': return self.send(404, b'no', 'text/plain')
            return self.send(200, epub(int(m.group(1))), 'application/epub+zip')
        if p.path.startswith('/api/feed/audiobooks'):
            q = urllib.parse.parse_qs(p.query); t = q.get('title', [''])[0].lstrip('^')
            if 'Meditations' not in t: return self.send(404, json.dumps({"error":"Audiobooks could not be found"}).encode(), 'application/json')
            return self.send(200, json.dumps({"books":[{"id":"55","title":"Meditations","language":"English","totaltime":"5:01:02","url_librivox":"http://librivox.org/meditations",
              "authors":[{"first_name":"Marcus","last_name":"Aurelius"}],
              "sections":[{"section_number":str(i+1),"title":f"Book {i+1}","listen_url":f"http://127.0.0.1:9000/audio/{i+1}.wav","playtime":"20","readers":[{"display_name":"Volunteer Reader"}]} for i in range(3)]}]}).encode(), 'application/json')
        if p.path.startswith('/audio/'): return self.send(200, WAV, 'audio/wav')
        self.send(404, b'nf', 'text/plain')
http.server.ThreadingHTTPServer(('127.0.0.1', 9000), H).serve_forever()
