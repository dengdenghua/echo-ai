"""Local screenshot and UX evidence ledger. No automatic visual verdicts."""
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from deep_common import atomic_json, read_json, sha256, workspace, contained, bounded_int

PRODUCER = 'rea-walkthrough'
DEFAULT_COVERAGE = [
    ('visual-layout', 'visual', '布局、对齐、间距、字号和颜色一致性'),
    ('visual-obstruction', 'visual', '键盘、系统栏、弹窗、文本截断与遮挡'),
    ('visual-accessibility', 'visual', '触控尺寸、标签、放大字体与可读性'),
    ('ux-main-flow', 'ux', '主要操作路径与结果反馈'),
    ('ux-loading', 'ux', '加载状态、重复操作与等待反馈'),
    ('ux-empty', 'ux', '空白状态和下一步提示'),
    ('ux-error', 'ux', '错误提示、重试与恢复'),
    ('ux-back', 'ux', '返回、取消、状态与输入恢复'),
    ('ux-role', 'ux', '角色切换、当前角色提示及历史隔离（如适用）'),
]


def required(p, name, maximum=4000):
    value = p.get(name)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(name + ' must be nonempty text within ' + str(maximum) + ' characters')
    return value


def choice(p, name, values):
    value = required(p, name)
    if value not in values:
        raise ValueError('Invalid ' + name)
    return value


def items(p, name, maximum=30):
    value = p.get(name, [])
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(v, str) or len(v) > 2000 for v in value):
        raise ValueError('Invalid list: ' + name)
    return value


def slug(value):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
        raise ValueError('Invalid record ID')
    return value


def root_path(p):
    path = Path(required(p, 'audit'))
    if not path.is_absolute():
        raise ValueError('audit must be absolute')
    return path.resolve()


@contextmanager
def locked(root):
    with (root / '.audit.lock').open('a+') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def load(root):
    m = read_json(root / 'audit.json')
    if m.get('producer') != PRODUCER or m.get('schema') != 1:
        raise ValueError('Not a compatible walkthrough directory')
    return m


def start(p):
    root = root_path(p)
    package = required(p, 'package', 200)
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+', package):
        raise ValueError('Invalid Android package')
    serial = p.get('serial')
    if serial is not None and not re.fullmatch(r'[A-Za-z0-9_.:\[\]-]{1,200}', serial):
        raise ValueError('Invalid device serial')
    link = None
    if p.get('workspace'):
        w, metadata = workspace(p['workspace'])
        summary = read_json(w / 'summary.json')
        packages = [a.get('package') for a in summary.get('manifests', [])]
        if package not in packages:
            raise ValueError('Selected package is not declared in the linked unpacking workspace')
        link = {'path': str(w), 'source': metadata['source'], 'index_id': summary['index_id']}
    if root.exists() and not (root / 'audit.json').exists() and any(root.iterdir()):
        raise ValueError('Use a new/empty audit directory; existing user files are preserved')
    root.mkdir(parents=True, exist_ok=True)
    with locked(root):
        if (root / 'audit.json').exists():
            old = load(root)
            if old['package'] != package or old.get('serial') != serial or old.get('workspace') != link:
                raise ValueError('This ledger is bound to a different device/package/workspace generation')
            return {'audit': str(root), 'metadata': old, 'resumed': True}
        for directory in ['snapshots', 'actions', 'coverage', 'findings', 'history', 'reports']:
            (root / directory).mkdir()
        metadata = {'schema': 1, 'producer': PRODUCER, 'created_at': time.time(), 'package': package,
                    'serial': serial, 'title': p.get('title', '视觉与 UX 走查'), 'workspace': link}
        atomic_json(root / 'audit.json', metadata)
        for ident, area, goal in DEFAULT_COVERAGE:
            atomic_json(root / 'coverage' / (ident + '.json'), {'id': ident, 'area': area, 'goal': goal,
                        'status': 'unreviewed', 'snapshot_ids': [], 'steps': [], 'actual': '', 'limitation': '尚未观察'})
        return {'audit': str(root), 'metadata': metadata, 'resumed': False}


