"""Local evidence graph and durable personal memory; no source-file execution."""
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class EvidenceGraph:
    def __init__(self, path):
        self.path = Path(path)
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,payload TEXT NOT NULL,batch TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS edges(src TEXT NOT NULL,relation TEXT NOT NULL,dst TEXT NOT NULL,batch TEXT NOT NULL,
              PRIMARY KEY(src,relation,dst),FOREIGN KEY(src) REFERENCES nodes(id),FOREIGN KEY(dst) REFERENCES nodes(id));
            CREATE TABLE IF NOT EXISTS imports(batch TEXT PRIMARY KEY,catalog_sha256 TEXT NOT NULL,imported_utc TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS source_reviews(source_id TEXT NOT NULL,batch TEXT NOT NULL,record_id TEXT NOT NULL,
              title TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source_id,batch,record_id),
              FOREIGN KEY(source_id) REFERENCES nodes(id));
            CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,scope TEXT NOT NULL,provenance TEXT NOT NULL,status TEXT NOT NULL,created_utc TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS memory_links(memory_id TEXT NOT NULL,node_id TEXT NOT NULL,
              PRIMARY KEY(memory_id,node_id),FOREIGN KEY(memory_id) REFERENCES memories(id),FOREIGN KEY(node_id) REFERENCES nodes(id));
            CREATE TRIGGER IF NOT EXISTS preserve_source_review_node
              BEFORE UPDATE ON nodes
              WHEN OLD.kind='source' AND (NEW.kind<>OLD.kind OR NEW.title<>OLD.title
                OR NEW.payload<>OLD.payload OR NEW.batch<>OLD.batch)
              BEGIN SELECT RAISE(IGNORE); END;
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def import_catalog(self, catalog_path, audit_path, topic, documents):
        """Operator-configured files only. Verify catalog and source review linkage."""
        raw = Path(catalog_path).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        catalog = json.loads(raw.decode('utf-8-sig'))
        audit = json.loads(Path(audit_path).read_text(encoding='utf-8-sig'))
        if audit.get('catalog_sha256') != digest:
            raise ValueError('知识目录与核验记录 SHA-256 不一致')
        records = {r['id']: r for r in audit['records']}
        batch = 'round-' + str(catalog['round'])
        nodes, edges, seen, corrections = [], [], set(), []

        def node(nid, kind, title, payload):
            if nid not in seen:
                nodes.append((nid, kind, title, encode(payload), batch)); seen.add(nid)

        topic_id = batch + ':topic'
        node(topic_id, 'topic', topic, {'status': 'reviewed_conditional', 'full_model_validated': False})
        for rule in catalog['rules']:
            rec = records.get(rule.get('source_id'))
            sha = rule.get('source_sha256', '')
            doc = documents.get(sha)
            if not rec or rec.get('sha256') != sha or not doc or not rec.get('read_scope'):
                raise ValueError('结论缺少已核读来源或当前索引身份')
            # Reading extent and physical validation are independent axes.
            # A full-text index label alone is insufficient: this audit must
            # explicitly record a full reading, with its existing source scope.
            reviewed = doc['status'] == 'registered_partial_review' or (
                doc['status'] == 'registered_full_text_review'
                and rec.get('full_document_read') is True)
            if not reviewed or rule.get('adoption_status') != 'not_adopted' or rule.get('full_model_validated') is not False:
                raise ValueError('当前导入器只接收有范围核读的条件性结论')
            rid = batch + ':' + rule['id']
            if rid in seen:
                raise ValueError('结论标识重复')
            sid = 'source:' + sha
            node(sid, 'source', doc['title'], {'sha256': sha, 'source_id': rec['id'], 'read_scope': rec['read_scope'], 'current_paths': json.loads(doc['paths']), 'full_model_validated': False, **({'full_document_read': rec['full_document_read']} if 'full_document_read' in rec else {})})
            node(rid, 'rule', rule['statement'], rule)
            cid = rid + ':conditions'
            node(cid, 'conditions_and_gaps', rule['conditions_and_missing_evidence'], {'full_model_validated': False, 'status': 'needs_verification'})
            edges.extend([(rid, 'supported_by', sid, batch), (rid, 'applies_when_and_needs', cid, batch), (rid, 'about', topic_id, batch)])
            targets = rule.get('corrects', [])
            if not isinstance(targets, list) or len(targets) > 20 or any(not isinstance(t, str) or not t or len(t) > 200 or t == rid for t in targets) or len(set(targets)) != len(targets):
                raise ValueError('更正依据必须关联不同的已有结论节点')
            corrections.extend((rid, target) for target in targets)
        with self.connect() as db:
            old = db.execute('SELECT catalog_sha256 FROM imports WHERE batch=?', (batch,)).fetchone()
            if old and old[0] != digest:
                raise ValueError('已导入批次内容改变；须先审计版本迁移，不覆盖已有记忆依据')
            for rid, target in corrections:
                prior = db.execute('SELECT kind FROM nodes WHERE id=?', (target,)).fetchone()
                if not prior or prior['kind'] != 'rule':
                    raise ValueError('更正目标必须是已有结论；原记录保持')
                reaches = db.execute("WITH RECURSIVE downstream(id) AS (SELECT dst FROM edges WHERE src=? AND relation='corrects' UNION SELECT e.dst FROM edges e JOIN downstream d ON e.src=d.id WHERE e.relation='corrects') SELECT 1 FROM downstream WHERE id=?", (target, rid)).fetchone()
                if reaches:
                    raise ValueError('更正关联不能形成循环')
            for row in nodes:
                if row[1] == 'source':
                    # A supplementary review shares the content identity, but must
                    # not replace the scope supporting an earlier imported rule.
                    db.execute('INSERT OR IGNORE INTO nodes VALUES(?,?,?,?,?)', row)
                    db.execute('INSERT OR IGNORE INTO source_reviews VALUES(?,?,?,?,?)',
                               (row[0], batch, json.loads(row[3])['source_id'], row[2], row[3]))
                else:
                    db.execute('INSERT INTO nodes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,payload=excluded.payload', row)
            db.executemany('INSERT OR IGNORE INTO edges VALUES(?,?,?,?)', edges)
            db.executemany('INSERT OR IGNORE INTO edges VALUES(?,?,?,?)', [(rid, 'corrects', target, batch) for rid, target in corrections])
            db.execute('INSERT OR IGNORE INTO imports VALUES(?,?,?)', (batch, digest, datetime.now(timezone.utc).isoformat()))
        return self.stats()

    def stats(self):
        with self.connect() as db:
            return {'nodes': db.execute('SELECT count(*) FROM nodes').fetchone()[0], 'edges': db.execute('SELECT count(*) FROM edges').fetchone()[0], 'memories': db.execute('SELECT count(*) FROM memories').fetchone()[0], 'kinds': dict(db.execute('SELECT kind,count(*) FROM nodes GROUP BY kind')), 'batches': [dict(r) for r in db.execute('SELECT * FROM imports')], 'scope': '仅已导入的范围核读结论；图谱数量不等于学习覆盖率', 'full_model_validated': False}

    @staticmethod
    def bounds(query, limit):
        if not isinstance(query, str) or len(query) > 500 or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('检索词或结果数量无效')
        return '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'

    @staticmethod
    def unpack(row):
        value = dict(row); value['payload'] = json.loads(value['payload']); return value

    def annotated(self, db, rows):
        """Expose source-backed amendments while keeping imported claims intact."""
        items = [self.unpack(row) for row in rows]
        for item in items:
            if item['kind'] == 'source':
                item['review_scopes'] = [
                    dict(batch=r['batch'], record_id=r['record_id'], title=r['title'],
                         payload=json.loads(r['payload']))
                    for r in db.execute('SELECT * FROM source_reviews WHERE source_id=? ORDER BY batch,record_id', (item['id'],))
                ]
            amendments = db.execute("SELECT n.* FROM edges e JOIN nodes n ON n.id=e.src WHERE e.dst=? AND e.relation='corrects' ORDER BY n.id", (item['id'],)).fetchall()
            if amendments:
                item['corrections'] = [self.unpack(row) for row in amendments]
                item['review_status'] = 'has_source_backed_correction'
        return items

    def search(self, query='', limit=30):
        pattern = self.bounds(query, limit)
        with self.connect() as db:
            rows = db.execute("SELECT * FROM nodes WHERE title LIKE ? ESCAPE '\\' OR payload LIKE ? ESCAPE '\\' ORDER BY CASE kind WHEN 'rule' THEN 0 ELSE 1 END,id LIMIT ?", (pattern, pattern, limit)).fetchall()
            items = self.annotated(db, rows)
        return {'items': items, 'limit': limit}

    def neighborhood(self, node_id):
        with self.connect() as db:
            center = db.execute('SELECT * FROM nodes WHERE id=?', (node_id,)).fetchone()
            if not center:
                raise ValueError('图谱节点不存在')
            edges = [dict(r) for r in db.execute('SELECT * FROM edges WHERE src=? OR dst=? ORDER BY relation,src,dst LIMIT 100', (node_id, node_id))]
            ids = {node_id} | {e[k] for e in edges for k in ('src', 'dst')}
            nodes = self.annotated(db, [db.execute('SELECT * FROM nodes WHERE id=?', (i,)).fetchone() for i in sorted(ids)])
        return {'center': node_id, 'nodes': nodes, 'edges': edges, 'limit': 100}

    def remember(self, kind, text, scope, provenance, node_ids=None):
        if kind not in ('user_preference', 'engineering_lesson', 'open_question'):
            raise ValueError('记忆类型无效')
        for value in (text, scope, provenance):
            if not isinstance(value, str) or not value.strip() or len(value) > 4000:
                raise ValueError('记忆必须有正文、适用范围和来源，且各不超过4000字')
        node_ids = node_ids or []
        if not isinstance(node_ids, list) or len(node_ids) > 20 or any(not isinstance(i, str) or len(i) > 200 for i in node_ids):
            raise ValueError('记忆来源节点无效')
        node_ids = sorted(set(node_ids))
        if kind == 'engineering_lesson' and not node_ids:
            raise ValueError('工程经验必须关联图谱证据')
        mid = hashlib.sha256(encode([kind, text, scope, provenance, node_ids]).encode()).hexdigest()[:32]
        status = {'user_preference': 'user_stated', 'engineering_lesson': 'reviewed_conditional', 'open_question': 'unresolved'}[kind]
        with self.connect() as db:
            for nid in node_ids:
                row = db.execute('SELECT kind FROM nodes WHERE id=?', (nid,)).fetchone()
                if not row or (kind == 'engineering_lesson' and row['kind'] != 'rule'):
                    raise ValueError('工程经验仅关联已核读结论节点')
            db.execute('INSERT OR IGNORE INTO memories VALUES(?,?,?,?,?,?,?)', (mid, kind, text, scope, provenance, status, datetime.now(timezone.utc).isoformat()))
            db.executemany('INSERT OR IGNORE INTO memory_links VALUES(?,?)', [(mid, i) for i in node_ids])
        return {'id': mid, 'status': status, 'node_ids': node_ids}

    def memories(self, query='', limit=30):
        pattern = self.bounds(query, limit)
        with self.connect() as db:
            rows = db.execute("SELECT * FROM memories WHERE text LIKE ? ESCAPE '\\' OR scope LIKE ? ESCAPE '\\' ORDER BY created_utc DESC,id LIMIT ?", (pattern, pattern, limit)).fetchall()
            items = [dict(r, node_ids=[x[0] for x in db.execute('SELECT node_id FROM memory_links WHERE memory_id=?', (r['id'],))]) for r in rows]
        return {'items': items, 'limit': limit}
