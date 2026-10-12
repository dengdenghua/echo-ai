"""Bounded, source-bound queries over a completed Android workspace index."""
from collections import deque
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import quote
from deep_common import atomic_json, bounded_int, contained, database, evidence, file_identity, read_json, workspace

STATIC_LIMITS = ['Static analysis does not establish runtime execution, account availability or backend implementation']


def validate_evidence(root, db, record, index_id):
    if record['index_id'] != index_id:
        raise ValueError('Evidence belongs to an earlier index generation')
    checked = {}
    def visit(value):
        if isinstance(value, dict):
            relative, digest = value.get('file'), value.get('sha256')
            if isinstance(relative, str) and isinstance(digest, str):
                if relative not in checked:
                    checked[relative] = file_identity(root, db, relative)
                if checked[relative]['sha256'] != digest:
                    raise ValueError('Evidence source digest changed: ' + relative)
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)
    visit(record['result'])


def indexed(payload):
    root, metadata = workspace(payload['workspace'])
    if not (root / 'index.sqlite').exists() or not (root / 'summary.json').exists():
        raise ValueError('Workspace has no completed index yet; read status first')
    db = database(root)
    state = read_json(root / 'state.json')
    if state.get('status') in ('running', 'queued'):
        db.close()
        raise ValueError('Wait for the workspace worker before querying a changing index')
    if payload.get('index_id') and payload['index_id'] != read_json(root / 'summary.json')['index_id']:
        db.close()
        raise ValueError('Index generation changed; restart pagination against the current index')
    return root, metadata, db


def line_view(root, db, relative, first, count):
    identity = file_identity(root, db, relative)
    path = contained(root, relative)
    if path.suffix in ('.apk', '.dex', '.so', '.arsc', '.sqlite'):
        raise ValueError('Use metadata/native strings for binary files, not text line reads')
    lines = []
    has_more = False
    long_lines = False
    with path.open(encoding='utf-8', errors='replace') as stream:
        for number, text in enumerate(stream, 1):
            if number < first:
                continue
            if len(lines) >= count:
                has_more = True
                break
            text = text.rstrip('\r\n')
            long_lines |= len(text) > 4000
            lines.append({'line': number, 'text': text[:4000], 'truncated': len(text) > 4000})
    return {**identity, 'lines': lines, 'has_more': has_more,
            'next_start_line': first + len(lines) if has_more else None,
            'long_lines_truncated': long_lines}


def read(payload):
    root, _, db = indexed(payload)
    try:
        start = bounded_int(payload.get('start_line', 1), 1, 100000000, 'start_line')
        count = bounded_int(payload.get('line_count', 80), 1, 200, 'line_count')
        result = line_view(root, db, payload['file'], start, count)
        return evidence(root, 'read_android_evidence', payload, result,
                        STATIC_LIMITS + ['Lines over 4000 characters are clipped in the response; the hashed source file is retained'])
    finally:
        db.close()