def inventory(root, directory):
    return [read_json(p) for p in sorted((root / directory).glob('*.json'))]


def status(root, metadata):
    snapshots = inventory(root, 'snapshots')
    return {'audit': str(root), 'metadata': metadata,
            'snapshots': [{k: s.get(k) for k in ['id', 'label', 'created_at', 'origin', 'foreground', 'width', 'height', 'limitations']} for s in snapshots],
            'actions': inventory(root, 'actions'), 'coverage': inventory(root, 'coverage'), 'findings': inventory(root, 'findings')}


def adb(metadata, args, allow_failure=False):
    serial = metadata.get('serial')
    if not serial:
        raise ValueError('This ledger has no explicit Android serial; use import or create a device-bound ledger')
    command = os.environ.get('REA_ADB_PATH') or shutil.which('adb')
    if not command:
        raise ValueError('ADB unavailable; configure REA_ADB_PATH')
    result = subprocess.run([command, '-s', serial, *args], capture_output=True, timeout=35)
    if len(result.stdout) > 24 * 1024 * 1024:
        raise ValueError('Device output exceeds 24 MiB')
    if result.returncode and not allow_failure:
        raise ValueError('Device command failed: ' + result.stderr.decode('utf-8', 'replace')[:1000])
    return result.stdout, result.returncode


def adb_text(m, args, allow_failure=False):
    out, code = adb(m, args, allow_failure)
    return out.decode('utf-8', 'replace'), code


@contextmanager
def device_lock(metadata):
    serial = metadata.get('serial')
    if not serial:
        raise ValueError('Select an explicit device')
    directory = Path.home() / '.local/share/rea-reverse-engineering/device-locks'
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / (hashlib.sha256(serial.encode()).hexdigest() + '.lock')).open('a+') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def foreground(m):
    text, _ = adb_text(m, ['shell', 'dumpsys', 'activity', 'activities'])
    for line in text.splitlines():
        if 'topResumedActivity' in line or 'mResumedActivity' in line:
            match = re.search(r'\s([A-Za-z0-9_.]+/[A-Za-z0-9_.$]+)', line)
            if match:
                return match.group(1), text
    focus, _ = adb_text(m, ['shell', 'dumpsys', 'window', 'windows'])
    for line in focus.splitlines():
        if 'mCurrentFocus' in line:
            match = re.search(r'\s([A-Za-z0-9_.]+/[A-Za-z0-9_.$]+)', line)
            if match:
                return match.group(1), text + '\n' + focus
    return None, text + '\n' + focus


def hierarchy(m):
    remote = '/data/local/tmp/rea-walkthrough-' + uuid.uuid4().hex + '.xml'
    try:
        log, code = adb_text(m, ['shell', 'uiautomator', 'dump', remote], True)
        raw, readcode = adb(m, ['exec-out', 'cat', remote], True)
        if code or readcode or b'<hierarchy' not in raw:
            return None, 'UI hierarchy unavailable: ' + log[:500]
        ET.fromstring(raw)
        return raw, None
    except (ET.ParseError, subprocess.TimeoutExpired) as error:
        return None, 'UI hierarchy unavailable: ' + str(error)
    finally:
        adb(m, ['shell', 'rm', '-f', remote], True)


def png_size(path):
    if path.stat().st_size > 24 * 1024 * 1024:
        raise ValueError('PNG exceeds 24 MiB')
    with path.open('rb') as stream:
        header = stream.read(24)
    if header[:16] != b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR':
        raise ValueError('Expected a PNG screenshot with IHDR')
    width, height = struct.unpack('>II', header[16:24])
    if not 0 < width <= 20000 or not 0 < height <= 20000:
        raise ValueError('Unsupported image dimensions')
    return width, height


