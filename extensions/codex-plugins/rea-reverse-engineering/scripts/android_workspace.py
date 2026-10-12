#!/usr/bin/env python3
"""Persistent APK/XAPK pipeline. Long-running engines live in an owned worker."""
import json
import fcntl
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid
import zipfile
from deep_common import SCHEMA, atomic_json, bounded_int, read_json, sha256, workspace
from android_index import build_index


def command(name, environment_key):
    selected = os.environ.get(environment_key) or shutil.which(name)
    if not selected:
        raise ValueError(f'Missing {name}; install it or set {environment_key}')
    resolved = shutil.which(selected) if not Path(selected).is_absolute() else selected
    if not resolved or not os.access(resolved, os.X_OK):
        raise ValueError(f'{environment_key} does not select an executable')
    return resolved


def apksigner():
    configured = os.environ.get('REA_APKSIGNER_COMMAND')
    if configured:
        return command('apksigner', 'REA_APKSIGNER_COMMAND')
    sdk = os.environ.get('REA_ANDROID_SDK') or os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if sdk:
        candidates = list((Path(sdk) / 'build-tools').glob('*/apksigner'))
        candidates.sort(key=lambda path: tuple(int(n) for n in re.findall(r'\d+', path.parent.name)), reverse=True)
        for path in candidates:
            if os.access(path, os.X_OK):
                return str(path)
    return shutil.which('apksigner')


def worker_alive(root, lock):
    pid = lock.get('pid')
    if not isinstance(pid, int) or pid < 2:
        return False
    try:
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'args='], capture_output=True, text=True, timeout=5)
        # Bind cancellation to our own session leader and UUID, rather than a potentially reused PID.
        return (result.returncode == 0 and '_worker' in result.stdout
                and lock['job_id'] in result.stdout and str(root) in result.stdout
                and os.getpgid(pid) == pid)
    except (OSError, subprocess.TimeoutExpired):
        return False


def status(payload):
    root, metadata = workspace(payload['workspace'])
    state = read_json(root / 'state.json') if (root / 'state.json').exists() else {}
    lock_path = root / '.worker.lock'
    if lock_path.exists():
        lock = read_json(lock_path)
        state['worker_alive'] = worker_alive(root, lock)
        leased = not lock.get('pid') and time.time() - lock.get('created_at', 0) < 15
        if not state['worker_alive'] and not leased and state.get('status') in ('running', 'queued'):
            # A crash cannot be mistaken for a successful analysis; resume keeps completed phases.
            state = {**state, 'status': 'interrupted', 'remediation': 'Run prepare with the same path/workspace to resume; retry_failed=true retries failed stages'}
    result = {'workspace': str(root), 'source': metadata['source'], 'state': state,
              'summary_file': str(root / 'summary.json') if (root / 'summary.json').exists() else None}
    if (root / 'summary.json').exists():
        summary = read_json(root / 'summary.json')
        result.update({'index_id': summary['index_id'], 'counts': summary['counts'],
                       'diagnostics_count': len(summary['diagnostics'])})
    return result


