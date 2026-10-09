from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = REPO_ROOT / ".github/workflows/publish-plugin-content.yml"
SECRET = "ECHO_PLUGIN_SIGNING_PRIVATE_KEY"
SIGNING_STEPS = {
    "Validate protected release identity",
    "Materialize and cross-check public trust key",
    "Build and sign marketplace catalog indexes",
    "Build signed plugin content pack",
    "Sign final skill catalog with independent package hashes",
}


def _job() -> dict:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return workflow["jobs"]["publish"]


def test_signing_key_is_not_job_wide() -> None:
    # Dependency installs and the frontend build run third-party code; a
    # job-wide secret would be readable by every postinstall script.
    assert SECRET not in (_job().get("env") or {})


def test_only_signing_steps_receive_the_private_key() -> None:
    holders = {step.get("name") for step in _job()["steps"] if SECRET in (step.get("env") or {})}
    assert holders == SIGNING_STEPS