def nodes(raw):
    result = []
    if not raw:
        return result
    for i, node in enumerate(ET.fromstring(raw).iter('node')):
        a = node.attrib
        match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', a.get('bounds', ''))
        result.append({'node_id': 'n' + str(i), 'text': a.get('text', ''), 'description': a.get('content-desc', ''),
                       'resource_id': a.get('resource-id', ''), 'class': a.get('class', ''), 'package': a.get('package', ''),
                       'bounds': list(map(int, match.groups())) if match else None,
                       'clickable': a.get('clickable') == 'true', 'enabled': a.get('enabled') == 'true',
                       'scrollable': a.get('scrollable') == 'true', 'password': a.get('password') == 'true'})
    return result


def save_snapshot(root, m, directory, record, raw=None):
    record['width'], record['height'] = png_size(directory / 'screen.png')
    record['nodes'] = nodes(raw)
    record['files'] = [{'file': str(path.relative_to(root)), 'sha256': sha256(path)}
                       for path in sorted(directory.iterdir()) if path.is_file()]
    atomic_json(root / 'snapshots' / (record['id'] + '.json'), record)
    return record


def capture(root, m, label):
    ident = 'screen_' + uuid.uuid4().hex
    directory = root / 'snapshots' / ident
    directory.mkdir()
    before, activity = foreground(m)
    raw, warning = hierarchy(m)
    image, _ = adb(m, ['exec-out', 'screencap', '-p'])
    (directory / 'screen.png').write_bytes(image)
    after, _ = foreground(m)
    display, _ = adb_text(m, ['shell', 'wm', 'size'])
    density, _ = adb_text(m, ['shell', 'wm', 'density'])
    keyboard, _ = adb_text(m, ['shell', 'dumpsys', 'input_method'], True)
    package, _ = adb_text(m, ['shell', 'dumpsys', 'package', m['package']], True)
    context = {'foreground_before': before, 'foreground_after': after, 'display': display, 'density': density,
               'keyboard_lines': [v.strip() for v in keyboard.splitlines() if any(x in v for x in ['mInputShown=', 'mIsInputViewShown=', 'mShowRequested=', 'mImeWindowVis='])],
               'version_lines': [v.strip() for v in package.splitlines() if 'versionName=' in v or 'versionCode=' in v]}
    atomic_json(directory / 'context.json', context)
    (directory / 'activity.txt').write_text(activity, encoding='utf-8')
    if raw:
        (directory / 'hierarchy.xml').write_bytes(raw)
    warnings = [warning] if warning else []
    if before != after:
        warnings.append('Foreground changed during capture; do not infer a single coherent state')
    if not after or after.split('/')[0] != m['package']:
        warnings.append('Foreground differs from selected package; device actions are disabled on this snapshot')
    warnings.append('Screenshot and accessibility hierarchy are sequential, not atomic; inspect image before judging')
    record = save_snapshot(root, m, directory, {'id': ident, 'created_at': time.time(), 'label': label,
                           'origin': 'adb', 'serial': m['serial'], 'package': m['package'], 'foreground': after,
                           'foreground_before': before, 'context': context, 'limitations': warnings}, raw)
    # Geometry is only a review candidate: child nodes may sit inside a larger touch target.
    matches = re.findall(r'(?:Override|Physical) density:\s*(\d+)', density)
    dpi = int(matches[-1]) if matches else None
    candidates = []
    for node in record['nodes']:
        b = node['bounds']
        if b and dpi and node['clickable'] and node['enabled']:
            w, h = (b[2] - b[0]) * 160 / dpi, (b[3] - b[1]) * 160 / dpi
            if 0 < min(w, h) < 48:
                candidates.append({'node_id': node['node_id'], 'width_dp': round(w, 1), 'height_dp': round(h, 1), 'kind': 'small_node_bounds', 'status': 'needs_review'})
    record['geometry_candidates'] = candidates
    atomic_json(root / 'snapshots' / (ident + '.json'), record)
    return record


