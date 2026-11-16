"""Exact model facts verified against vendor documentation on 2026-11-14.

Do not infer a whole model family from a name substring. Engine/account
metadata and explicit operator declarations take precedence over these facts.
API capacity is not a promise that a subscription engine enables that capacity.
"""
from __future__ import annotations

OPENAI = "https://developers.openai.com/api/docs/models/"
DEEPSEEK = "https://api-docs.deepseek.com/quick_start/pricing/"

FACTS = {
    "gpt-6.1-sol": (1_050_000, ("low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-6.1-sol"),
    "gpt-6-astra": (1_050_000, ("low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-6-astra"),
    "gpt-6.1-terra": (1_050_000, ("off", "low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-6.1-terra"),
    "gpt-6-luna": (1_050_000, ("off", "low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-6-luna"),
    "gpt-5.6-terra": (1_050_000, ("off", "low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-5.6-terra"),
    "gpt-5.6-luna": (1_050_000, ("off", "low", "medium", "high", "xhigh", "max"), OPENAI + "gpt-5.6-luna"),
    "deepseek-flash": (1_000_000, ("off", "high", "xhigh"), DEEPSEEK),
    "deepseek-v4-flash": (1_000_000, ("off", "high", "xhigh"), DEEPSEEK),
    "deepseek-v4-pro": (1_000_000, ("off", "high", "xhigh"), DEEPSEEK),
}

def official_model_capabilities(model: str) -> dict:
    fact = FACTS.get(model.strip().removesuffix("::1m").lower())
    if not fact:
        return {}
    context, efforts, source = fact
    return {"context_window": context, "reasoning_efforts": list(efforts),
            "capability_source": source, "capability_verified_at": "2026-11-14"}

def account_context_metadata(raw: dict, model: str) -> dict:
    for key in ("contextWindow", "context_window", "contextWindowTokens"):
        value = raw.get(key)
        if type(value) is int and value > 0:
            return {"context_window": value, "context_source": "engine"}
    if model == "gpt-6.1-sol":
        # Official model documentation states 500K default in Codex/Work.
        return {"context_window": 500_000, "context_source": "official_engine_default"}
    facts = official_model_capabilities(model)
    return {"context_window": facts.get("context_window"),
            "context_source": "official_api" if facts else "unknown"}