def prepare(payload):
    source = Path(payload['path'])
    target = Path(payload['workspace'])
    if not source.is_absolute() or not target.is_absolute():
        raise ValueError('path and workspace must be absolute paths')
    source = source.resolve(strict=True)
    if not source.is_file() or source.suffix.lower() not in ('.apk', '.xapk', '.apkm'):
        raise ValueError('Supply a regular .apk, .xapk or .apkm file')
    target = target.resolve()
    if source.is_relative_to(target):
        raise ValueError('Keep the supplied package outside its generated workspace')
    digest = sha256(source)
    options = {
        'decompile_java': payload.get('decompile_java', True),
        'decode_smali': payload.get('decode_smali', True),
        'threads': bounded_int(payload.get('threads', 2), 1, 4, 'threads'),
        'engine_timeout_seconds': bounded_int(payload.get('engine_timeout_seconds', 1800), 30, 7200, 'engine_timeout_seconds'),
    }
    for key in ('decompile_java', 'decode_smali'):
        if not isinstance(options[key], bool):
            raise ValueError(f'{key} must be boolean')
    for key in ('retry_failed', 'reindex'):
        if not isinstance(payload.get(key, False), bool):
            raise ValueError(f'{key} must be boolean')
    if target.exists():
        root, metadata = workspace(str(target))
        if metadata['source']['sha256'] != digest:
            raise ValueError('Workspace belongs to a different package digest; choose a new output directory')
        if metadata['options'] != options:
            raise ValueError('Workspace options differ; reuse its recorded options or choose a new directory')
    else:
        target.mkdir(parents=True, exist_ok=False)
        metadata = {'schema': SCHEMA, 'producer': 'rea-deep', 'plugin_version': '1.1.0',
                    'source': {'path': str(source), 'sha256': digest, 'bytes': source.stat().st_size},
                    'options': options, 'created_at': time.time(), 'artifacts': []}
        atomic_json(target / 'workspace.json', metadata)
        root = target
    lock_path = root / '.worker.lock'
    if lock_path.exists():
        lock = read_json(lock_path)
        # Queued process registration gets a brief lease; another caller cannot steal it.
        leased = not lock.get('pid') and time.time() - lock.get('created_at', 0) < 15
        if leased or worker_alive(root, lock):
            return {**status({'workspace': str(root)}), 'reused_running_job': True}
        lock_path.unlink()
    previous = read_json(root / 'state.json') if (root / 'state.json').exists() else {'steps': {}}
    if (previous.get('status') == 'completed' and not payload.get('reindex') and not payload.get('retry_failed')):
        return {**status({'workspace': str(root)}), 'reused_completed_job': True}
    job_id = uuid.uuid4().hex
    lock = {'job_id': job_id, 'created_at': time.time(), 'pid': None}
    with lock_path.open('x', encoding='utf-8') as stream:
        json.dump(lock, stream)
    request = {'job_id': job_id, 'status': 'queued', 'started_at': time.time(),
               'steps': previous.get('steps', {}), 'retry_failed': payload.get('retry_failed', False),
               'reindex': payload.get('reindex', False), 'phase': 'queued', 'worker_pid': None}
    atomic_json(root / 'state.json', request)
    logs = root / 'logs'
    logs.mkdir(exist_ok=True)
    try:
        with (logs / (job_id + '-worker.log')).open('ab') as log:
            worker = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', str(root), job_id],
                                      stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                      start_new_session=True, close_fds=True)
        lock['pid'] = worker.pid
        atomic_json(lock_path, lock)
    except BaseException:
        lock_path.unlink(missing_ok=True)
        request['status'] = 'failed'
        atomic_json(root / 'state.json', request)
        raise
    return {'workspace': str(root), 'job_id': job_id, 'worker_pid': worker.pid,
            'status': 'queued', 'next': 'status', 'source': metadata['source'],
            'note': 'Owned background analysis continues after this tool returns; cancel explicitly to stop it'}


def cancel(payload):
    root, _ = workspace(payload['workspace'])
    lock_path = root / '.worker.lock'
    if not lock_path.exists():
        return {**status(payload), 'cancel_requested': False}
    lock = read_json(lock_path)
    if not worker_alive(root, lock):
        return {**status(payload), 'cancel_requested': False}
    os.killpg(lock['pid'], signal.SIGTERM)
    return {'workspace': str(root), 'job_id': lock['job_id'], 'cancel_requested': True,
            'note': 'SIGTERM sent only to the bound workspace worker process group; read status for final state'}


