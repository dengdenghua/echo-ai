"""Portable stdlib client. Private database paths belong in local config, not the plugin."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import sys
from urllib.parse import quote, urlencode


KINDS = ('knowledge', 'cases', 'patents', 'pages', 'documents', 'resources')


def resolve_root(explicit=None):
    value = explicit or os.environ.get('LENS_LIBRARY_ROOT')
    if not value:
        config = pathlib.Path.home()/'.echo'/'lens-toolkit.local.json'
        if config.is_file():
            value = json.loads(config.read_text(encoding='utf-8-sig')).get('library_root')
    if not value:
        raise ValueError('Set --library, LENS_LIBRARY_ROOT, or ~/.echo/lens-toolkit.local.json library_root.')
    root = pathlib.Path(value).expanduser().resolve()
    if not (root/'lens_library.sqlite').is_file():
        raise FileNotFoundError(f'No lens_library.sqlite under {root}')
    return root


def connect(root):
    c=sqlite3.connect((root/'lens_library.sqlite').as_uri()+'?mode=ro',uri=True)
    c.row_factory=sqlite3.Row
    c.execute('PRAGMA query_only=ON')
    return c


def origin_expr(alias):
    return f'(SELECT original_path FROM locations WHERE source_id={alias} ORDER BY id LIMIT 1)'


def search(c, kind, query='', limit=20, offset=0):
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError('limit must be 1..100 and offset nonnegative')
    if kind == 'knowledge':
        sql='SELECT * FROM knowledge';hay="title||' '||topic||' '||statement||' '||conditions";order='id'
    elif kind == 'cases':
        sql=f'SELECT c.*,{origin_expr("c.source_id")} origin FROM cases c'
        hay="c.title||' '||c.topics||' '||c.materials||' '||c.surface_types||' '||c.wavelengths_um";order='c.title,c.id'
    elif kind == 'patents':
        sql='SELECT * FROM catalog_cases';hay="title||' '||topics||' '||source_code||' '||patent_number||' '||data";order='source_code,patent_number,example_number,zoom_number,dataset'
    elif kind == 'pages':
        sql=f'SELECT p.id,p.source_id,p.page,p.locator,p.method,p.flags,substr(p.text,1,1200) text,{origin_expr("p.source_id")} origin FROM pages p'
        hay='p.text';order='p.source_id,p.page'
    elif kind == 'documents':
        sql=f'SELECT s.*,{origin_expr("s.id")} origin FROM sources s'
        hay=f"s.extension||' '||s.status||' '||coalesce((SELECT group_concat(original_path) FROM locations WHERE source_id=s.id),'')";order='s.extension,s.id'
    elif kind == 'resources':
        sql='SELECT * FROM external_resources';hay="name||' '||category||' '||summary||' '||tags||' '||historical_urls||' '||status||' '||limitations";order='category,name'
    else:raise ValueError('Unsupported search kind')
    terms=query.lower().split()
    if terms:sql+=' WHERE '+' AND '.join(f'instr(lower({hay}),?)>0' for _ in terms)
    total=c.execute('SELECT count(*) FROM ('+sql+')',terms).fetchone()[0]
    rows=[dict(r) for r in c.execute(sql+' ORDER BY '+order+' LIMIT ? OFFSET ?',terms+[limit,offset])]
    return dict(kind=kind,query=query,total=total,offset=offset,rows=rows)


def detail(c,kind,identifier):
    tables={'cases':'cases','patents':'catalog_cases','pages':'pages','documents':'sources','knowledge':'knowledge','resources':'external_resources'}
    if kind not in tables:raise ValueError('Unsupported detail kind')
    row=c.execute(f'SELECT * FROM {tables[kind]} WHERE id=?',(identifier,)).fetchone()
    if row is None:raise LookupError(f'No {kind} record with id {identifier}')
    d=dict(row);sid=d.get('source_id')
    if kind=='documents':sid=d['id']
    if sid:
        d['source']=dict(c.execute('SELECT * FROM sources WHERE id=?',(sid,)).fetchone())
        d['locations']=[dict(r) for r in c.execute('SELECT * FROM locations WHERE source_id=?',(sid,))]
    if kind=='cases':
        d['surfaces']=[dict(r) for r in c.execute('SELECT * FROM surfaces WHERE case_id=? ORDER BY surface_number',(identifier,))]
    if kind=='patents':
        keys=[d[k] for k in ('dataset','source_code','patent_number','example_number','zoom_number')]
        d['prescription_records']=[dict(r) for r in c.execute("SELECT source_id,row_number,table_name,surface_number,data FROM catalog_records WHERE dataset=? AND source_code=? AND patent_number=? AND example_number=? AND zoom_number=? AND table_name IN ('SURFDATA','INDEXDAT','SPECSURF') ORDER BY surface_number,table_name",keys)]
        d['patent_records']=[dict(r) for r in c.execute("SELECT source_id,row_number,data FROM catalog_records WHERE dataset=? AND source_code=? AND patent_number=? AND table_name='PATDATA'",keys[:3])]
    if kind=='knowledge':
        d['sources']=[dict(r) for r in c.execute(f'SELECT k.*,s.sha256,s.local_path,{origin_expr("k.source_id")} origin FROM knowledge_sources k JOIN sources s ON s.id=k.source_id WHERE knowledge_id=?',(identifier,))]
    if kind=='resources':
        d['evidence']=[dict(r) for r in c.execute(f'SELECT e.*,s.sha256,{origin_expr("e.source_id")} origin FROM resource_evidence e LEFT JOIN sources s ON s.id=e.source_id WHERE resource_id=? ORDER BY ordinal',(identifier,))]
    return d


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def prepare_case(c,identifier,destination):
    d=detail(c,'cases',identifier)
    source=pathlib.Path(d['source']['local_path'])
    if source.suffix.lower()!='.zmx':raise ValueError('Only indexed ZMX source files can be prepared.')
    actual=digest(source)
    if actual!=d['source']['sha256']:raise ValueError('Source SHA-256 changed; resolve source identity before reuse.')
    dest=pathlib.Path(destination).expanduser().resolve()
    # A fresh directory avoids overwriting a running optical model or previous result.
    dest.mkdir(parents=True,exist_ok=False)
    copied=dest/'prescription_source.zmx'
    shutil.copy2(source,copied)
    if digest(copied)!=actual:raise IOError('Copied source hash does not match.')
    d['handoff']={'source_sha256':actual,'copy_sha256':actual,'copy':'prescription_source.zmx',
                  'geometry_modified':False,'units_converted':False,'native_verified':False,
                  'required_checks':['Resolve UNIT, FTYP and ENPD/FNUM/OBNA definitions from original records.',
                  'Check catalog glass availability, dispersion, wavelengths and index environment.',
                  'Check stop, semi-diameters, enabled configurations, solves, pickups and nonsequential objects.',
                  'Open a separate working copy with Zemax; save native diagnostics, layout, focal length and requested image-quality results.',
                  'Keep native trace, independent calculations and measurements at distinct evidence levels.']}
    (dest/'case_provenance.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
    (dest/'handoff.md').write_text('# 镜头处方工作副本\n\n'+d['title']+'\n\n原始处方逐字节复制，未缩放、改材料或原生重算。\n\n'+
        '\n'.join('- '+s for s in d['handoff']['required_checks'])+'\n\n原始单位：'+str(d['unit'])+'\n\nSHA-256: '+actual+'\n',encoding='utf-8')
    return dict(directory=str(dest),case_id=identifier,sha256=actual,native_verified=False)


def patent_links(c,value,limit):
    compact=re.sub(r'[\s,.-]','',value).upper()
    m=re.fullmatch(r'(?:(?P<country>[A-Z]{2}))?(?P<number>\d+)(?P<kind>[A-Z]\d?)?',compact)
    if not m:raise ValueError('Use a patent/publication number such as US2117252 or US20160306119A1.')
    number=m['number'];code=m['country'];kind=m['kind']
    # Search local raw patent number exactly after punctuation removal; retain source codes and versions.
    expr="replace(replace(replace(replace(trim(patent_number),',',''),'.',''),'-',''),' ','')"
    sql=f'SELECT * FROM catalog_cases WHERE ({expr}=? OR {expr}=?)';args=[number,compact]
    # Country codes are not translated to unverified LensVIEW source codes.
    rows=[dict(r) for r in c.execute(sql+' ORDER BY source_code,dataset,example_number,zoom_number LIMIT ?',args+[limit])]
    links=[{'provider':'Google Patents','url':'https://patents.google.com/?'+urlencode({'q':compact}),'status':'constructed_search_url_not_opened'},
           {'provider':'USPTO','url':'https://www.uspto.gov/patents/search/patent-public-search/','status':'provider_entrypoint'},
           {'provider':'Espacenet','url':'https://worldwide.espacenet.com/','status':'provider_entrypoint'},
           {'provider':'WIPO PATENTSCOPE','url':'https://www.wipo.int/en/web/patentscope','status':'provider_entrypoint'}]
    return dict(input=value,country=code,number=number,kind_code=kind,local_rows=rows,
                limitation='Local numeric matches are candidates: confirm source jurisdiction, publication kind, example and zoom. URLs do not prove retrieval.',links=links)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--library')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('stats')
    s=sub.add_parser('search');s.add_argument('query',nargs='?',default='');s.add_argument('--kind',choices=KINDS,default='knowledge');s.add_argument('--limit',type=int,default=20);s.add_argument('--offset',type=int,default=0)
    d=sub.add_parser('detail');d.add_argument('kind',choices=KINDS);d.add_argument('id')
    s=sub.add_parser('prepare-case');s.add_argument('id');s.add_argument('--output',required=True)
    s=sub.add_parser('patent-links');s.add_argument('number');s.add_argument('--limit',type=int,default=20)
    a=p.parse_args();root=resolve_root(a.library)
    with connect(root) as c:
        if a.command=='stats':
            result={k:c.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for k,t in [('cases','cases'),('surfaces','surfaces'),('knowledge','knowledge'),('patent_configurations','catalog_cases'),('resources','external_resources')]}
        elif a.command=='search':result=search(c,a.kind,a.query,a.limit,a.offset)
        elif a.command=='detail':result=detail(c,a.kind,a.id)
        elif a.command=='prepare-case':result=prepare_case(c,a.id,a.output)
        else:
            if not 1<=a.limit<=100:raise ValueError('limit must be 1..100')
            result=patent_links(c,a.number,a.limit)
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))


if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    try:main()
    except (ValueError,LookupError,OSError,sqlite3.Error) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr);sys.exit(1)
