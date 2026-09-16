"""Canonical persona identifiers; authorization roles are unrelated to this map."""

AGENT_ID_ALIASES = {
    "general": "eve", "coder": "kane", "desktop_operator": "raven",
    "vibe_selling": "luna", "ecommerce_mind": "shion",
    "market_researcher": "noah", "echo_noah": "noah", "aoi": "zero", "admin": "leon",
    "echo_eve": "eve", "echo_kane": "kane", "echo_leon": "leon",
    "echo_luna": "luna", "echo_raven": "raven", "echo_shion": "shion",
    "echo_zero": "zero",
}


def canonical_agent_id(value: str) -> str:
    return AGENT_ID_ALIASES.get(value, value)
