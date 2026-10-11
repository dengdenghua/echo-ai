from __future__ import annotations

import json
from pathlib import Path

from runtime.safety.evolution import policy_review_rules
from runtime.safety.evolution.permission_sandbox_quality import (
    _plugin_policy_coverage as actual_plugin_coverage,
)


def _package(root: Path, server: str) -> Path:
    package = root / "inspector"
    manifest = package / ".codex-plugin" / "plugin.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        json.dumps(
            {
                "name": "inspector",
                "version": "1.0.0",
                "mcpServers": {server: {"command": "must-not-execute"}},
            }
        ),
        encoding="utf-8",
    )
    return package


def test_shipped_package_has_verified_deny_drafts_without_installing(tmp_path: Path) -> None:
    _package(tmp_path / "extensions" / "codex-plugins", "bundled_server")

    report = actual_plugin_coverage(tmp_path)

    assert report["ready"] is True
    assert report["sources"] == {"bundled": 1, "repository_installed": 0}
    assert report["verified"] == report["total"] == 2
    assert not (tmp_path / ".echo").exists()


def test_installed_replacement_is_checked_instead_of_shipped_copy(tmp_path: Path) -> None:
    _package(tmp_path / "extensions" / "codex-plugins", "bundled_server")
    _package(tmp_path / ".echo" / "plugins" / "codex", "installed_server")

    report = actual_plugin_coverage(tmp_path)

    assert report["ready"] is True
    assert report["plugin_count"] == 1
    assert report["sources"] == {"bundled": 0, "repository_installed": 1}


def test_corrupted_shipped_draft_fails_signature_coverage(tmp_path: Path, monkeypatch) -> None:
    _package(tmp_path / "extensions" / "codex-plugins", "bundled_server")
    build = policy_review_rules.build_plugin_permission_rule_drafts

    def corrupt(**kwargs):
        report = build(**kwargs)
        report["drafts"][0]["signed_payload"]["rule"]["effect"] = "allow"
        return report

    monkeypatch.setattr(policy_review_rules, "build_plugin_permission_rule_drafts", corrupt)

    report = actual_plugin_coverage(tmp_path)

    assert report["ready"] is False
    assert report["verified"] == 1 and report["total"] == 2


def test_missing_packages_do_not_create_permission_evidence(tmp_path: Path) -> None:
    report = actual_plugin_coverage(tmp_path)

    assert report["ready"] is False
    assert report["plugin_count"] == report["verified"] == report["total"] == 0
