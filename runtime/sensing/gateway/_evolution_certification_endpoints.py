"""Scorecard and Kimi-swarm certification endpoints for the evolution router.

Pure structural split of ``evolution_router.create_evolution_router`` — no
logic changes. Registration order is still owned by the factory.
"""

from __future__ import annotations

from typing import Any

from runtime.safety.evolution.agent_competitor_scorecard import (
    DEFAULT_TARGET_SCORE as DEFAULT_AGENT_SCORECARD_TARGET_SCORE,
)

try:
    from fastapi import APIRouter, HTTPException, Query

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - create_evolution_router returns early
    FASTAPI_AVAILABLE = False

from runtime.sensing.gateway._evolution_helpers import (
    _kimi_swarm_provider_caller,
    _kimi_swarm_provider_configured,
    _queue_agent_scorecard_gaps_impl,
    _validate_kimi_swarm_quota_probe_request,
    _validate_kimi_swarm_real_provider_request,
)
from runtime.sensing.gateway._evolution_models import (
    KimiSwarmLoadTestBody,
    KimiSwarmQuotaProbeBody,
    ScorecardGapQueueBody,
)


def _register_scorecard_routes(router: APIRouter) -> None:
    """Agent scorecard / benchmark, Kimi-swarm certification and load tests."""

    @router.get("/agent-scorecard")
    def get_agent_scorecard(
        target_score: int = Query(
            default=DEFAULT_AGENT_SCORECARD_TARGET_SCORE,
            ge=1,
            le=100,
        ),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.agent_competitor_scorecard import (
                compute_agent_competitor_scorecard,
            )

            return {
                "ok": True,
                **compute_agent_competitor_scorecard(target_score=target_score),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/agent-benchmark")
    def get_agent_benchmark() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.agent_benchmark import (
                compute_agent_benchmark,
            )

            return {"ok": True, **compute_agent_benchmark()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/kimi-swarm-certification")
    def get_kimi_swarm_certification() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_certification import (
                compute_kimi_swarm_certification,
            )

            return {
                "ok": True,
                **compute_kimi_swarm_certification(
                    provider_configured=_kimi_swarm_provider_configured("kimi-k3"),
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/kimi-swarm-certification/load-test")
    def run_kimi_swarm_certification_load_test(
        body: KimiSwarmLoadTestBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                KimiSwarmLoadTestConfig,
                run_kimi_swarm_load_test,
            )

            body = body or KimiSwarmLoadTestBody()
            provider_caller = None
            if body.real_provider:
                _validate_kimi_swarm_real_provider_request(body)
                provider_caller = _kimi_swarm_provider_caller(body.model)
            result = run_kimi_swarm_load_test(
                config=KimiSwarmLoadTestConfig(
                    session_id=body.session_id,
                    provider_id=body.provider_id,
                    model=body.model,
                    agent_count=body.agent_count,
                    step_count=body.step_count,
                    max_concurrency=body.max_concurrency,
                    real_provider=body.real_provider,
                    confirm_real_provider=body.confirm_real_provider,
                    record_every_step=body.record_every_step,
                    max_provider_calls=body.max_provider_calls,
                    estimated_max_tokens=body.estimated_max_tokens,
                    stage_id=body.stage_id,
                    resume_from_session_id=body.resume_from_session_id,
                    resume_step_ranges=tuple(body.resume_step_ranges),
                ),
                provider_caller=provider_caller,
            )
            return {"ok": True, **result}
        except HTTPException:
            raise
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/kimi-swarm-certification/load-test/preflight")
    def preflight_kimi_swarm_certification_load_test(
        body: KimiSwarmLoadTestBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                KimiSwarmLoadTestConfig,
                build_kimi_swarm_load_test_preflight,
            )

            body = body or KimiSwarmLoadTestBody()
            provider_configured = None
            if body.real_provider:
                provider_configured = _kimi_swarm_provider_configured(body.model)
            return {
                "ok": True,
                **build_kimi_swarm_load_test_preflight(
                    config=KimiSwarmLoadTestConfig(
                        session_id=body.session_id,
                        provider_id=body.provider_id,
                        model=body.model,
                        agent_count=body.agent_count,
                        step_count=body.step_count,
                        max_concurrency=body.max_concurrency,
                        real_provider=body.real_provider,
                        confirm_real_provider=body.confirm_real_provider,
                        record_every_step=body.record_every_step,
                        max_provider_calls=body.max_provider_calls,
                        estimated_max_tokens=body.estimated_max_tokens,
                        stage_id=body.stage_id,
                        resume_from_session_id=body.resume_from_session_id,
                        resume_step_ranges=tuple(body.resume_step_ranges),
                    ),
                    provider_configured=provider_configured,
                    data_dir=None,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


def _register_swarm_plan_routes(router: APIRouter) -> None:
    """Kimi-swarm quota probe, proof bundle, stage plans; e2e surpass; gap queue."""

    @router.post("/kimi-swarm-certification/quota-probe")
    def run_kimi_swarm_certification_quota_probe(
        body: KimiSwarmQuotaProbeBody | None = None,
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                KimiSwarmQuotaProbeConfig,
                run_kimi_swarm_quota_probe,
            )

            body = body or KimiSwarmQuotaProbeBody()
            _validate_kimi_swarm_quota_probe_request(body)
            result = run_kimi_swarm_quota_probe(
                config=KimiSwarmQuotaProbeConfig(
                    session_id=body.session_id,
                    provider_id=body.provider_id,
                    model=body.model,
                    confirm_real_provider=body.confirm_real_provider,
                    max_tokens=body.max_tokens,
                ),
                provider_caller=_kimi_swarm_provider_caller(body.model),
            )
            return {"ok": True, **result}
        except HTTPException:
            raise
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/kimi-swarm-certification/proof-bundle")
    def get_kimi_swarm_certification_proof_bundle() -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                export_kimi_swarm_proof_bundle,
            )

            return {"ok": True, **export_kimi_swarm_proof_bundle()}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/kimi-swarm-certification/next-stage")
    def get_kimi_swarm_certification_next_stage(
        provider_id: str = Query(default="volcengine_ark"),
        model: str = Query(default="kimi-k3"),
        agent_count: int = Query(default=300, ge=1, le=512),
        step_count: int = Query(default=4000, ge=1, le=20000),
        max_concurrency: int = Query(default=32, ge=1, le=256),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                recommend_kimi_swarm_next_stage,
            )

            return {
                "ok": True,
                **recommend_kimi_swarm_next_stage(
                    provider_id=provider_id,
                    model=model,
                    agent_count=agent_count,
                    step_count=step_count,
                    max_concurrency=max_concurrency,
                    provider_configured=_kimi_swarm_provider_configured(model),
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/kimi-swarm-certification/resume-plan")
    def get_kimi_swarm_certification_resume_plan(
        provider_id: str = Query(default="volcengine_ark"),
        model: str = Query(default="kimi-k3"),
        agent_count: int = Query(default=300, ge=1, le=512),
        step_count: int = Query(default=4000, ge=1, le=20000),
        max_concurrency: int = Query(default=32, ge=1, le=256),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.kimi_swarm_load_test import (
                build_kimi_swarm_resume_plan,
            )

            return {
                "ok": True,
                **build_kimi_swarm_resume_plan(
                    provider_id=provider_id,
                    model=model,
                    agent_count=agent_count,
                    step_count=step_count,
                    max_concurrency=max_concurrency,
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/e2e-surpass-certification")
    def get_e2e_surpass_certification(
        target_score: int = Query(default=95, ge=1, le=100),
    ) -> dict[str, Any]:
        try:
            from runtime.safety.evolution.e2e_surpass_certification import (
                compute_e2e_surpass_certification,
            )

            return {
                "ok": True,
                **compute_e2e_surpass_certification(target_score=target_score),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/agent-scorecard/gaps/queue")
    def queue_agent_scorecard_gaps(
        body: ScorecardGapQueueBody | None = None,
    ) -> dict[str, Any]:
        return _queue_agent_scorecard_gaps_impl(body)
