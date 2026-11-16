"""Run the model-facing example against actual code-mode return shapes."""

import json
import shutil
import subprocess
from types import SimpleNamespace

import pytest

from runtime.execution.codex_backend.result_emission import (
    DYNAMIC_RESULT_CONTRACT,
    EMIT_ECHO_RESULT_JS,
)
from runtime.execution.codex_backend.role_context import compose_codex_role_instructions

URL = "data:image/png;base64,aGVsbG8="
META = {"path": "截图.png", "size_bytes": 5, "region": [1, 2, 3, 4]}


@pytest.mark.parametrize(
    "value,expected_text,expected_images",
    [
        (json.dumps(META) + "\n\n" + URL, [json.dumps(META)], [URL]),
        ({"contentItems": [{"type": "inputText", "text": json.dumps(META)},
                           {"type": "inputImage", "imageUrl": URL}]}, [META], [URL]),
        (json.dumps([{"type": "inputText", "text": "failed: read denied"}]),
         ["failed: read denied"], []),
        ({"content": [{"type": "text", "text": "ok"},
                      {"type": "image", "mimeType": "image/png", "data": "aGVsbG8="}]},
         ["ok"], [{"type": "image", "mimeType": "image/png", "data": "aGVsbG8="}]),
        (META, [META], []),
        ("Tool failed: cancelled", ["Tool failed: cancelled"], []),
        ("text('injected'); throw new Error('run me')",
         ["text('injected'); throw new Error('run me')"], []),
        ("before\n" + URL + "\nbetween\n" + URL, ["before\n\nbetween"], [URL, URL]),
    ],
)
def test_emitter_preserves_text_and_images_without_binary_text(value, expected_text, expected_images):
    node = shutil.which("node")
    if not node:
        pytest.fail("Node is required to validate the executable model-facing contract")
    script = (
        "const output = {text: [], images: []};\n"
        "function text(v) {output.text.push(v);}\n"
        "function image(v) {output.images.push(v);}\n"
        + EMIT_ECHO_RESULT_JS
        + "\nemitEchoResult(JSON.parse(require('fs').readFileSync(0, 'utf8')));\n"
        + "process.stdout.write(JSON.stringify(output));"
    )
    result = subprocess.run(
        [node, "-e", script], input=json.dumps(value), capture_output=True,
        text=True, encoding="utf-8", timeout=10, check=True,
    )
    output = json.loads(result.stdout)
    assert output == {"text": expected_text, "images": expected_images}
    assert "base64" not in json.dumps(output["text"])


def test_contract_is_part_of_normal_codex_turn():
    agent = SimpleNamespace(soul="Test role")
    instructions = compose_codex_role_instructions(agent, context={}, goal="截图")
    assert DYNAMIC_RESULT_CONTRACT in instructions
    assert "Do not" in instructions
