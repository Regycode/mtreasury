import pymupdf,re,sys,json
d=pymupdf.open(sys.argv[1])
lines=[l.replace('\xa0',' ').strip() for pg in d for l in pg.get_text().split('\n')]
lines=[l for l in lines if l and not l.startswith(('10/17/26','CCA Web-Banking','https://')) and not re.fullmatch(r'\d/7',l)]
txs=[];i=0;dre=re.compile(r'\d\d/\d\d/\d{4}$');nre=re.compile(r'-?[\d ]+$')
prev=0
while i<len(lines):
    if dre.match(lines[i]) and i+1<len(lines) and dre.match(lines[i+1]):
        date,val=lines[i],lines[i+1]; j=i+2; desc=[]
        while not nre.fullmatch(lines[j]): desc.append(lines[j]); j+=1
        amt=int(lines[j].replace(' ','')); bal=int(lines[j+1].replace(' ',''))
        delta=bal-prev; prev=bal
        txs.append(dict(date=date,value=val,desc=' '.join(desc),debit=amt if delta<0 else 0,credit=amt if delta>0 else 0,balance=bal))
        assert abs(delta)==amt,(date,amt,delta)
        i=j+2
    else: i+=1
json.dump(txs,open(sys.argv[2],'w'),indent=1)
print(len(txs),sum(t['debit'] for t in txs),sum(t['credit'] for t in txs),txs[-1]['balance'])
for t in txs:
    if 'SMS' not in t['desc']: print(t)
from collections import Counter
print(Counter((t['date'],t['debit']) for t in txs if 'SMS' in t['desc']))