def snapshot(root, ident):
    slug(ident)
    s = read_json(root / 'snapshots' / (ident + '.json'))
    if s.get('id') != ident:
        raise ValueError('Snapshot identity mismatch')
    for item in s['files']:
        if sha256(contained(root, item['file'])) != item['sha256']:
            raise ValueError('Changed screenshot/context evidence: ' + item['file'])
    return s


def result_snapshot(root, s, p):
    offset = bounded_int(p.get('node_offset', 0), 0, 100000, 'node_offset')
    limit = bounded_int(p.get('node_limit', 60), 1, 100, 'node_limit')
    return {**{k: v for k, v in s.items() if k != 'nodes'}, 'nodes': s['nodes'][offset:offset + limit],
            'node_total': len(s['nodes']), 'next_node_offset': offset + limit if offset + limit < len(s['nodes']) else None,
            'snapshot_file': str(root / 'snapshots' / (s['id'] + '.json')),
            'image_path': str(root / 'snapshots' / s['id'] / 'screen.png')}


def import_image(root, m, p):
    source = Path(required(p, 'path')).resolve(strict=True)
    if not Path(p['path']).is_absolute() or not source.is_file():
        raise ValueError('path must be an absolute PNG file')
    png_size(source)
    ident = 'screen_' + uuid.uuid4().hex
    directory = root / 'snapshots' / ident
    directory.mkdir()
    shutil.copyfile(source, directory / 'screen.png')
    s = save_snapshot(root, m, directory, {'id': ident, 'created_at': time.time(), 'label': required(p, 'label', 200),
        'origin': 'import', 'source_path': str(source), 'provenance': required(p, 'provenance', 2000),
        'package': m['package'], 'foreground': None, 'limitations': ['Imported image: runtime identity and action history are supplied provenance, not device-verified']})
    return result_snapshot(root, s, p)


