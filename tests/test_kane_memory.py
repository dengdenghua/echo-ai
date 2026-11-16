import json
import sqlite3

import pytest

from tools.kane_memory import connect, import_offline, put, revise, search


def record(text='Chinese replies',scope='global'):
    return {'kind':'user_preference','scope':scope,'text':text,'evidence_state':'direct request',
            'provenance':{'type':'direct_user_instruction','date':'2026-11-13'}}


def test_private_memory_scope_and_revoke(tmp_path):
    db=connect(tmp_path/'memory.sqlite3')
    try:
        a=put(db,record())
        put(db,record('A-only threshold','project-A'))
        assert len(search(db,scope='project-B'))==1
        assert len(search(db,scope='project-A'))==2
        revise(db,a['id'],record('Concise Chinese replies'))
        assert search(db,'Concise')
        revise(db,a['id'])
        assert not search(db,'Concise')
        assert db.execute('SELECT count(*) FROM history').fetchone()[0]==4
    finally:db.close()


def test_untrusted_document_not_user_preference(tmp_path):
    db=connect(tmp_path/'memory.sqlite3')
    try:
        value=record(); value['provenance']['type']='website'
        with pytest.raises(ValueError,match='direct user'):put(db,value)
    finally:db.close()


def test_incremental_import_preserves_echo_edits_and_revocations(tmp_path):
    source=tmp_path/'source.sqlite3'
    with sqlite3.connect(source) as s:
        s.execute('CREATE TABLE entries(id TEXT,payload TEXT)')
        s.execute('INSERT INTO entries VALUES (?,?)',('source-1',json.dumps(record())))
    db=connect(tmp_path/'memory.sqlite3')
    try:
        assert import_offline(db,source)[0]['status']=='inserted'
        assert import_offline(db,source)[0]['status']=='unchanged'
        revise(db,'optics-offline:source-1',record('Echo edited'))
        assert import_offline(db,source)[0]['status']=='conflict_preserved'
        assert search(db,'Echo edited')
        revise(db,'optics-offline:source-1')
        assert import_offline(db,source)[0]['status']=='conflict_preserved'
        assert not search(db)
        with sqlite3.connect(source) as s: assert json.loads(s.execute('SELECT payload FROM entries').fetchone()[0])==record()
    finally:db.close()
