"""The avatar image command template must never route user text via a shell.

The old implementation substituted ``shlex.quote``-d values into
``--prompt "$prompt"`` and ran it with ``shell=True``: inside the template's
double quotes ``$(...)`` and backticks still expanded, and on Windows
``cmd.exe`` ignores POSIX quoting entirely. The template is now split into
argv first and placeholders are substituted per element (``shell=False``).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from runtime.execution.misc import image_generation as ig

_HOSTILE_PROMPTS = [
    "cat $(touch pwned_subshell) done",
    "cat `touch pwned_backtick` done",
    'cat "&calc&" done',
    "cat; touch pwned_semicolon | echo & echo %PATH% ^ !x! > redirect.txt",
    "it's a \"quoted\" 'mix' \\ with ${output} and $prompt",
]

_RECORDER = r"""
import json, sys
from pathlib import Path
args = sys.argv[1:]
prompt = args[args.index("--prompt") + 1]
output = Path(args[args.index("--output") + 1])
output.write_bytes(b"PNG")
(output.parent / "argv.json").write_text(json.dumps({"prompt": prompt}), encoding="utf-8")
"""


def _recorder_template(tmp_path: Path) -> str:
    script = tmp_path / "recorder.py"
    script.write_text(_RECORDER, encoding="utf-8")
    # Same shape as the built-in opencli template: quoted placeholders.
    return f'"{sys.executable}" "{script}" --prompt "$prompt" --output "$output"'


@pytest.mark.parametrize("hostile", _HOSTILE_PROMPTS)
def test_command_template_passes_hostile_prompt_literally(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, hostile: str
) -> None:
    monkeypatch.setenv("ECHO_IMAGE_GEN_COMMAND", _recorder_template(tmp_path))
    monkeypatch.setattr(ig, "build_agent_visual_prompt", lambda **_k: hostile)
    out_dir = tmp_path / "out"

    result = ig.generate_agent_visuals(
        agent_id="a1",
        display_name="A",
        description="",
        output_dir=out_dir,
        provider="custom-command",
    )

    recorded = json.loads((out_dir / "argv.json").read_text(encoding="utf-8"))
    assert recorded["prompt"] == hostile
    assert result.files["front"] == out_dir / "reference.png"
    for marker in ("pwned_subshell", "pwned_backtick", "pwned_semicolon", "redirect.txt"):
        assert not (out_dir / marker).exists()
        assert not (tmp_path / marker).exists()


def test_command_template_runs_without_shell(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    def _fake_run(argv: Any, **kwargs: Any) -> subprocess.CompletedProcess:
        captured["argv"] = argv
        captured.update(kwargs)
        (tmp_path / "reference.png").write_bytes(b"PNG")
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(ig.subprocess, "run", _fake_run)
    monkeypatch.setattr(ig.shutil, "which", lambda name: None)
    monkeypatch.setenv(
        "ECHO_IMAGE_GEN_COMMAND", 'gen --prompt "$prompt" --id ${agent_id} --out "$output"'
    )
    ig._generate_with_command(
        provider="custom-command",
        prompt="x $(id) `id`",
        agent_id="agent; rm -rf ~",
        display_name="A",
        output_dir=tmp_path,
    )
    assert captured["shell"] is False
    assert captured["argv"] == [
        "gen",
        "--prompt",
        "x $(id) `id`",
        "--id",
        "agent; rm -rf ~",
        "--out",
        str(tmp_path / "reference.png"),
    ]
    assert captured["env"]["ECHO_IMAGE_GEN_PROMPT"] == "x $(id) `id`"


def test_windows_batch_wrapper_refuses_cmd_metacharacters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ig.os, "name", "nt")
    monkeypatch.setattr(ig.shutil, "which", lambda name: r"C:\tools\gen.cmd")
    with pytest.raises(RuntimeError, match="cmd.exe metacharacters"):
        ig._command_template_argv(
            'gen --prompt "$prompt"',
            {"prompt": 'a "&calc&" b', "agent_id": "a", "display_name": "A"},
        )
    # Clean text is still allowed through a batch wrapper.
    argv = ig._command_template_argv(
        'gen --prompt "$prompt"',
        {"prompt": "a calm cat", "agent_id": "a", "display_name": "A"},
    )
    assert argv == [r"C:\tools\gen.cmd", "--prompt", "a calm cat"]