def action(root, m, p):
    previous = snapshot(root, required(p, 'snapshot_id'))
    if previous['origin'] != 'adb' or previous.get('serial') != m.get('serial') or time.time() - previous['created_at'] > 120:
        raise ValueError('Use a fresh device snapshot captured within 120 seconds')
    focus, _ = foreground(m)
    if focus != previous['foreground'] or focus != previous['foreground_before'] or not focus or focus.split('/')[0] != m['package']:
        raise ValueError('Selected app/foreground changed; capture and inspect again')
    raw, warning = hierarchy(m)
    oldxml = root / 'snapshots' / previous['id'] / 'hierarchy.xml'
    if not raw or not oldxml.exists() or hashlib.sha256(raw).hexdigest() != sha256(oldxml):
        raise ValueError('UI hierarchy missing or changed; capture and inspect again')
    current, _ = foreground(m)
    if current != focus:
        raise ValueError('Foreground changed during action validation; capture and inspect again')
    action_name = choice(p, 'action', ['tap', 'swipe', 'back'])
    if action_name == 'tap':
        target = next((n for n in previous['nodes'] if n['node_id'] == p.get('node_id')), None)
        if not target or not target['clickable'] or not target['enabled'] or not target['bounds']:
            raise ValueError('Choose an observed enabled clickable node')
        l, t, r, b = target['bounds']
        if not (0 <= l < r <= previous['width'] and 0 <= t < b <= previous['height']):
            raise ValueError('Node outside screenshot bounds')
        argv = ['shell', 'input', 'tap', str((l + r) // 2), str((t + b) // 2)]
    elif action_name == 'swipe':
        points = p.get('points')
        if not isinstance(points, list) or len(points) != 4:
            raise ValueError('swipe requires points [x1,y1,x2,y2]')
        for i, v in enumerate(points):
            bounded_int(v, 0, (previous['width'] if i % 2 == 0 else previous['height']) - 1, 'point')
        argv = ['shell', 'input', 'swipe', *map(str, points), '350']
    else:
        argv = ['shell', 'input', 'keyevent', '4']
    ident = 'action_' + uuid.uuid4().hex
    record = {'id': ident, 'created_at': time.time(), 'snapshot_before': previous['id'], 'action': action_name,
              'node_id': p.get('node_id'), 'points': p.get('points'), 'expected': required(p, 'expected'), 'status': 'attempting'}
    label = required(p, 'label', 200)
    atomic_json(root / 'actions' / (ident + '.json'), record)
    try:
        adb(m, argv)
        record['status'] = 'executed_outcome_unreviewed'
        atomic_json(root / 'actions' / (ident + '.json'), record)
        after = capture(root, m, label)
        record['snapshot_after'] = after['id']
        atomic_json(root / 'actions' / (ident + '.json'), record)
        return {**result_snapshot(root, after, p), 'interaction': record}
    except BaseException as error:
        record.update({'error': str(error), 'status': 'action_or_capture_failed_outcome_unknown'})
        atomic_json(root / 'actions' / (ident + '.json'), record)
        raise


def revision(root, directory, ident, record):
    path = root / directory / (ident + '.json')
    if path.exists():
        atomic_json(root / 'history' / (directory + '-' + ident + '-' + uuid.uuid4().hex + '.json'), read_json(path))
    atomic_json(path, record)
    return {'record': record, 'path': str(path)}


def deep_records(m, ids):
    if not ids:
        return []
    if not m.get('workspace'):
        raise ValueError('No linked unpacking workspace')
    root, metadata = workspace(m['workspace']['path'])
    summary = read_json(root / 'summary.json')
    if metadata['source'] != m['workspace']['source'] or summary['index_id'] != m['workspace']['index_id']:
        raise ValueError('Linked unpacking generation changed; start a new ledger for that generation')
    from android_query import validate_evidence
    from deep_common import database
    db = database(root)
    try:
        result = []
        for ident in ids:
            if not re.fullmatch(r'deep_[a-f0-9]{64}', ident):
                raise ValueError('Invalid deep evidence ID')
            record = read_json(root / 'evidence' / (ident + '.json'))
            validate_evidence(root, db, record, summary['index_id'])
            result.append({'evidence_id': ident, 'file': str(root / 'evidence' / (ident + '.json')), 'sha256': sha256(root / 'evidence' / (ident + '.json'))})
        return result
    finally:
        db.close()


def coverage(root, m, p):
    ids = items(p, 'snapshot_ids')
    for ident in ids:
        snapshot(root, ident)
    state = choice(p, 'status', ['observed', 'blocked', 'unreviewed'])
    if state == 'observed':
        for ident in ids:
            s = snapshot(root, ident)
            if s['origin'] == 'adb' and (not s.get('foreground') or s['foreground'].split('/')[0] != m['package']):
                raise ValueError('Observed coverage must reference the selected app')
    actual = p.get('actual', '')
    if state == 'observed' and (not ids or not actual.strip()):
        raise ValueError('Observed coverage requires screenshots and actual outcome')
    record = {'id': slug(required(p, 'id')), 'area': choice(p, 'area', ['visual', 'ux']), 'goal': required(p, 'goal'),
              'status': state, 'snapshot_ids': ids, 'steps': items(p, 'steps'), 'actual': actual,
              'limitation': p.get('limitation', ''), 'updated_at': time.time()}
    return revision(root, 'coverage', record['id'], record)


def finding(root, m, p):
    ids = items(p, 'snapshot_ids', 20)
    if not ids:
        raise ValueError('A finding requires screenshot evidence')
    scenes = {ident: snapshot(root, ident) for ident in ids}
    for s in scenes.values():
        if s['origin'] == 'adb' and (not s.get('foreground') or s['foreground'].split('/')[0] != m['package']):
            raise ValueError('Finding screenshots must show the selected app')
    boxes = p.get('boxes', [])
    if not isinstance(boxes, list) or len(boxes) > 30:
        raise ValueError('Invalid boxes')
    for box in boxes:
        scene = scenes.get(box.get('snapshot_id'))
        rect = box.get('rect')
        if not scene or not isinstance(rect, list) or len(rect) != 4 or any(isinstance(x, bool) or not isinstance(x, int) for x in rect):
            raise ValueError('Boxes must reference finding screenshots with integer pixel rectangles')
        l, t, r, b = rect
        if not (0 <= l < r <= scene['width'] and 0 <= t < b <= scene['height']):
            raise ValueError('Annotation is outside screenshot')
        if not isinstance(box.get('label', ''), str) or len(box.get('label', '')) > 200:
            raise ValueError('Invalid annotation label')
    deep_ids = items(p, 'deep_evidence_ids', 20)
    links = deep_records(m, deep_ids)
    record = {'id': slug(required(p, 'id')), 'area': choice(p, 'area', ['visual', 'ux']), 'title': required(p, 'title', 200),
              'priority': choice(p, 'priority', ['P0', 'P1', 'P2', 'P3']),
              'evidence_type': choice(p, 'evidence_type', ['runtime_observation', 'inference']),
              'snapshot_ids': ids, 'boxes': boxes, 'steps': items(p, 'steps'), 'expected': required(p, 'expected'),
              'actual': required(p, 'actual'), 'suggestion': required(p, 'suggestion'), 'limitations': items(p, 'limitations'),
              'deep_evidence_ids': deep_ids, 'deep_links': links, 'updated_at': time.time()}
    return revision(root, 'findings', record['id'], record)


def report(root, m, p):
    title = required(p, 'title', 200)
    scenes, excluded = {}, []
    for s in inventory(root, 'snapshots'):
        try:
            scenes[s['id']] = snapshot(root, s['id'])
        except Exception as error:
            excluded.append({'id': s['id'], 'reason': str(error)})
    findings = []
    for f in inventory(root, 'findings'):
        try:
            if any(ident not in scenes for ident in f['snapshot_ids']):
                raise ValueError('Screenshot evidence missing/changed')
            current = deep_records(m, f.get('deep_evidence_ids', []))
            if current != f.get('deep_links', []):
                raise ValueError('Static evidence record changed')
            findings.append(f)
        except Exception as error:
            excluded.append({'id': f['id'], 'reason': str(error)})
    coverage = inventory(root, 'coverage')
    for c in coverage:
        if any(ident not in scenes for ident in c['snapshot_ids']):
            c.update({'status': 'unreviewed', 'limitation': '引用截图已变化或缺失；原记录保留'})
    actions = inventory(root, 'actions')
    static_findings = []
    if m.get('workspace'):
        try:
            static_root, _ = workspace(m['workspace']['path'])
            for item in sorted((static_root / 'findings').glob('*.json')):
                f = read_json(item)
                try:
                    if f.get('index_id') != m['workspace']['index_id']:
                        raise ValueError('Static finding index generation changed')
                    f['validated_links'] = deep_records(m, [r['evidence_id'] for r in f.get('references', [])])
                    static_findings.append(f)
                except Exception as error:
                    excluded.append({'id': 'static:' + f.get('id', item.name), 'reason': str(error)})
        except Exception as error:
            excluded.append({'id': 'linked-workspace', 'reason': str(error)})
    directory = root / 'reports' / str(time.time_ns())
    directory.mkdir()
    e = lambda value: html.escape(str(value), quote=True)
    parts = ['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + e(title) + '</title>',
             '<style>body{font:16px/1.65 system-ui;background:#f5f6fa;color:#172038;max-width:1100px;margin:auto;padding:24px}article,section{background:white;border:1px solid #dde2ee;border-radius:16px;padding:20px;margin:18px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}.scene{position:relative;width:min(100%,400px)}.scene img{width:100%;display:block}.box{position:absolute;border:2px solid #f34;box-sizing:border-box}.box span{background:#c21;color:white;font-size:12px;position:absolute;top:0;left:0}.muted{color:#687187}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:12px 0}</style>',
             '<h1>' + e(title) + '</h1><p>' + e(m['package']) + ' · ' + e(m.get('serial') or '导入截图') + '</p>',
             '<p class="muted">真实截图与实际操作构成观察证据。自动几何候选不等同于已确认问题；未观察状态保留为未覆盖。截图可能包含私人内容，报告保存在本地。</p>',
             '<section><h2>覆盖范围</h2><table><tr><th>类型</th><th>页面／目标</th><th>状态</th><th>观察／限制</th></tr>']
    state_labels = {'unreviewed': '未走查', 'observed': '已观察', 'blocked': '受阻'}
    for c in coverage:
        parts.append('<tr><td>' + e(c['area']) + '</td><td>' + e(c['goal']) + '</td><td>' + state_labels[c['status']] + '</td><td>' + e(c.get('actual', '') + ' ' + c.get('limitation', '')) + '<details><summary>步骤与截图</summary><pre>' + e('\n'.join(c['steps'] + c['snapshot_ids'])) + '</pre></details></td></tr>')
    parts.append('</table></section><h2>问题清单（' + str(len(findings)) + '）</h2>')
    if not findings:
        parts.append('<p>尚未记录有证据的问题；不能据此判定界面或 UX 通过。</p>')
    for f in sorted(findings, key=lambda f: (f['priority'], f['id'])):
        parts.append('<article><h3>' + e(f['priority'] + ' · ' + f['title']) + '</h3><p>' + e(f['area'] + ' · ' + f['evidence_type']) + '</p>')
        for label, value in [('复现', '\n'.join(f['steps'])), ('预期', f['expected']), ('实际', f['actual']), ('建议', f['suggestion']), ('限制', '\n'.join(f['limitations']))]:
            parts.append('<b>' + label + '</b><pre>' + e(value) + '</pre>')
        for ident in f['snapshot_ids']:
            s = scenes[ident]
            image = base64.b64encode((root / 'snapshots' / ident / 'screen.png').read_bytes()).decode()
            parts.append('<p>' + e(s['label'] + ' · ' + ident) + '</p><div class="scene"><img alt="' + e(s['label']) + '" src="data:image/png;base64,' + image + '">')
            for box in f['boxes']:
                if box['snapshot_id'] == ident:
                    l, t, r, b = box['rect']
                    parts.append('<div class="box" style="left:%.4f%%;top:%.4f%%;width:%.4f%%;height:%.4f%%"><span>%s</span></div>' % (l * 100 / s['width'], t * 100 / s['height'], (r-l) * 100 / s['width'], (b-t) * 100 / s['height'], e(box.get('label', ''))))
            parts.append('</div>')
        if f.get('deep_links'):
            parts.append('<details><summary>关联解包证据</summary><pre>' + e(json.dumps(f['deep_links'], ensure_ascii=False, indent=2)) + '</pre></details>')
        parts.append('</article>')
    parts.append('<section><h2>截图与操作记录</h2>')
    for s in scenes.values():
        image = base64.b64encode((root / 'snapshots' / s['id'] / 'screen.png').read_bytes()).decode()
        parts.append('<details><summary>' + e(s['label'] + ' · ' + s['id']) + '</summary><div class="scene"><img alt="' + e(s['label']) + '" src="data:image/png;base64,' + image + '"></div><pre>' + e(json.dumps({k: v for k, v in s.items() if k != 'nodes'}, ensure_ascii=False, indent=2)) + '</pre></details>')
    parts.append('<pre>' + e(json.dumps(actions, ensure_ascii=False, indent=2)) + '</pre></section>')
    if m.get('workspace'):
        parts.append('<section><h2>解包逆向绑定</h2><pre>' + e(json.dumps(m['workspace'], ensure_ascii=False, indent=2)) + '</pre><p>静态调用不能证明页面实际执行；UI 与代码关系需要关联证据支持。</p></section>')
        for f in static_findings:
            parts.append('<section><h3>静态分析 · ' + e(f['id']) + '</h3><p>' + e(f['claim']) + '</p><pre>' + e(json.dumps(f, ensure_ascii=False, indent=2)) + '</pre></section>')
    if excluded:
        parts.append('<section><h2>未纳入的证据</h2><pre>' + e(json.dumps(excluded, ensure_ascii=False, indent=2)) + '</pre></section>')
    parts.append('</html>')
    (directory / 'report.html').write_text('\n'.join(parts), encoding='utf-8')
    markdown = ['# ' + title, '', '应用：' + m['package'], '', '## 覆盖范围', '']
    for c in coverage:
        markdown.append('- ' + state_labels[c['status']] + '：' + c['goal'] + ' — ' + c.get('actual', '') + ' ' + c.get('limitation', ''))
    markdown.extend(['', '## 问题清单', ''])
    for f in findings:
        markdown.extend(['### ' + f['priority'] + ' ' + f['title'], '', '类型：' + f['evidence_type'], '', '复现：' + '\n'.join(f['steps']), '', '预期：' + f['expected'], '', '实际：' + f['actual'], '', '建议：' + f['suggestion'], ''])
        for ident in f['snapshot_ids']:
            markdown.append('![' + scenes[ident]['label'].replace(']', '') + '](<' + str(root / 'snapshots' / ident / 'screen.png') + '>)')
        markdown.extend(['', '解包证据：' + ', '.join(f.get('deep_evidence_ids', [])), '', '限制：' + '\n'.join(f['limitations']), ''])
    if not findings:
        markdown.append('尚未记录有证据的问题；不能判定走查通过。')
    if m.get('workspace'):
        markdown.extend(['', '## 解包逆向', '', '静态实现不等同于运行时已观察的路径。', ''])
        for f in static_findings:
            markdown.extend(['### ' + f['id'], '', f['claim'], '', '范围：' + f['scope'], '', '证据：' + ', '.join(r['evidence_id'] for r in f.get('references', [])), '', '限制：' + '\n'.join(f['limitations']), ''])
    markdown.extend(['', '## 操作记录', '', '```json', json.dumps(actions, ensure_ascii=False, indent=2), '```', '', '## 排除证据', '', '```json', json.dumps(excluded, ensure_ascii=False, indent=2), '```'])
    (directory / 'report.md').write_text('\n'.join(markdown), encoding='utf-8')
    atomic_json(directory / 'manifest.json', {'created_at': time.time(), 'metadata': m, 'findings': findings, 'coverage': coverage, 'excluded': excluded,
                                            'snapshots': list(scenes.values()), 'actions': actions, 'static_findings': static_findings})
    return {'html': str(directory / 'report.html'), 'markdown': str(directory / 'report.md'), 'manifest': str(directory / 'manifest.json'),
            'finding_count': len(findings), 'static_finding_count': len(static_findings), 'screenshot_count': len(scenes), 'excluded': excluded,
            'unreviewed_count': sum(c['status'] != 'observed' for c in coverage)}


def main():
    p = json.load(sys.stdin)
    command = sys.argv[1]
    if command == 'audit-start':
        return start(p)
    root = root_path(p)
    m = load(root)
    with locked(root):
        if command == 'audit-status':
            return status(root, m)
        if command == 'audit-import':
            return import_image(root, m, p)
        if command == 'audit-read':
            return result_snapshot(root, snapshot(root, required(p, 'snapshot_id')), p)
        if command in ['audit-capture', 'audit-action']:
            with device_lock(m):
                if command == 'audit-action':
                    return action(root, m, p)
                return result_snapshot(root, capture(root, m, required(p, 'label', 200)), p)
        if command == 'audit-coverage':
            return coverage(root, m, p)
        if command == 'audit-finding':
            return finding(root, m, p)
        if command == 'audit-report':
            return report(root, m, p)
        raise ValueError('Unknown walkthrough action')


if __name__ == '__main__':
    try:
        json.dump(main(), sys.stdout, ensure_ascii=False)
        sys.stdout.write('\n')
    except Exception as error:
        json.dump({'error': type(error).__name__, 'message': str(error)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write('\n')
        sys.exit(1)
