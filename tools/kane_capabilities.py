"""Install versioned Kane skill packs without replacing personal role files.

Run with the backend Python environment. Preview is the default; --apply writes.
Stop the target agent before applying. No credentials or cloud grants are copied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporary.replace(path)


def merge_block(old, rules):
    start, end = '<!-- kane-capabilities:start -->', '<!-- kane-capabilities:end -->'
    block = start + '\n' + rules.strip() + '\n' + end
    if start in old:
        if old.count(start) != 1 or old.count(end) != 1 or old.index(end) < old.index(start):
            raise ValueError('Malformed managed rules block; preserve file and resolve manually')
        return old[:old.index(start)] + block + old[old.index(end) + len(end):]
    return old.rstrip() + '\n\n' + block + '\n'


def plan_role(agent, bundle):
    from runtime.execution.agents.loader import _parse_jsonc
    core = agent / 'agent-core'
    profile_path = agent / 'profile.jsonc'
    registry_path = core / 'tool-registry.jsonc'
    profile = _parse_jsonc(profile_path.read_text(encoding='utf8'))
    registry = _parse_jsonc(registry_path.read_text(encoding='utf8'))
    # Existing identity, model selection, permissions and memory stay authoritative.
    registry['private_skills'] = list(dict.fromkeys([
        *registry.get('private_skills', []), *bundle['actions']]))
    profile.setdefault('systemPrompt', {})['includeAgentsMd'] = True
    rules_path = core / 'AGENTS.md'
    original = rules_path.read_text(encoding='utf8') if rules_path.exists() else ''
    values = {
        profile_path: json.dumps(profile, ensure_ascii=False, indent=2) + '\n',
        registry_path: json.dumps(registry, ensure_ascii=False, indent=2) + '\n',
        rules_path: merge_block(original, bundle['rules']),
    }
    return {p: value for p, value in values.items()
            if not p.exists() or p.read_text(encoding='utf8') != value}


def verify_bundle(bundle_root):
    manifest = json.loads((bundle_root / 'bundle.json').read_text(encoding='utf8'))
    for relative, expected in manifest['files'].items():
        path = bundle_root / relative
        if path.is_symlink() or not path.resolve().is_relative_to(bundle_root.resolve()):
            raise ValueError('Bundle path escapes root')
        if digest(path) != expected:
            raise ValueError(f'Bundle checksum mismatch: {relative}')
    return manifest


def install(bundle_root, agent, plugin_root, state_root, apply=False):
    from runtime.platform.plugins.codex_discovery import discover_codex_plugins
    from runtime.platform.plugins.plugin_lifecycle import install_local_plugin
    bundle = verify_bundle(bundle_root)
    changes = plan_role(agent, bundle)
    # Prior managed files may have been edited by their owner. Do not silently
    # replace even an edit inside our own block; surface it as a merge conflict.
    for journal in sorted(state_root.glob('*/transaction.json'), reverse=True):
        previous = json.loads(journal.read_text(encoding='utf8'))
        if previous.get('status') != 'committed' or previous.get('role') != str(agent):
            continue
        for entry in previous['files']:
            path = Path(entry['path'])
            if path in changes and (not path.exists() or digest(path) != entry['after']):
                raise ValueError(f'User edit conflict; preserved without modification: {path}')
        break
    candidates = {p['id']: p for p in discover_codex_plugins([bundle_root / 'plugins'])}
    installed = {p['id']: p for p in discover_codex_plugins([plugin_root])}
    pending = []
    for name in bundle['plugins']:
        item = candidates[name]
        if not item['smoke']['ok']:
            raise ValueError(f'Plugin validation failed: {name}')
        old = installed.get(name)
        if old and old['version'] == item['version']:
            if old['smoke']['content_provenance']['digest'] != item['smoke']['content_provenance']['digest']:
                raise ValueError(f'Locally modified plugin requires explicit reconciliation: {name}')
        else:
            pending.append(name)
    report = {'version': bundle['version'], 'platform': platform.system(),
              'role': str(agent), 'plugin_root': str(plugin_root),
              'changed_files': [str(p) for p in changes], 'plugins': pending,
              'status': 'preview', 'transactions': [], 'files': []}
    availability = json.loads((bundle_root / 'availability.json').read_text(encoding='utf8'))
    report['native_availability'] = {
        name: (entry['status'] if platform.system() in entry['native_platforms'] else 'unsupported_native_platform')
        for name, entry in availability.items()
    }
    if not apply or (not changes and not pending):
        report['status'] = 'preview' if not apply else 'unchanged'
        return report
    # Refuse linked target paths before any plugin or role writes.
    for path in [agent, plugin_root, state_root, *changes]:
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('Refusing linked installation target')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    transaction = state_root / stamp
    transaction.mkdir(parents=True, exist_ok=False)
    journal = transaction / 'transaction.json'
    report['status'] = 'applying'
    write_json(journal, report)
    try:
        for name in pending:
            result = install_local_plugin(bundle_root / 'plugins' / name,
                                          plugin_root=plugin_root, confirm_install=True)
            report['transactions'].append(result['transaction_id'])
            write_json(journal, report)
        for index, (path, value) in enumerate(changes.items()):
            backup = transaction / f'{index}.before'
            existed = path.exists()
            if existed:
                backup.write_bytes(path.read_bytes())
            record = {'path': str(path.resolve()), 'backup': str(backup.resolve()) if existed else None,
                      'after': hashlib.sha256(value.encode('utf8')).hexdigest()}
            report['files'].append(record)
            write_json(journal, report)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + '.kane-tmp')
            temporary.write_text(value, encoding='utf8', newline='')
            temporary.replace(path)
        report['status'] = 'committed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        from runtime.platform.plugins.plugin_lifecycle import rollback_plugin_transaction
        recovery_errors = []
        for item in reversed(report['files']):
            try:
                path = Path(item['path'])
                if item['backup']:
                    path.write_bytes(Path(item['backup']).read_bytes())
                elif path.exists():
                    path.unlink()
            except OSError as recovery:
                recovery_errors.append(str(recovery))
        for tid in reversed(report['transactions']):
            try:
                rollback_plugin_transaction(tid, plugin_root=plugin_root, confirm_rollback=True)
            except Exception as recovery:
                recovery_errors.append(str(recovery))
        report['status'] = 'failed_rolled_back' if not recovery_errors else 'recovery_required'
        report['recovery_errors'] = recovery_errors
        raise
    finally:
        write_json(journal, report)
    report['journal'] = str(journal)
    return report


def rollback(journal):
    from runtime.platform.plugins.plugin_lifecycle import rollback_plugin_transaction
    record = json.loads(journal.read_text(encoding='utf8'))
    if record['status'] != 'committed':
        raise ValueError('Only committed migrations can be rolled back automatically')
    for item in record['files']:
        if digest(Path(item['path'])) != item['after']:
            raise ValueError('Role changed after installation; refusing destructive rollback')
    for transaction in reversed(record['transactions']):
        rollback_plugin_transaction(transaction, plugin_root=record['plugin_root'], confirm_rollback=True)
    for item in record['files']:
        path = Path(item['path'])
        if item['backup']:
            path.write_bytes(Path(item['backup']).read_bytes())
        else:
            path.unlink()
    record['status'] = 'rolled_back'
    write_json(journal, record)
    return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--bundle', type=Path, default=ROOT / 'resources/kane-capabilities')
    p.add_argument('--agent', type=Path)
    p.add_argument('--plugin-root', type=Path)
    p.add_argument('--state-root', type=Path)
    p.add_argument('--rollback', type=Path)
    p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    if args.rollback:
        if not args.apply:
            p.error('--rollback requires --apply')
        result = rollback(args.rollback)
    else:
        if not all([args.agent, args.plugin_root, args.state_root]):
            p.error('--agent, --plugin-root and --state-root are required')
        result = install(args.bundle.resolve(), args.agent.resolve(), args.plugin_root.resolve(),
                         args.state_root.resolve(), args.apply)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
