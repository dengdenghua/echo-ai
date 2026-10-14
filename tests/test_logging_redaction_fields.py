"""Redaction covers structured extras and tracebacks without changing text layout."""

import json
import logging
import sys

from runtime.platform.observability.logging_config import _build_formatter
from runtime.platform.observability.structured_logging import (
    StructuredFormatter,
    correlation_context,
)

SYNTHETIC_KEY = "sk-" + "x" * 48


def _record():
    try:
        raise ValueError("upstream rejected " + SYNTHETIC_KEY)
    except ValueError:
        return logging.makeLogRecord(
            {
                "name": "test.safe",
                "levelname": "ERROR",
                "levelno": logging.ERROR,
                "msg": "credential %s",
                "args": (SYNTHETIC_KEY,),
                "credential": SYNTHETIC_KEY,
                "nested": {"items": [SYNTHETIC_KEY, 42, True, None]},
                "exc_info": sys.exc_info(),
            }
        )


def test_json_redacts_message_nested_extras_context_and_traceback():
    record = _record()
    with correlation_context(session_id=SYNTHETIC_KEY, context_data={"key": SYNTHETIC_KEY}):
        output = StructuredFormatter(redact=True).format(record)
    data = json.loads(output)
    assert SYNTHETIC_KEY not in output
    assert "ValueError" in data["exc"]
    assert data["nested"]["items"][1:] == [42, True, None]
    assert data["level"] == "ERROR"
    assert data["logger"] == "test.safe"
    assert record.credential == SYNTHETIC_KEY
    assert record.nested["items"][0] == SYNTHETIC_KEY


def test_explicitly_unredacted_structured_formatter_keeps_compatibility():
    assert SYNTHETIC_KEY in StructuredFormatter(redact=False).format(_record())


def test_plain_formatter_preserves_custom_layout_and_redacts_exception():
    output = _build_formatter("%(levelname)s|%(message)s|%(credential)s").format(_record())
    assert SYNTHETIC_KEY not in output
    assert output.startswith("ERROR|credential [REDACTED:api_key]|[REDACTED:api_key]")
    assert "ValueError: upstream rejected [REDACTED:api_key]" in output


def test_plain_formatter_keeps_ordinary_text_unchanged():
    record = logging.makeLogRecord({"levelname": "INFO", "msg": "step %s", "args": ("done",)})
    assert _build_formatter("%(levelname)s: %(message)s").format(record) == "INFO: step done"


def test_json_configuration_uses_full_payload_redaction():
    assert SYNTHETIC_KEY not in _build_formatter("json").format(_record())
