"""Windows resolve() can retain the extended prefix during directory creation."""

import os
from pathlib import Path

import pytest

from runtime.platform.process.scope import ExecutionScope, WriteScope


@pytest.mark.skipif(os.name != "nt", reason="Windows extended path aliases")
@pytest.mark.parametrize("unc", [False, True], ids=["drive", "unc"])
@pytest.mark.parametrize("extended_root", [False, True], ids=["extended-target", "extended-root"])
def test_scope_accepts_extended_aliases_without_accepting_siblings(
    tmp_path, monkeypatch, unc, extended_root
):
    root = Path(r"\\server\share\approved") if unc else tmp_path / "approved"
    target = root / ".execution" / "isolated"
    outside = root.parent / "approved-other" / "secret"
    original_resolve = Path.resolve

    def resolve(path, *args, **kwargs):
        if path not in {root, target, outside}:
            return original_resolve(path, *args, **kwargs)
        if (path == root) == extended_root:
            text = str(path)
            return Path("\\\\?\\UNC\\" + text[2:] if unc else "\\\\?\\" + text)
        return path

    # Force the inconsistent result caught under concurrent mkdir, without
    # depending on timing or contacting the synthetic UNC server.
    monkeypatch.setattr(Path, "resolve", resolve)
    writes = WriteScope("code", (root,))
    execution = ExecutionScope("code", "code", (root,), (root,))
    assert writes.allows(target)
    assert execution.allows_read(target)
    assert execution.allows_write(target)
    assert not writes.allows(outside)
    assert not execution.allows_read(outside)
    assert not execution.allows_write(outside)
