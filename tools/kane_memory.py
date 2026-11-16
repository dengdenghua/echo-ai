"""Private, source-attributed Kane memory; never included in distributable bundles."""
import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

KINDS = {'user_preference', 'project_constraint', 'engineering_lesson_pending_graph', 'open_question'}


def connect(path):
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1)')
    db.execute('CREATE TABLE IF NOT EXISTS history (id TEXT, at TEXT, operation TEXT, payload TEXT)')
    db.commit()
    return db


def validate(value):
    if value.get('kind') not in KINDS:
        raise ValueError('Unsupported memory kind')
    if any(not isinstance(value.get(k), str) or not value[k].strip() for k in ['text', 'scope', 'evidence_state']):
        raise ValueError('text, scope and evidence_state are required')
    if not isinstance(value.get('provenance'), dict) or not value['provenance']:
        raise ValueError('Source provenance is required')
    if value['kind'] == 'user_preference' and value['provenance'].get('type') != 'direct_user_instruction':
        raise ValueError('Preferences require direct user instruction')


def put(db, value, identity=None):
    validate(value)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True)
    identity = identity or hashlib.sha256(json.dumps([value[k] for k in ['kind','scope','text']], ensure_ascii=False).encode()).hexdigest()
    old = db.execute('SELECT payload,active FROM memories WHERE id=?', (identity,)).fetchone()
    if old:
        return {'id': identity, 'status': 'unchanged' if old == (payload,1) else 'conflict_preserved'}
    with db:
        db.execute('INSERT INTO memories VALUES (?,?,1)', (identity,payload))
        db.execute('INSERT INTO history VALUES (?,?,?,?)', (identity,datetime.now(timezone.utc).isoformat(),'import',payload))
    return {'id':identity,'status':'inserted'}


def revise(db, identity, value=None):
    old = db.execute('SELECT payload FROM memories WHERE id=?',(identity,)).fetchone()
    if not old:
        raise ValueError('Unknown memory')
    if value is not None:
        validate(value)
    with db:
        db.execute('INSERT INTO history VALUES (?,?,?,?)',(identity,datetime.now(timezone.utc).isoformat(),'revise' if value else 'revoke',old[0]))
        db.execute('UPDATE memories SET payload=?,active=? WHERE id=?',
                   (json.dumps(value,ensure_ascii=False,sort_keys=True) if value else old[0],int(value is not None),identity))


def search(db, query='', scope=None):
    rows = db.execute('SELECT id,payload FROM memories WHERE active=1 ORDER BY rowid')
    result=[]
    for identity,payload in rows:
        value=json.loads(payload)
        if query.casefold() not in (value['text']+' '+value['scope']).casefold():
            continue
        if scope and value['scope'] not in (scope,'global'):
            continue
        result.append({'id':identity,**value})
    return result


def import_offline(db, source):
    # Stable source IDs and a read transaction make repeat import incremental.
    source=Path(source).resolve()
    reader=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
    result=[]
    try:
        reader.execute('BEGIN')
        for identity,payload in reader.execute('SELECT id,payload FROM entries'):
            result.append(put(db,json.loads(payload),'optics-offline:'+identity))
    finally:
        reader.close()
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--store',type=Path,required=True)
    sub=p.add_subparsers(dest='command',required=True)
    q=sub.add_parser('search'); q.add_argument('query',nargs='?',default=''); q.add_argument('--scope')
    q=sub.add_parser('add'); q.add_argument('record',type=Path)
    q=sub.add_parser('revise'); q.add_argument('id'); q.add_argument('record',type=Path)
    q=sub.add_parser('revoke'); q.add_argument('id')
    q=sub.add_parser('import-offline'); q.add_argument('source',type=Path)
    a=p.parse_args(); db=connect(a.store)
    try:
        if a.command=='search': result=search(db,a.query,a.scope)
        elif a.command=='add': result=put(db,json.loads(a.record.read_text(encoding='utf8')))
        elif a.command=='revise': result=revise(db,a.id,json.loads(a.record.read_text(encoding='utf8')))
        elif a.command=='revoke': result=revise(db,a.id)
        else: result=import_offline(db,a.source)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally: db.close()


if __name__=='__main__': main()
