from __future__ import annotations

from runtime.execution.suckers.registry import Skill, SkillRegistry


def _skill(name: str) -> Skill:
    return Skill(
        name=name,
        description="test skill",
        trusted_source="builtin://test",
        handler=lambda: {"ok": True},
    )


def test_legacy_skill_alias_resolves_without_duplicate_catalog_entry() -> None:
    registry = SkillRegistry()
    registry.register(_skill("ad-creative"), verify_tests=False)

    assert registry.has("ad-copywriter")
    assert registry.get("ad-copywriter").name == "ad-creative"
    assert registry.all_names() == ["ad-creative"]


def test_legacy_prompt_package_registers_its_canonical_name(tmp_path) -> None:
    from runtime.execution.suckers.market_skills import register_market_skills

    package = tmp_path / "database-inspector"
    package.mkdir()
    (package / "SKILL.md").write_text(
        "---\nname: database-inspector\ndescription: inspect a database\n---\n"
        "Read the database schema.\n",
        encoding="utf-8",
    )
    registry = SkillRegistry()
    assert register_market_skills(registry, all_skills_dir=tmp_path, verify_tests=False) == 1
    assert registry.has("database-inspector")
    assert registry.get("database-inspector").name == "database-scout"
    assert registry.all_names() == ["database-scout"]
    assert (
        register_market_skills(
            registry, all_skills_dir=tmp_path, verify_tests=False, skip_registered_directories=True
        )
        == 0
    )
