from pathlib import Path

from runtime.execution.agents.aliases import AGENT_ID_ALIASES
from runtime.execution.agents.loader import parse_template
from runtime.sensing.gateway._agents_helpers import _BUILTIN_AGENT_IDS, _require_safe_agent_id


def test_every_builtin_alias_loads_the_canonical_identity():
    root = Path(__file__).resolve().parents[1] / "agents"
    for old, canonical in AGENT_ID_ALIASES.items():
        template = parse_template(root / old, root / "_shared")
        assert template.agent_id == canonical
        assert template.display_name.lower() == canonical
        assert _require_safe_agent_id(old) == canonical
        assert canonical in _BUILTIN_AGENT_IDS


def test_unknown_expert_ids_remain_unchanged():
    from runtime.execution.agents.aliases import canonical_agent_id

    assert canonical_agent_id("custom-expert") == "custom-expert"
