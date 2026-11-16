"""Offline, user-local workflow memory. Does not alter or impersonate Optics Workbench's graph."""
import argparse,hashlib,json,os,sqlite3
from pathlib import Path
from datetime import datetime,timezone
from contextlib import contextmanager

@contextmanager
def connect(path):
    p=Path(path).expanduser()
    if not p.is_absolute():raise ValueError('Store path must be absolute')
    p.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(str(p),timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL, recorded_at TEXT NOT NULL)')
    try:
        yield db
    finally:
        db.close()

def add(db,record):
    if record.get('kind') not in ['user_preference','engineering_lesson_pending_graph','open_question']:
        raise ValueError('Unsupported memory kind')
    if any(not isinstance(record.get(k),str) or not record[k].strip() for k in ['scope','text','evidence_state']):
        raise ValueError('scope, text and evidence_state are required')
    if not isinstance(record.get('provenance'),dict) or not record['provenance']:
        raise ValueError('Provenance is required')
    if record['kind']=='user_preference' and record['provenance'].get('type')!='direct_user_instruction':
        raise ValueError('User preferences need a direct user instruction')
    for artifact in record.get('artifacts',[]):
        p=Path(artifact['path'])
        if not p.is_absolute() or not p.is_file():raise ValueError('Missing absolute evidence artifact')
        if hashlib.sha256(p.read_bytes()).hexdigest()!=artifact['sha256'].lower():raise ValueError('Evidence SHA256 mismatch')
    key=hashlib.sha256(json.dumps([record[k] for k in ['kind','scope','text']],ensure_ascii=False).encode('utf8')).hexdigest()
    payload=json.dumps(record,ensure_ascii=False,sort_keys=True)
    existing=db.execute('SELECT payload FROM entries WHERE id=?',(key,)).fetchone()
    if existing and existing[0]!=payload:raise ValueError('Existing identity has different provenance; retain it and record an explicit revision')
    with db:db.execute('INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?)',(key,record['kind'],record['scope'],record['text'],payload,datetime.now(timezone.utc).isoformat()))
    return {'id':key,'inserted':existing is None,'graph_sync':'not_performed','record':json.loads(db.execute('SELECT payload FROM entries WHERE id=?',(key,)).fetchone()[0])}

def search(db,query,limit=10):
    if not query.strip() or not 1<=limit<=50:raise ValueError('Nonempty query and limit 1..50 required')
    terms=query.split();clauses=['(instr(text,?)>0 OR instr(scope,?)>0)' for _ in terms];params=[t for term in terms for t in (term,term)]
    rows=db.execute('SELECT id,payload FROM entries WHERE '+' OR '.join(clauses)+' ORDER BY recorded_at DESC LIMIT ?',params+[limit]).fetchall()
    return [{'id':key,**json.loads(payload)} for key,payload in rows]

def main():
    default=Path(os.environ.get('CODEX_HOME',Path.home()/'.codex'))/'optical-workflow-memory'/'memory.sqlite3'
    ap=argparse.ArgumentParser();ap.add_argument('--store',default=str(default));sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('add');p.add_argument('record_json')
    p=sub.add_parser('search');p.add_argument('query');p.add_argument('--limit',type=int,default=10)
    sub.add_parser('stats');a=ap.parse_args()
    with connect(a.store) as db:
        if a.command=='add':out=add(db,json.loads(Path(a.record_json).read_text(encoding='utf-8-sig')))
        elif a.command=='search':out=search(db,a.query,a.limit)
        else:out={'store':str(Path(a.store).resolve()),'entries':db.execute('SELECT count(*) FROM entries').fetchone()[0],'kind_counts':dict(db.execute('SELECT kind,count(*) FROM entries GROUP BY kind')),'graph_sync':'not_performed'}
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
