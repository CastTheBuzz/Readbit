# Builds a small fake Gutenberg catalog archive (real-looking classics + ~3,000 generated books) for the tests
import tarfile, io, random, bz2, sys
random.seed(7)
out = sys.argv[1]
REAL = [
 (2680,"Meditations","Marcus Aurelius, Emperor of Rome",121,180,"en",["Stoics","Ethics"],["B"],["Philosophy"],60000,9000),
 (205,"Walden, and On The Duty Of Civil Disobedience","Thoreau, Henry David",1817,1862,"en",["Wilderness areas -- Massachusetts","Philosophy, American","Simple living"],["PS"],["Best Books Ever Listings"],700000,4000),
 (20203,"Autobiography of Benjamin Franklin","Franklin, Benjamin",1706,1790,"en",["Franklin, Benjamin, 1706-1790","Statesmen -- United States -- Biography"],["E"],["Biographies"],300000,3000),
 (23,"Narrative of the Life of Frederick Douglass, an American Slave","Douglass, Frederick",1818,1895,"en",["Douglass, Frederick, 1818-1895","Slaves -- United States -- Biography"],["E"],[],200000,3500),
 (2376,"Up from Slavery: An Autobiography","Washington, Booker T.",1856,1915,"en",["Washington, Booker T., 1856-1915","African Americans -- Biography"],["E"],[],420000,1200),
 (2397,"The Story of My Life","Keller, Helen",1880,1968,"en",["Keller, Helen, 1880-1968","Blind-deaf women -- United States -- Biography"],["HV"],[],380000,1500),
 (2500,"Siddhartha","Hesse, Hermann",1877,1962,"en",["India -- Fiction","Spiritual life -- Fiction","Self-realization -- Fiction"],["PT"],[],250000,5000),
 (2554,"Crime and Punishment","Dostoyevsky, Fyodor",1821,1881,"en",["Psychological fiction","Murder -- Fiction","Saint Petersburg (Russia) -- Fiction"],["PG"],["Best Books Ever Listings"],1150000,9000),
 (600,"Notes from the Underground","Dostoyevsky, Fyodor",1821,1881,"en",["Psychological fiction","Russia -- Social life and customs -- Fiction"],["PG"],[],240000,3000),
 (16367,"The Science of Getting Rich","Wattles, Wallace D.",1860,1911,"en",["Success","Wealth","New Thought"],["BF"],[],110000,1800),
 (4507,"As a Man Thinketh","Allen, James",1864,1912,"en",["Thought and thinking","Conduct of life"],["BJ"],[],50000,2200),
 (58585,"The Prophet","Gibran, Kahlil",1883,1931,"en",["Prose poems, American"],["PS"],[],90000,3800),
 (1342,"Pride and Prejudice","Austen, Jane",1775,1817,"en",["Love stories","Courtship -- Fiction","Domestic fiction","England -- Fiction"],["PR"],["Best Books Ever Listings","Harvard Classics"],760000,60000),
 (84,"Frankenstein; Or, The Modern Prometheus","Shelley, Mary Wollstonecraft",1797,1851,"en",["Science fiction","Horror tales","Gothic fiction","Monsters -- Fiction"],["PR"],["Gothic Fiction","Precursors of Science Fiction"],440000,50000),
 (3300,"An Inquiry into the Nature and Causes of the Wealth of Nations","Smith, Adam",1723,1790,"en",["Economics"],["HB"],[],2200000,2500),
 (64317,"The Great Gatsby","Fitzgerald, F. Scott (Francis Scott)",1896,1940,"en",["Rich people -- Fiction","Long Island (N.Y.) -- Fiction","First loves -- Fiction"],["PS"],[],300000,30000),
 (5200,"Metamorphosis","Kafka, Franz",1883,1924,"en",["Psychological fiction","Metamorphosis -- Fiction"],["PT"],[],120000,20000),
 (2229,"Faust: Der Tragödie erster Teil","Goethe, Johann Wolfgang von",1749,1832,"de",["Drama"],["PT"],[],330000,900),
 (4650,"Candide","Voltaire",1694,1778,"fr",["Philosophical fiction","Optimism -- Fiction"],["PQ"],[],230000,1800),
 (67890,"Lahuta e Malcís","Fishta, Gjergj",1871,1940,"sq",["Albanian poetry","Epic poetry, Albanian"],["PG"],[],600000,40),
 (12345,"Punch, or the London Charivari, Vol. 99","Various",None,None,"en",["English wit and humor -- Periodicals"],["AP"],["Punch"],180000,60),
 (99999,"Index of the Project Gutenberg Works of Various","Various",None,None,"en",["Indexes"],["Z"],[],5000,30),
]
words = "river night silver house storm garden letter journey shadow winter empire stranger daughter".split()
subjects_pool = [("Detective and mystery stories",["PR"]),("Sea stories",["PR"]),("Love stories",["PS"]),("Ghost stories",["PR"]),("Science fiction",["PS"]),("Economics",["HB"]),("Success in business",["HF"]),("United States -- History -- Civil War, 1861-1865",["E"]),("Poetry",["PS"]),("Juvenile fiction",["PZ"]),("Fishing",["SH"]),("Cookery, American",["TX"]),("Philosophy",["B"]),("Travel -- Europe",["D"]),("Christian life",["BV"]),("Psychology",["BF"]),("Baseball -- Fiction",["PZ"]),("Western stories",["PS"])]
recs = []
for r in REAL: recs.append(r)
for i in range(3000):
    sid = 100000 + i
    s, l = random.choice(subjects_pool)
    lang = random.choices(["en","fr","de","sq","es","it"],[80,7,6,1,3,3])[0]
    t = " ".join(random.choice(words).title() for _ in range(random.randint(2,4)))
    recs.append((sid, t, f"Author{i%400}, Test", 1800+i%90, 1880+i%90, lang, [s], l, [], random.randint(20000,900000), int(random.paretovariate(1.2)*20)))
