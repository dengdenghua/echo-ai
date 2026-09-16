"""Windows command strings must execute code, not silently evaluate a quoted string."""

import json
import subprocess
import sys

import pytest

from runtime.execution.suckers._write_skills_common import _parse_command
from runtime.execution.suckers._write_skills_exec import _exec_shell

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows argument parsing")


@pytest.mark.parametrize(
    "args",
    [
        [r"C:\Program Files\Python\python.exe", "-c", "print('hello')"],
        ["python", "-c", 'print("hello")', "", "two words"],
        ["tool", "C:\\folder with spaces\\", 'literal"quote', "中文", "a&b"],
    ],
)
def test_windows_command_round_trips_arguments(args):
    parsed, error = _parse_command(subprocess.list2cmdline(args))
    assert error is None
    assert parsed == args


def test_python_inline_script_produces_output_and_expected_file(tmp_path):
    target = tmp_path / "file with spaces.txt"
    code = (
        "from pathlib import Path; import sys; "
        "Path(sys.argv[1]).write_text('executed', encoding='utf-8'); "
        "print('EXECUTED')"
    )
    result = _exec_shell(command=subprocess.list2cmdline([sys.executable, "-c", code, str(target)]))
    assert result.get("exit_code") == 0, result
    assert result["stdout"].strip() == "EXECUTED"
    assert target.read_text(encoding="utf-8") == "executed"


def test_string_and_argv_preserve_identical_literal_arguments():
    args = [
        sys.executable,
        "-c",
        "import json,sys; print(json.dumps(sys.argv[1:]))",
        "",
        'a"b',
        r"C:\with space\end",
        "$HOME",
    ]
    for command in [args, subprocess.list2cmdline(args)]:
        result = _exec_shell(command=command)
        assert result.get("exit_code") == 0, result
        assert json.loads(result["stdout"]) == args[3:]
