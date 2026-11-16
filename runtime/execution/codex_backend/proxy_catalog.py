"""Codex catalog metadata for the current trusted Echo proxy model only."""
from __future__ import annotations
import json
from typing import Any


def configure_proxy_catalog(context: Any, request: Any) -> None:
    is_proxy = request.use_system_model_proxy or getattr(getattr(request, "provider_profile", None), "provider_id", None) == "echo_proxy"
    if not is_proxy or not request.model or request.model_context_window is None:
        return
    # A custom model otherwise receives Codex's synthetic 272K fallback.
    # Schema: https://learn.chatgpt.com/docs/enterprise/roll-out-a-gateway
    model = {
        "slug": request.model, "display_name": request.model, "description": None,
        "base_instructions": "Help the user with their tasks.",
        "supported_reasoning_levels": [], "shell_type": "shell_command",
        "visibility": "list", "supported_in_api": True, "priority": 0,
        "support_verbosity": False, "supports_reasoning_summaries": False,
        "truncation_policy": {"mode": "tokens", "limit": 10000},
        "experimental_supported_tools": [],
        "context_window": request.model_context_window,
        "max_context_window": request.model_context_window,
        "effective_context_window_percent": 95,
    }
    if request.auto_compact_token_limit is not None:
        model["auto_compact_token_limit"] = request.auto_compact_token_limit
    path = context.codex_home / "echo-proxy-model.json"
    path.write_text(json.dumps({"models": [model]}), encoding="utf-8")
    config = context.config_path.read_text(encoding="utf-8")
    context.config_path.write_text("model_catalog_json = " + json.dumps(str(path)) + "\n" + config, encoding="utf-8")
