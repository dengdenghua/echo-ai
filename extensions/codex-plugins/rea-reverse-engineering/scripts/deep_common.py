"""Shared identity and file boundaries for the persistent Android workspace."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

SCHEMA = 1


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    with open(path, encoding='utf-8') as stream:
        return json.load(stream)


def workspace(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError('workspace must be an absolute path')
    root = path.resolve(strict=True)
    metadata = read_json(root / 'workspace.json')
    if metadata.get('schema') != SCHEMA or metadata.get('producer') != 'rea-deep':
        raise ValueError('Not a compatible REA Deep workspace')
    return root, metadata


def contained(root, relative):
    value = Path(relative)
    if value.is_absolute() or '..' in value.parts:
        raise ValueError('file must be a workspace-relative path without ..')
    result = (root / value).resolve(strict=True)
    if not result.is_relative_to(root) or not result.is_file():
        raise ValueError('File is outside the workspace or is not a regular file')
    return result


def database(root):
    lock = (root / '.query.lock').open('a+')
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        db = sqlite3.connect((root / 'index.sqlite').as_uri() + '?mode=ro', uri=True, factory=ReadConnection)
        db.query_lock = lock
        db.row_factory = sqlite3.Row
        return db
    except BaseException:
        lock.close()
        raise


class ReadConnection(sqlite3.Connection):
    def close(self):
        try:
            super().close()
        finally:
            if getattr(self, 'query_lock', None):
                self.query_lock.close()
                self.query_lock = None


def bounded_int(value, minimum, maximum, name):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f'{name} must be an integer from {minimum} to {maximum}')
    return value


def file_identity(root, db, relative):
    path = contained(root, relative)
    row = db.execute('SELECT sha256, bytes FROM files WHERE path=?', (relative,)).fetchone()
    if row is None:
        raise ValueError('File is not in the saved index; prepare with reindex=true')
    digest = sha256(path)
    if digest != row['sha256']:
        raise ValueError(f'Stale index: {relative} changed; prepare with reindex=true')
    return {'file': relative, 'sha256': digest, 'bytes': row['bytes']}


def evidence(root, operation, parameters, result, limitations):
    metadata = read_json(root / 'workspace.json')
    summary = read_json(root / 'summary.json')
    identity = summary.get('index_id')
    record = {
        'schema': SCHEMA, 'producer': 'rea-deep', 'operation': operation,
        'created_at': time.time(), 'target': metadata['source'], 'index_id': identity,
        'index_sha256': summary.get('index_sha256'), 'plugin_version': metadata['plugin_version'],
        'parameters': parameters, 'result': result, 'limitations': limitations,
    }
    canonical = json.dumps(record, sort_keys=True, ensure_ascii=False).encode()
    record['evidence_id'] = 'deep_' + hashlib.sha256(canonical).hexdigest()
    path = root / 'evidence' / (record['evidence_id'] + '.json')
    atomic_json(path, record)
    return {**record, 'evidence_file': str(path)}