def rdf(r):
    id,t,a,b,d,lang,subs,lcc,shelves,size,dl = r
    sub = "".join(f'<dcterms:subject><rdf:Description rdf:nodeID="N{k}"><dcam:memberOf rdf:resource="http://purl.org/dc/terms/LCSH"/><rdf:value>{x.replace("&","&amp;")}</rdf:value></rdf:Description></dcterms:subject>' for k,x in enumerate(subs))
    sub += "".join(f'<dcterms:subject><rdf:Description rdf:nodeID="L{k}"><dcam:memberOf rdf:resource="http://purl.org/dc/terms/LCC"/><rdf:value>{x}</rdf:value></rdf:Description></dcterms:subject>' for k,x in enumerate(lcc))
    sh = "".join(f'<pgterms:bookshelf><rdf:Description rdf:nodeID="S{k}"><dcam:memberOf rdf:resource="2009/pgterms/Bookshelf"/><rdf:value>{x}</rdf:value></rdf:Description></pgterms:bookshelf>' for k,x in enumerate(shelves))
    bd = f'<pgterms:birthdate rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">{b}</pgterms:birthdate><pgterms:deathdate rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">{d}</pgterms:deathdate>' if b else ''
    summ = f'<pgterms:marc520>"{t}" is a work by {a.split(",")[0]} that explores life &amp; meaning. (This is an automatically generated summary.)</pgterms:marc520>' if id < 100000 or id%3==0 else ''
    tt = t.replace(": ", "\n", 1).replace("&","&amp;")
    return f'''<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xml:base="http://www.gutenberg.org/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:pgterms="http://www.gutenberg.org/2009/pgterms/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcam="http://purl.org/dc/dcam/" xmlns:marcrel="http://id.loc.gov/vocabulary/relators/">
  <pgterms:ebook rdf:about="ebooks/{id}">
    <dcterms:publisher>Project Gutenberg</dcterms:publisher>
    <dcterms:issued rdf:datatype="http://www.w3.org/2001/XMLSchema#date">{1995+id%30}-03-01</dcterms:issued>
    <pgterms:downloads rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">{dl}</pgterms:downloads>
    <dcterms:creator><pgterms:agent rdf:about="2009/agents/{id%997}"><pgterms:name>{a}</pgterms:name>{bd}</pgterms:agent></dcterms:creator>
    <dcterms:title>{tt}</dcterms:title>
    {summ}
    <dcterms:language><rdf:Description rdf:nodeID="lg"><rdf:value rdf:datatype="http://purl.org/dc/terms/RFC4646">{lang}</rdf:value></rdf:Description></dcterms:language>
    {sub}{sh}
    <dcterms:type><rdf:Description rdf:nodeID="ty"><dcam:memberOf rdf:resource="http://purl.org/dc/terms/DCMIType"/><rdf:value>Text</rdf:value></rdf:Description></dcterms:type>
    <dcterms:hasFormat><pgterms:file rdf:about="https://www.gutenberg.org/ebooks/{id}.txt.utf-8"><dcterms:extent rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">{size}</dcterms:extent><dcterms:format><rdf:Description rdf:nodeID="f1"><dcam:memberOf rdf:resource="http://purl.org/dc/terms/IMT"/><rdf:value rdf:datatype="http://purl.org/dc/terms/IMT">text/plain; charset=utf-8</rdf:value></rdf:Description></dcterms:format></pgterms:file></dcterms:hasFormat>
    <dcterms:hasFormat><pgterms:file rdf:about="https://www.gutenberg.org/ebooks/{id}.epub3.images"><dcterms:extent rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">{size//2}</dcterms:extent><dcterms:format><rdf:Description rdf:nodeID="f2"><rdf:value rdf:datatype="http://purl.org/dc/terms/IMT">application/epub+zip</rdf:value></rdf:Description></dcterms:format></pgterms:file></dcterms:hasFormat>
  </pgterms:ebook>
</rdf:RDF>
'''
bio = io.BytesIO()
with tarfile.open(fileobj=bio, mode="w", format=tarfile.GNU_FORMAT) as tf:
    for r in recs:
        data = rdf(r).encode()
        ti = tarfile.TarInfo(f"cache/epub/{r[0]}/pg{r[0]}.rdf"); ti.size = len(data)
        tf.addfile(ti, io.BytesIO(data))
open(out,"wb").write(bz2.compress(bio.getvalue()))
print(len(recs), "records")
