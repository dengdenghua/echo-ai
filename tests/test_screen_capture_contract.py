"""Regression for the OS conversation's omitted path / string-region capture call."""

import pytest

from runtime.execution.suckers import computer_skills
from runtime.execution.tool_spec_builder import _input_schema_from_handler


def test_capture_schema_requires_output_path_and_array_region():
    schema = _input_schema_from_handler(computer_skills._screen_capture)[0]
    assert "path" in schema["required"]
    assert schema["properties"]["path"]["type"] == "string"
    assert schema["properties"]["region"]["type"] == "array"
    assert "region" not in schema["required"]
    assert "sandbox_dir" not in schema["properties"]


def test_omitted_path_cannot_enter_capture_handler(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("capture backend must not run without an output path")

    monkeypatch.setattr(computer_skills, "_check_pyautogui", unexpected)
    with pytest.raises(TypeError, match="path"):
        computer_skills._screen_capture(region=[240, 309, 1428, 640])


def test_string_region_is_rejected_before_capture(monkeypatch, tmp_path):
    def unexpected(*args, **kwargs):
        pytest.fail("capture backend must not run for an invalid region")

    monkeypatch.setattr(computer_skills, "_check_pyautogui", unexpected)
    target = tmp_path / "capture.png"
    result = computer_skills._screen_capture(
        path=str(target), sandbox_dir=str(tmp_path), region="[240,309,1428,640]"
    )
    assert "region" in result["error"]
    assert not target.exists()
