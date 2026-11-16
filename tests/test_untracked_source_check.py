"""The source guard must cover desktop main-process and browser regression files."""

import subprocess

from tools.lint import untracked_source_check as check


def test_untracked_desktop_sources_fail_until_added(tmp_path, monkeypatch, capsys):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    paths = ["frontend/electron/backend.cjs", "frontend/e2e/startup.spec.ts"]
    for name in paths:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("// regression fixture\n", encoding="utf-8")
    monkeypatch.setattr(check, "REPO_ROOT", tmp_path)
    assert check.main([]) == 1
    output = capsys.readouterr().err
    assert all(name in output for name in paths)
    subprocess.run(["git", "-C", str(tmp_path), "add", "--", *paths], check=True)
    assert check.main([]) == 0