def safe_extract(path, destination):
    destination.mkdir(parents=True, exist_ok=False)
    members = []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 200000 or sum(member.file_size for member in entries) > 32 * 1024 ** 3:
            raise ValueError('Archive exceeds member-count or 32 GiB extraction budget')
        seen = set()
        for member in entries:
            name = member.filename
            relative = PurePosixPath(name)
            if ('\\' in name or relative.is_absolute() or '..' in relative.parts
                    or not relative.parts or ':' in relative.parts[0]):
                raise ValueError('Unsafe archive member: ' + name)
            if stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError('Archive symlinks are not extracted')
            output = destination.joinpath(*relative.parts)
            # Case-insensitive filesystems may alias different archive members.
            normalized = os.path.normcase(str(output))
            if normalized in seen:
                raise ValueError('Duplicate/case-colliding archive member: ' + name)
            seen.add(normalized)
            if member.is_dir():
                output.mkdir(parents=True, exist_ok=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as stream, output.open('xb') as target:
                shutil.copyfileobj(stream, target)
            members.append({'name': name, 'bytes': member.file_size, 'sha256': sha256(output)})
    return members


class Worker:
    def __init__(self, root, job_id):
        self.root, self.metadata = workspace(root)
        self.state = read_json(self.root / 'state.json')
        if self.state.get('job_id') != job_id:
            raise ValueError('Job identity changed')
        self.job_id = job_id
        self.child = None
        self.active_step = None

    def update(self, phase, details=None):
        self.state.update({'phase': phase, 'heartbeat_at': time.time(), 'worker_pid': os.getpid()})
        if details is not None:
            self.state['progress'] = details
        atomic_json(self.root / 'state.json', self.state)

    def run_command(self, step, argv, timeout):
        log_path = self.root / 'logs' / (self.job_id + '-' + step.replace('/', '-') + '.log')
        self.state['steps'][step]['command'] = argv
        self.state['steps'][step]['log'] = log_path.relative_to(self.root).as_posix()
        self.update(step)
        started = time.monotonic()
        code, timed_out = None, False
        with log_path.open('wb') as log:
            self.child = subprocess.Popen(argv, stdout=log, stderr=log, stdin=subprocess.DEVNULL)
            try:
                while code is None:
                    try:
                        code = self.child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        elapsed = time.monotonic() - started
                        self.update(step, {'elapsed_seconds': round(elapsed), 'log_bytes': log_path.stat().st_size})
                        if elapsed > timeout:
                            timed_out = True
                            self.child.terminate()
                            try:
                                code = self.child.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                self.child.kill()
                                code = self.child.wait()
            finally:
                if self.child.poll() is None:
                    self.child.terminate()
                    try:
                        self.child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.child.kill()
                        self.child.wait()
                self.child = None
        return {'exit_code': code, 'timed_out': timed_out, 'log': str(log_path),
                'elapsed_seconds': round(time.monotonic() - started)}

    def step(self, name, function, force=False):
        previous = self.state['steps'].get(name, {})
        if not force and (previous.get('status') == 'completed' or
                          (previous.get('status') in ('partial', 'skipped', 'failed') and not self.state['retry_failed'])):
            return previous.get('result')
        self.active_step = name
        self.state['steps'][name] = {'status': 'running', 'started_at': time.time()}
        self.update(name)
        try:
            result = function()
            status_value = result.pop('_status', 'completed')
            self.state['steps'][name].update({'status': status_value, 'result': result, 'finished_at': time.time()})
        except InterruptedError:
            self.state['steps'][name].update({'status': 'cancelled', 'finished_at': time.time()})
            raise
        except Exception as error:
            self.state['steps'][name].update({'status': 'failed', 'error': str(error), 'finished_at': time.time()})
            result = None
        self.active_step = None
        self.update(name)
        return result

    def replace_output(self, temporary, destination):
        if destination.exists():
            history = self.root / 'history' / self.job_id
            history.mkdir(parents=True, exist_ok=True)
            destination.rename(history / (destination.parent.name + '-' + destination.name))
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary.rename(destination)

    def extract(self):
        source = Path(self.metadata['source']['path'])
        if sha256(source) != self.metadata['source']['sha256']:
            raise ValueError('Supplied package changed after the job was queued')
        scratch = self.root / ('extract-' + self.job_id)
        scratch.mkdir(exist_ok=False)
        try:
            if source.suffix.lower() == '.apk':
                packages = [source]
            else:
                safe_extract(source, scratch / 'carrier')
                packages = sorted((scratch / 'carrier').rglob('*.apk'))
                if not packages:
                    raise ValueError('Container has no APK members')
            artifacts, archive_members = [], {}
            (scratch / 'inputs').mkdir()
            (scratch / 'raw').mkdir()
            for index, path in enumerate(packages):
                digest = sha256(path)
                label = re.sub(r'[^a-zA-Z0-9_.-]', '_', path.stem)[:80]
                identity = f'{index:03d}-{label}-{digest[:12]}'
                copied = scratch / 'inputs' / (identity + '.apk')
                shutil.copyfile(path, copied)
                if sha256(copied) != digest:
                    raise ValueError('APK changed while copying')
                members = safe_extract(copied, scratch / 'raw' / identity)
                archive_members[identity] = members
                artifacts.append({'id': identity, 'input': 'inputs/' + copied.name,
                                  'member': str(path.relative_to(scratch / 'carrier')) if source.suffix.lower() != '.apk' else source.name,
                                  'sha256': digest, 'bytes': copied.stat().st_size,
                                  'dex_files': [x['name'] for x in members if re.fullmatch(r'classes\d*\.dex', x['name'])]})
            self.replace_output(scratch / 'inputs', self.root / 'inputs')
            self.replace_output(scratch / 'raw', self.root / 'raw')
            self.metadata['artifacts'] = artifacts
            atomic_json(self.root / 'workspace.json', self.metadata)
            atomic_json(self.root / 'archive-members.json', archive_members)
            return {'artifacts': artifacts, 'member_index': 'archive-members.json'}
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    def sign(self, artifact):
        engine = apksigner()
        if not engine:
            return {'_status': 'skipped', 'reason': 'apksigner unavailable; install Android SDK build-tools or set REA_APKSIGNER_COMMAND'}
        result = self.run_command('signature-' + artifact['id'],
                                  [engine, 'verify', '--verbose', '--print-certs', str(self.root / artifact['input'])], 120)
        if result['exit_code'] != 0:
            result['_status'] = 'failed'
            result['reason'] = 'APK signature verification did not succeed; do not describe this artifact as verified'
        return result

    def decode(self, artifact):
        engine = command('apktool', 'REA_APKTOOL_COMMAND')
        temporary = self.root / ('decode-' + self.job_id + '-' + artifact['id'])
        argv = [engine, 'd', '-f', str(self.root / artifact['input']), '-o', str(temporary)]
        if not self.metadata['options']['decode_smali']:
            argv.append('--no-src')
        result = self.run_command('decode-' + artifact['id'], argv, self.metadata['options']['engine_timeout_seconds'])
        if temporary.exists():
            self.replace_output(temporary, self.root / 'decoded' / artifact['id'])
        if result['exit_code'] != 0:
            result['_status'] = 'partial'
            result['reason'] = 'Apktool did not finish successfully; retained files may be incomplete'
        return result

    def java(self, artifact):
        if not self.metadata['options']['decompile_java'] or not artifact['dex_files']:
            return {'_status': 'skipped', 'reason': 'No DEX in this split, or Java decompilation disabled by caller'}
        engine = command('jadx', 'REA_JADX_COMMAND')
        temporary = self.root / ('java-' + self.job_id + '-' + artifact['id'])
        argv = [engine, '--no-res', '--no-imports', '--no-inline-methods', '--no-inline-anonymous',
                '--no-move-inner-classes', '--show-bad-code', '--log-level', 'warn',
                '-j', str(self.metadata['options']['threads']), '-ds', str(temporary),
                str(self.root / artifact['input'])]
        result = self.run_command('java-' + artifact['id'], argv, self.metadata['options']['engine_timeout_seconds'])
        if temporary.exists():
            self.replace_output(temporary, self.root / 'java' / artifact['id'])
        if result['exit_code'] != 0:
            result['_status'] = 'partial'
            result['reason'] = 'JADX reported errors or timed out; retained Java must be checked against Smali'
        return result

    def run(self):
        self.state['status'] = 'running'
        self.update('starting')
        if not self.step('extract', self.extract):
            raise ValueError('Package extraction did not complete; see state.json/logs')
        self.metadata = read_json(self.root / 'workspace.json')
        for artifact in self.metadata['artifacts']:
            if sha256(self.root / artifact['input']) != artifact['sha256']:
                raise ValueError('Retained APK digest changed; choose a fresh workspace')
            self.step('signature-' + artifact['id'], lambda a=artifact: self.sign(a))
            self.step('decode-' + artifact['id'], lambda a=artifact: self.decode(a))
            self.step('java-' + artifact['id'], lambda a=artifact: self.java(a))
        summary = self.step('index', lambda: build_index(self.root, self.metadata['artifacts'], self.update),
                            force=self.state['reindex'] or self.state['retry_failed'])
        if not summary:
            raise ValueError('Index did not complete; see state.json/logs')
        bad = [key for key, value in self.state['steps'].items() if value['status'] in ('failed', 'partial', 'cancelled')]
        # Missing engines and deliberately skipped stages are separate, explicit coverage gaps.
        unavailable = [key for key, value in self.state['steps'].items()
                       if value['status'] == 'skipped' and key.startswith('signature-')]
        self.state.update({'status': 'partial' if bad or unavailable else 'completed', 'incomplete_steps': bad,
                           'unavailable_steps': unavailable,
                           'finished_at': time.time(), 'phase': 'finished'})
        self.update('finished', {'counts': summary['counts']})


def worker_main(root, job_id):
    worker = Worker(root, job_id)
    def interrupted(signum, frame):
        raise InterruptedError('Workspace analysis cancelled')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        with (worker.root / '.query.lock').open('a+') as query_lock:
            fcntl.flock(query_lock.fileno(), fcntl.LOCK_EX)
            worker.run()
    except BaseException as error:
        worker.state.update({'status': 'cancelled' if isinstance(error, InterruptedError) else 'failed',
                             'error': str(error), 'finished_at': time.time()})
        worker.update('stopped')
    finally:
        lock_path = worker.root / '.worker.lock'
        if lock_path.exists() and read_json(lock_path).get('job_id') == job_id:
            lock_path.unlink()
        atomic_json(worker.root / 'jobs' / (job_id + '.json'), worker.state)


def main():
    if sys.version_info < (3, 9):
        raise ValueError('REA Deep requires Python 3.9 or newer; set REA_PYTHON_COMMAND')
    if len(sys.argv) >= 2 and sys.argv[1] == '_worker':
        worker_main(sys.argv[2], sys.argv[3])
        return
    action = sys.argv[1]
    payload = json.load(sys.stdin)
    if action == 'prepare':
        result = prepare(payload)
    elif action == 'status':
        result = status(payload)
    elif action == 'cancel':
        result = cancel(payload)
    else:
        from android_query import dispatch
        result = dispatch(action, payload)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        json.dump({'error': type(error).__name__, 'message': str(error)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write('\n')
        sys.exit(1)
