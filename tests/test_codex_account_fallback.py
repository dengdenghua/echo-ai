"""A signed-in Codex account answers when Echo's default model cannot run."""

from __future__ import annotations

from runtime.execution.codex_backend.model_profile import (
    CodexModelPreference,
    resolve_codex_execution_profile,
)


def _resolve(*, signed_in: bool, role_model: str | None = None, routed: bool = False):
    asked: list[bool] = []

    def account_signed_in() -> bool:
        asked.append(True)
        return signed_in

    profile = resolve_codex_execution_profile(
        preference=CodexModelPreference(),
        system_model="deepseek-chat",  # a fresh install's placeholder default
        role_model=role_model,
        proxy_available=True,
        proxy_route_available=lambda _model: routed,
        account_signed_in=account_signed_in,
    )
    return profile, asked


def test_a_placeholder_default_gives_way_to_the_signed_in_account() -> None:
    profile, _ = _resolve(signed_in=True)

    assert profile.compatible
    assert profile.provider == "openai" and not profile.proxy_required
    assert profile.effective_model is None  # Codex chooses its own default
    assert profile.model_source == "codex_default"


def test_without_a_login_the_default_still_reports_why_it_cannot_run() -> None:
    profile, _ = _resolve(signed_in=False)

    assert not profile.compatible
    assert profile.compatibility_reason


def test_a_model_picked_for_the_role_never_falls_back() -> None:
    profile, asked = _resolve(signed_in=True, role_model="deepseek-chat")

    assert not profile.compatible and asked == []


def test_a_default_that_runs_is_kept_and_the_login_never_asked() -> None:
    profile, asked = _resolve(signed_in=True, routed=True)

    assert profile.compatible and profile.proxy_required
    assert profile.effective_model == "deepseek-chat" and asked == []
