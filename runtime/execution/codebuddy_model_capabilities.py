"""Read only public model fields from the official CLI's product cache.

No account identifiers, endpoints, credentials, or raw cached records escape.
The live CLI model list remains the authority for model availability.
"""
import json
from pathlib import Path

EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "max"}

def model_capabilities(models: list[str], storage: Path | None = None) -> dict:
    storage = storage or Path.home() / ".codebuddy/local_storage"
    candidates = []
    for path in storage.glob("*.info"):
        try:
            if path.stat().st_size > 8_000_000:
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, list):
                continue
            for item in payload:
                if not isinstance(item, dict) or not isinstance(item.get("data"), dict):
                    continue
                rows = item["data"].get("models")
                if isinstance(rows, list):
                    candidates.append((float(item.get("ts") or 0), rows))
        except (OSError, ValueError, TypeError):
            continue
    result = {}
    for _, rows in sorted(candidates, key=lambda item: item[0]):
        for row in rows:
            if not isinstance(row, dict) or row.get("id") not in models:
                continue
            reasoning = row.get("reasoning") or {}
            if not isinstance(reasoning, dict):
                reasoning = {}
            efforts = reasoning.get("supportedEfforts")
            if not isinstance(efforts, list):
                # A declared fixed effort is not six selectable tiers.
                efforts = [reasoning.get("defaultEffort") or reasoning.get("effort")]
            window = row.get("maxInputTokens")
            result[row["id"]] = {
                "context_window": window if type(window) is int and window > 0 else None,
                "context_source": "engine_input",
                "reasoning_efforts": [e for e in efforts if isinstance(e, str) and e in EFFORTS],
                "default_reasoning_effort": reasoning.get("defaultEffort") or reasoning.get("effort"),
            }
    return result
