"""What Echo locks in one Codex executable's ``config.toml``.

Codex builds differ in the feature flags and config keys they know, and
``--strict-config`` refuses unknown ones, so part of the lock is chosen per
executable: the base list everywhere, plus what this build defines.

Skills: on Windows Codex lists the real profile's ``~/.agents/skills`` even
with HOME and USERPROFILE pointed at Echo's isolated home (seen 2026-10-15:
a sidecar prompt carried the user's 16 DingTalk skills under root ``r0``),
plus its own bundled skills. Echo composes the role's skills itself, so where
the build allows it the sidecar gets no skills catalog, no bundled skills, no
skill search and no automatic MCP installs for skills.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from .feature_support import accepts_config_overrides, supported_codex_features

LOCKED_OFF_FEATURES = (
    "apps",
    "auth_elicitation",
    "enable_mcp_apps",
    "goals",
    "hooks",
    "mcp_2026_07_28",
    "memories",
    "multi_agent",
    "multi_agent_v2",
    "network_proxy",
    "plugins",
    "recommended_plugins",
    "remote_plugin",
    "remote_control",
    "respect_system_proxy",
    "shell_snapshot",
    "tool_suggest",
)
# Default-on in newer Codex builds and locked off there. Written only when the
# executable defines them: older pinned builds reject an unknown
# ``features.<name>`` key under --strict-config. If one is enabled but was not
# written, validate_effective_config still rejects it as unknown.
VERSIONED_LOCKED_OFF_FEATURES = (
    "api_key_model_discovery",
    "skill_mcp_dependency_install",
    "skill_search",
)
ALLOWED_ENABLED_FEATURES = frozenset({"mentions_v2"})

_SKILL_ISOLATION = ("skills.include_instructions=false", "skills.bundled.enabled=false")
_ISOLATED_SKILLS = {"bundled": {"enabled": False}, "include_instructions": False}


def executable_policy(
    codex_executable: str | None, *, state_root: Path | None = None
) -> dict[str, object]:
    """``CodexSidecarContext`` fields that depend on the executable."""

    supported = supported_codex_features(codex_executable) or frozenset()
    cache = state_root / "executable-config-support.json" if state_root is not None else None
    return {
        "locked_off_features": LOCKED_OFF_FEATURES
        + tuple(name for name in VERSIONED_LOCKED_OFF_FEATURES if name in supported),
        "host_skills_isolated": accepts_config_overrides(
            codex_executable, _SKILL_ISOLATION, cache_path=cache
        ),
    }


def skills_toml(isolated: bool) -> str:
    if isolated:
        return (
            "skills = { config = [], include_instructions = false, bundled = { enabled = false } }"
        )
    return "skills = { config = [] }"


def validate_skills(config: Mapping[str, object], isolated: bool, errors: list[str]) -> None:
    skills = config.get("skills")
    if isinstance(skills, Mapping) and skills.get("config") == []:
        skills = {key: value for key, value in skills.items() if key != "config"}
    if not isinstance(skills, Mapping) or dict(skills) != (_ISOLATED_SKILLS if isolated else {}):
        errors.append("skills must be empty" + (" and isolated from the host" if isolated else ""))


__all__ = [
    "ALLOWED_ENABLED_FEATURES",
    "LOCKED_OFF_FEATURES",
    "VERSIONED_LOCKED_OFF_FEATURES",
    "executable_policy",
    "skills_toml",
    "validate_skills",
]
