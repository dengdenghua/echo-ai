"""Publication survives temporary Windows file leases without losing rollback."""
import json

import pytest

from runtime.execution.engine_packages import versions
from runtime.execution.engine_packages.lock import platform_key
from runtime.execution.engine_packages.store import MANIFEST_SCHEMA, read_installed


def release(root, version):
    folder = root / ('stage-' + version)
    folder.mkdir()
    (folder / 'engine').write_text(version)
    (folder / 'echo-engine.json').write_text(json.dumps({
        'schema': MANIFEST_SCHEMA, 'engine': 'codex', 'version': version,
        'platform': platform_key(), 'entrypoint': 'engine',
        'files': {'engine': {'size': len(version)}},
    }))
    return folder


def winerror(number):
    error = PermissionError('simulated Windows file lease')
    error.winerror = number
    return error


@pytest.mark.parametrize('number', [5, 32, 33])
@pytest.mark.parametrize('target_kind', ['release', 'state'])
def test_transient_lease_recovers_and_preserves_rollback(tmp_path, monkeypatch, number, target_kind):
    versions.publish(tmp_path, 'codex', release(tmp_path, '1'))
    staged = release(tmp_path, '2')
    replace = versions.os.replace
    failures = []

    def briefly_locked(source, target):
        affected = source == staged if target_kind == 'release' else target.name == 'state.json'
        if affected and len(failures) < 2:
            failures.append(number)
            raise winerror(number)
        return replace(source, target)

    monkeypatch.setattr(versions.os, 'replace', briefly_locked)
    monkeypatch.setattr(versions.time, 'sleep', lambda _: None)
    versions.publish(tmp_path, 'codex', staged)
    assert len(failures) == 2
    assert read_installed('codex', tmp_path).version == '2'
    versions.rollback(tmp_path, 'codex')
    assert read_installed('codex', tmp_path).version == '1'


def test_persistent_denial_times_out_without_replacing_active(tmp_path, monkeypatch):
    versions.publish(tmp_path, 'codex', release(tmp_path, '1'))
    staged = release(tmp_path, '2')
    replace = versions.os.replace
    now = [0.0]
    calls = []

    def denied(source, target):
        if source == staged:
            calls.append(1)
            raise winerror(5)
        return replace(source, target)

    monkeypatch.setattr(versions.os, 'replace', denied)
    monkeypatch.setattr(versions.time, 'monotonic', lambda: now[0])
    monkeypatch.setattr(versions.time, 'sleep', lambda seconds: now.__setitem__(0, now[0] + seconds))
    with pytest.raises(PermissionError):
        versions.publish(tmp_path, 'codex', staged)
    assert 1 < len(calls) < 30
    assert now[0] == pytest.approx(5.0)
    assert staged.is_dir()
    assert read_installed('codex', tmp_path).version == '1'
    assert not versions.snapshot(tmp_path, 'codex').get('pending')


def test_unrelated_failure_is_not_retried(tmp_path, monkeypatch):
    sleeps = []

    def disk_failure(source, target):
        raise OSError('disk failure')

    monkeypatch.setattr(versions.os, 'replace', disk_failure)
    monkeypatch.setattr(versions.time, 'sleep', sleeps.append)
    with pytest.raises(OSError, match='disk failure'):
        versions._replace_with_retry(tmp_path / 'a', tmp_path / 'b')
    assert sleeps == []