def search(payload):
    root, _, db = indexed(payload)
    process = timer = None
    try:
        query = payload['query']
        if not isinstance(query, str) or not query or len(query) > 4096:
            raise ValueError('query must contain 1 to 4096 characters')
        scope = payload.get('scope', 'all')
        if scope not in ('all', 'java', 'smali', 'resources', 'assets', 'native'):
            raise ValueError('Unknown search scope')
        limit = bounded_int(payload.get('limit', 50), 1, 100, 'limit')
        offset = bounded_int(payload.get('offset', 0), 0, 10000000, 'offset')
        regex, ignore_case = payload.get('regex', False), payload.get('ignore_case', True)
        if not isinstance(regex, bool) or not isinstance(ignore_case, bool):
            raise ValueError('regex and ignore_case must be boolean')
        engine = shutil.which('rg')
        if not engine:
            raise ValueError('ripgrep is required for workspace searches; install rg')
        folders = {'all': ['decoded', 'java', 'native', 'raw'], 'java': ['java'], 'smali': ['decoded'],
                   'resources': ['decoded'], 'assets': ['raw'], 'native': ['native']}[scope]
        folders = [name for name in folders if (root / name).exists()]
        if not folders:
            return evidence(root, 'search_android_workspace', payload,
                            {'matches': [], 'has_more': False, 'scope': scope, 'scope_missing': True},
                            STATIC_LIMITS + ['Selected analysis stage did not produce this search scope'])
        argv = [engine, '--json', '--sort', 'path', '--no-ignore', '--hidden', '--no-messages']
        if not regex:
            argv.append('--fixed-strings')
        if ignore_case:
            argv.append('--ignore-case')
        globs = {'java': ['*.java'], 'smali': ['*.smali'],
                 'resources': ['*.xml', 'apktool.yml'], 'assets': ['**/assets/**'],
                 'native': ['*.txt', '*.json']}
        pattern = payload.get('file_glob')
        if pattern is not None:
            if not isinstance(pattern, str) or not 1 <= len(pattern) <= 1024 or pattern.startswith('!'):
                raise ValueError('file_glob must be a positive glob with 1 to 1024 characters')
            argv.extend(['--glob', pattern])
        else:
            for item in globs.get(scope, []):
                argv.extend(['--glob', item])
        argv.extend(['-e', query, '--', *folders])
        process = subprocess.Popen(argv, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
        expired = threading.Event()
        def deadline():
            expired.set()
            if process.poll() is None:
                process.terminate()
        timer = threading.Timer(90, deadline)
        timer.daemon = True
        timer.start()
        matches, seen, more = [], 0, False
        checked = {}
        for line in process.stdout:
            event = json.loads(line)
            if event.get('type') != 'match':
                continue
            data = event['data']
            relative = data['path'].get('text')
            if not relative:
                continue
            kind_row = db.execute('SELECT kind FROM files WHERE path=?', (relative,)).fetchone()
            if kind_row is None or (scope != 'all' and kind_row['kind'] != scope):
                continue
            if seen < offset:
                seen += 1
                continue
            if len(matches) == limit:
                more = True
                process.terminate()
                break
            identity = checked.setdefault(relative, None)
            if identity is None:
                identity = file_identity(root, db, relative)
                checked[relative] = identity
            text = data['lines'].get('text', '').rstrip('\r\n')
            matches.append({**identity, 'line': data['line_number'], 'text': text[:2000],
                            'truncated': len(text) > 2000,
                            'match_byte_spans': [{'start': x['start'], 'end': x['end']} for x in data.get('submatches', [])][:20]})
            seen += 1
        process.wait(timeout=10)
        error = process.stderr.read(4000)
        if expired.is_set():
            raise TimeoutError('Search exceeded 90 seconds; narrow the query/scope/offset')
        if not more and process.returncode not in (0, 1):
            raise ValueError('ripgrep failed: ' + error)
        kinds = [scope] if scope != 'all' else ['java', 'smali', 'resources', 'assets', 'native', 'binary']
        count = db.execute('SELECT COUNT(*) FROM files WHERE kind IN (' + ','.join('?' for _ in kinds) + ')', kinds).fetchone()[0]
        result = {'matches': matches, 'has_more': more, 'next_offset': offset + len(matches) if more else None,
                  'scope': scope, 'indexed_files_in_scope': count, 'search_roots': folders,
                  'file_glob': pattern,
                  'index_id': read_json(root / 'summary.json')['index_id']}
        return evidence(root, 'search_android_workspace', payload, result,
                        STATIC_LIMITS + ['Search pages matching lines, not semantic references; binary/non-text members are excluded by rg',
                                         'No-match applies only to retained text in these roots; incomplete analysis stages remain unknown',
                                         'Hashes are checked for returned files, not every nonmatching file; reindex after intentional edits'])
    finally:
        if timer:
            timer.cancel()
        if process:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()
        db.close()


def trace(payload):
    root, _, db = indexed(payload)
    try:
        symbol = payload['symbol']
        if not isinstance(symbol, str) or not re.fullmatch(r'L[^;\s]+;->[^\s(]+\([^\s]*\)[^\s]+', symbol):
            raise ValueError('Supply an exact Smali symbol Lpackage/Class;->method(parameterDescriptors)returnDescriptor')
        direction = payload.get('direction', 'both')
        if direction not in ('incoming', 'outgoing', 'both'):
            raise ValueError('direction must be incoming, outgoing or both')
        depth = bounded_int(payload.get('depth', 2), 1, 5, 'depth')
        limit = bounded_int(payload.get('limit', 150), 1, 1000, 'limit')
        queue, visited, unique = deque([(symbol, 0)]), set(), set()
        edges, definitions, checked = [], [], {}
        truncated = False
        while queue:
            current, distance = queue.popleft()
            if current in visited:
                continue
            visited.add(current)
            for row in db.execute('SELECT * FROM methods WHERE symbol=? ORDER BY file,start_line', (current,)):
                relative = row['file']
                if relative not in checked:
                    checked[relative] = file_identity(root, db, relative)
                definitions.append({**dict(row), 'sha256': checked[relative]['sha256']})
            if distance == depth:
                continue
            clause = 'caller=?' if direction == 'outgoing' else 'callee=?' if direction == 'incoming' else '(caller=? OR callee=?)'
            params = (current, current) if direction == 'both' else (current,)
            # Each static operand remains distinct by file and instruction line.
            for row in db.execute('SELECT * FROM calls WHERE ' + clause + ' ORDER BY file,line', params):
                key = (row['file'], row['line'], row['caller'], row['callee'])
                if key in unique:
                    continue
                if len(edges) == limit:
                    truncated = True
                    break
                unique.add(key)
                relative = row['file']
                if relative not in checked:
                    checked[relative] = file_identity(root, db, relative)
                edges.append({**dict(row), 'distance': distance + 1, 'sha256': checked[relative]['sha256']})
                neighbour = row['callee'] if row['caller'] == current else row['caller']
                queue.append((neighbour, distance + 1))
            if truncated:
                break
        result = {'seed': symbol, 'direction': direction, 'depth': depth, 'edges': edges,
                  'definitions': definitions, 'visited_symbols': len(visited), 'truncated': truncated,
                  'seed_defined_in_index': bool(db.execute('SELECT 1 FROM methods WHERE symbol=? LIMIT 1', (symbol,)).fetchone())}
        return evidence(root, 'trace_android_callgraph', payload, result,
                        STATIC_LIMITS + ['Graph follows exact invoke operands only; virtual dispatch, reflection, invoke-custom and JNI are unresolved',
                                         'Depth/edge limits bound this search; a missing definition may be a dependency or a skipped split'])
    finally:
        db.close()


def methods(payload):
    root, _, db = indexed(payload)
    try:
        symbols = payload['symbols']
        if not isinstance(symbols, list) or not 1 <= len(symbols) <= 20 or any(not isinstance(x, str) for x in symbols):
            raise ValueError('symbols must be an array of 1 to 20 exact Smali symbols')
        count = bounded_int(payload.get('line_count', 80), 1, 150, 'line_count')
        results = []
        for symbol in symbols:
            rows = list(db.execute('SELECT * FROM methods WHERE symbol=? ORDER BY file,start_line', (symbol,)))
            bodies = []
            for row in rows:
                remaining = row['end_line'] - row['start_line'] + 1
                view = line_view(root, db, row['file'], row['start_line'], min(count, remaining))
                view.update({'end_line': row['end_line'], 'method_truncated': remaining > count,
                             'artifact': row['artifact'], 'next_start_line': row['start_line'] + count if remaining > count else None})
                # File continuation is not method continuation.
                view['has_more'] = remaining > count
                bodies.append(view)
            results.append({'symbol': symbol, 'found': bool(rows), 'bodies': bodies})
        return evidence(root, 'inspect_android_methods', payload, {'methods': results, 'representation': 'smali'},
                        STATIC_LIMITS + ['Smali bodies retain compiled operands; source-level names and higher-level structure may be obfuscated'])
    finally:
        db.close()


def resources(payload):
    root, _, db = indexed(payload)
    try:
        query = payload.get('query', '')
        if not isinstance(query, str) or len(query) > 4096:
            raise ValueError('query must be a string of at most 4096 characters')
        limit = bounded_int(payload.get('limit', 50), 1, 100, 'limit')
        offset = bounded_int(payload.get('offset', 0), 0, 10000000, 'offset')
        args = [query.lower(), query.lower()]
        clause = '(instr(lower(name),?)>0 OR instr(lower(value),?)>0)'
        for key in ('artifact', 'qualifier'):
            if payload.get(key):
                clause += ' AND ' + key + '=?'
                args.append(payload[key])
        rows = list(db.execute('SELECT * FROM resources WHERE ' + clause + ' ORDER BY artifact,qualifier,file,line,name LIMIT ? OFFSET ?',
                               args + [limit + 1, offset]))
        more = len(rows) > limit
        result, checked = [], {}
        for row in rows[:limit]:
            item = dict(row)
            relative = item['file']
            if relative not in checked:
                checked[relative] = file_identity(root, db, relative)
            item['sha256'] = checked[relative]['sha256']
            item['truncated'] = len(item['value']) > 2000
            item['value'] = item['value'][:2000]
            result.append(item)
        return evidence(root, 'query_android_resources', payload,
                        {'entries': result, 'has_more': more, 'next_offset': offset + limit if more else None,
                         'qualifiers': [x[0] for x in db.execute('SELECT DISTINCT qualifier FROM resources ORDER BY qualifier')]},
                        STATIC_LIMITS + ['Only resources in supplied APK/splits are indexed; absent language splits and runtime/server-generated copy remain unknown',
                                         'XML line locations point to the named resource declaration'])
    finally:
        db.close()


def overview(payload):
    root, _, db = indexed(payload)
    try:
        summary = read_json(root / 'summary.json')
        result = {**summary, 'workspace': str(root), 'state': read_json(root / 'state.json'),
                  'findings': [read_json(x) for x in sorted((root / 'findings').glob('*.json'))]}
        return evidence(root, 'summarize_android_workspace', payload, result, STATIC_LIMITS + summary['limitations'])
    finally:
        db.close()


def finding(payload):
    root, _, db = indexed(payload)
    try:
        identifier = payload['id']
        if not isinstance(identifier, str) or not re.fullmatch('[a-zA-Z0-9_-]{1,64}', identifier):
            raise ValueError('id must be 1 to 64 letters, digits, hyphens or underscores')
        claim, scope = payload['claim'], payload['scope']
        if not isinstance(claim, str) or not 1 <= len(claim) <= 8000 or not isinstance(scope, str) or not 1 <= len(scope) <= 4000:
            raise ValueError('claim and search scope must be nonempty bounded strings')
        kind, answer = payload['evidence_type'], payload['status']
        if kind not in ('static_observation', 'inference', 'unknown') or answer not in ('answered', 'partial', 'unresolved'):
            raise ValueError('Invalid finding evidence_type/status')
        identifiers = payload.get('evidence_ids', [])
        if not isinstance(identifiers, list) or len(identifiers) > 20:
            raise ValueError('evidence_ids must be an array of at most 20 IDs')
        index_id = read_json(root / 'summary.json')['index_id']
        references = []
        for identifier_value in identifiers:
            if not isinstance(identifier_value, str) or not re.fullmatch('deep_[a-f0-9]{64}', identifier_value):
                raise ValueError('Use an evidence_id returned by this workspace, not an upstream REA ID')
            record = read_json(root / 'evidence' / (identifier_value + '.json'))
            validate_evidence(root, db, record, index_id)
            references.append({'evidence_id': identifier_value, 'operation': record['operation']})
        if answer == 'answered' and (not references or kind == 'unknown'):
            raise ValueError('An answered finding requires saved evidence and a known evidence type')
        limitations = payload.get('limitations', [])
        if not isinstance(limitations, list) or len(limitations) > 30 or any(not isinstance(x, str) or len(x) > 2000 for x in limitations):
            raise ValueError('limitations must be an array of at most 30 bounded strings')
        item = {'id': identifier, 'claim': claim, 'scope': scope, 'evidence_type': kind, 'status': answer,
                'references': references, 'limitations': limitations, 'index_id': index_id, 'updated_at': time.time()}
        destination = root / 'findings' / (identifier + '.json')
        if destination.exists():
            old = read_json(destination)
            atomic_json(root / 'findings' / 'history' / (identifier + '-' + str(time.time_ns()) + '.json'), old)
        atomic_json(destination, item)
        return {'finding': item, 'finding_file': str(destination)}
    finally:
        db.close()


def report(payload):
    root, metadata, db = indexed(payload)
    try:
        summary = read_json(root / 'summary.json')
        findings = [read_json(x) for x in sorted((root / 'findings').glob('*.json'))]
        title = payload.get('title', 'Android 客户端逆向分析')
        if not isinstance(title, str) or not 1 <= len(title) <= 200:
            raise ValueError('title must contain 1 to 200 characters')
        lines = ['# ' + title.replace('\n', ' '), '', '## 样本与范围', '',
                 '- SHA-256: `' + metadata['source']['sha256'] + '`',
                 '- 工作目录: `' + str(root) + '`',
                 '- 索引版本: `' + summary['index_id'] + '`',
                 '- 静态资源、反编译与调用指令；运行时行为和服务端实现尚未由本工具验证。', '',
                 '## 分析覆盖', '', '```json', json.dumps(summary['counts'], ensure_ascii=False, indent=2), '```', '',
                 '完整覆盖与阶段错误见 [state.json](state.json) 和 [summary.json](summary.json)。', '',
                 '## 带证据的结论', '']
        if not findings:
            lines.append('尚未记录功能结论。页面名称、类目录和字符串只能作为追踪线索；本报告不把清单枚举当作已完成的功能逆向。')
        stale = []
        for item in findings:
            if item['index_id'] != summary['index_id']:
                stale.append(item['id'])
                continue
            try:
                for ref in item['references']:
                    record = read_json(root / 'evidence' / (ref['evidence_id'] + '.json'))
                    validate_evidence(root, db, record, summary['index_id'])
            except (ValueError, OSError, KeyError):
                stale.append(item['id'])
                continue
            lines.extend(['### ' + item['id'], '', item['claim'], '',
                          '- 类型: ' + item['evidence_type'], '- 问题状态: ' + item['status'],
                          '- 搜索边界: ' + item['scope']])
            for ref in item['references']:
                identifier = ref['evidence_id']
                lines.append('- [' + ref['operation'] + ' · ' + identifier + '](evidence/' + identifier + '.json)')
            lines.extend('- 局限: ' + x for x in item['limitations'])
            lines.append('')
        if stale:
            lines.extend(['## 待更新的旧结论', '', '这些结论引用先前索引或已改变/缺失的证据文件，已从当前结论区排除：' + ', '.join(stale), ''])
        lines.extend(['## 未完成阶段', ''])
        state = read_json(root / 'state.json')
        gaps = [(key, val) for key, val in state['steps'].items() if val['status'] != 'completed']
        if not gaps:
            lines.append('所有请求的解包/索引阶段已结束。这不等于已解释全部应用功能。')
        for key, val in gaps:
            reason = val.get('error') or val.get('result', {}).get('reason', '')
            lines.append('- `' + key + '` — ' + val['status'] + ': ' + reason)
        lines.extend(['', '## 关键材料', '', '- [完整资源/清单/原生库概览](summary.json)',
                      '- [反编译警告与失败标记](java-diagnostics.json)',
                      '- [归档成员与哈希](archive-members.json)',
                      '- `inputs/`: 原始 APK 与全部 supplied split',
                      '- `raw/`、`decoded/`、`java/`、`native/`: 保留的解包内容和生成输出', '',
                      'Smali 图保留精确 invoke 操作数，不解析动态分派、反射或所有 JNI 调用。原生符号/字符串索引没有替代 Ghidra 反编译。'])
        name = 'report-' + str(time.time_ns()) + '.md'
        path = root / name
        path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return {'report_file': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'findings_in_report': len(findings) - len(stale), 'stale_findings_excluded': stale}
    finally:
        db.close()


def compare(payload):
    old_root, old_metadata, old_db = indexed({'workspace': payload['old_workspace']})
    new_db = None
    try:
        new_root, new_metadata, new_db = indexed({'workspace': payload['new_workspace']})
        limit = bounded_int(payload.get('limit', 50), 1, 100, 'limit')
        old, new = read_json(old_root / 'summary.json'), read_json(new_root / 'summary.json')
        def permissions(summary):
            return {x for manifest in summary['manifests'] for x in manifest['permissions']}
        old_permissions, new_permissions = permissions(old), permissions(new)
        old_methods = {x[0] for x in old_db.execute('SELECT DISTINCT symbol FROM methods')}
        new_methods = {x[0] for x in new_db.execute('SELECT DISTINCT symbol FROM methods')}
        delta = {'old_source': old_metadata['source'], 'new_source': new_metadata['source'],
                 'old_index_id': old['index_id'], 'new_index_id': new['index_id'],
                 'permissions_added': sorted(new_permissions - old_permissions),
                 'permissions_removed': sorted(old_permissions - new_permissions),
                 'methods_added': sorted(new_methods - old_methods), 'methods_removed': sorted(old_methods - new_methods)}
        name = 'comparison-' + str(time.time_ns()) + '.json'
        atomic_json(new_root / name, delta)
        result = {**delta, 'comparison_file': str(new_root / name),
                  'methods_added_count': len(delta['methods_added']), 'methods_removed_count': len(delta['methods_removed']),
                  'methods_added': delta['methods_added'][:limit], 'methods_removed': delta['methods_removed'][:limit],
                  'method_examples_truncated': len(delta['methods_added']) > limit or len(delta['methods_removed']) > limit,
                  'old_counts': old['counts'], 'new_counts': new['counts']}
        return evidence(new_root, 'compare_android_workspaces', payload, result,
                        STATIC_LIMITS + ['Method-name deltas may reflect obfuscation/build changes; they do not establish behavior changes',
                                         'Missing split/stage coverage can produce apparent additions or removals; compare supplied artifacts and states'])
    finally:
        old_db.close()
        if new_db:
            new_db.close()


def dispatch(action, payload):
    actions = {'search': search, 'read': read, 'trace': trace, 'methods': methods, 'resources': resources,
               'overview': overview, 'finding': finding, 'report': report, 'compare': compare}
    if action not in actions:
        raise ValueError('Unknown deep action: ' + action)
    return actions[action](payload)
