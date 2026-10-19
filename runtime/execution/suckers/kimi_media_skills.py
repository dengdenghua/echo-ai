"""Media generation skills (image / video / speech / sfx) for the kimi compat set.

Extracted from ``kimi_compat_skills`` to keep the register module under the
god-file threshold. The register module imports the handlers back, so the
public surface (``register_kimi_compat_skills``) is unchanged. Path-safety
helpers (``_ensure_path`` family) live here because both media and the
website/image skills in the parent module rely on them.
"""

from __future__ import annotations

import base64
import importlib.util
import os
import re
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import httpx  # type: ignore[import-untyped]

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]


_HTTP_TIMEOUT_S = 12.0
_MAX_IMAGE_RESULTS = 30

_BUNDLED_MEDIA_SCRIPTS = {
    "image": (
        "agnes-image-generate",
        "agnes_image_generate.py",
    ),
    "video": (
        "agnes-video-generate",
        "agnes_video_generate.py",
    ),
}


def _client(timeout_s: float = _HTTP_TIMEOUT_S) -> Any:
    if not HTTPX_AVAILABLE:
        return None
    return httpx.Client(timeout=timeout_s, follow_redirects=True)


def _ensure_path(path: str | Path, sandbox_dir: str | None = None) -> tuple[Path, str | None]:
    """Resolve a caller-supplied path for a read/copy skill.

    Audit S-05: ``allow_sensitive`` was set to True here, so a prompt-
    injected request could name ``~/.ssh`` (or ``~/.aws``, ``~/.kube``,
    ``/etc/passwd``, …) as a deploy source and have its secrets copied
    into the servable deployments area. The sensitive-path check is the
    hard floor; no skill caller gets to opt out.
    """
    from runtime.safety.auth.path_guard import check_path

    verdict = check_path(path, sandbox_dir=sandbox_dir, allow_sensitive=False)
    if not verdict.allow:
        return Path(path), f"path_blocked: {verdict.reason}"
    return Path(verdict.resolved) if verdict.resolved else Path(path), None


def _checked_write_target(path: str | Path, sandbox_dir: str | None = None) -> Path:
    """Validate a model-supplied write destination (file or directory).

    Runs the same two guards the executor applies to write tools:
    ``path_guard.check_path`` (sandbox confinement when a ``sandbox_dir`` is
    bound — the executor injects the session's write scope — plus the
    sensitive-path floor) and the credential-file write denylist
    (``.bashrc`` / ``.env`` / ``~/.ssh`` …). Raises ``PermissionError``.
    Absolute inputs are returned as given (the verdict already checked their
    resolved form); relative ones are anchored where the guard resolved them.
    """
    from runtime.safety.auth import check_file_write
    from runtime.safety.auth.path_guard import check_path

    raw = str(path)
    verdict = check_path(raw, sandbox_dir=sandbox_dir, allow_sensitive=False)
    if not verdict.allow:
        raise PermissionError(f"path_blocked: {verdict.reason}")
    target = Path(raw).expanduser()
    if not target.is_absolute() and verdict.resolved:
        target = Path(verdict.resolved)
    write_verdict = check_file_write(verdict.resolved or target)
    if not write_verdict.allow:
        raise PermissionError(f"path_blocked: {write_verdict.reason}")
    return target


def _safe_output_dir(
    path: str | None,
    default_name: str,
    *,
    sandbox_dir: str | None = None,
) -> Path:
    if path:
        return _checked_write_target(path, sandbox_dir)
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / default_name


def _get_available_voices(**_: Any) -> dict[str, Any]:
    voices = [
        {"id": "alloy", "provider": "openai-compatible", "language": "multi"},
        {"id": "echo", "provider": "openai-compatible", "language": "multi"},
        {"id": "fable", "provider": "openai-compatible", "language": "multi"},
        {"id": "onyx", "provider": "openai-compatible", "language": "multi"},
        {"id": "nova", "provider": "openai-compatible", "language": "multi"},
        {"id": "shimmer", "provider": "openai-compatible", "language": "multi"},
    ]
    return {"ok": True, "configured": bool(os.environ.get("OPENAI_API_KEY")), "voices": voices}


def _provider_missing(name: str, provider_hint: str) -> dict[str, Any]:
    return {
        "ok": False,
        "error": f"{name}_provider_not_configured",
        "hint": provider_hint,
    }


def _openai_media_config() -> tuple[str, str]:
    base_url = (
        os.environ.get("OPENAI_MEDIA_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("OPENAI_API_BASE")
        or "https://api.openai.com/v1"
    ).rstrip("/")
    api_key = os.environ.get("OPENAI_MEDIA_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
    return base_url, api_key


def _bundled_media_configured() -> bool:
    """Whether the bundled Volcano/Agnes adapters have usable credentials."""

    return any(
        str(os.environ.get(name) or "").strip()
        for name in (
            "VOLCENGINE_API_KEY",
            "ARK_API_KEY",
            "AGNES_API_KEY",
        )
    )


@lru_cache(maxsize=2)
def _load_bundled_media_module(kind: str) -> Any:
    """Load a fixed bundled media adapter without exposing arbitrary imports."""

    try:
        skill_dir, script_name = _BUNDLED_MEDIA_SCRIPTS[kind]
    except KeyError as exc:
        raise ValueError(f"unsupported bundled media kind: {kind}") from exc
    script = (
        Path(__file__).resolve().parent.parent / "all_skills" / skill_dir / "scripts" / script_name
    )
    module_name = f"_echo_bundled_{kind}_media"
    spec = importlib.util.spec_from_file_location(module_name, script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load bundled {kind} media adapter")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _bundled_provider_overrides(provider: str) -> dict[str, str]:
    """Resolve an explicitly selected bundled provider without returning keys."""

    selected = provider.strip().lower()
    if selected in {"agnes", "agnes-ai"}:
        return {
            "api_key": str(os.environ.get("AGNES_API_KEY") or "").strip(),
            "base_url": str(
                os.environ.get("AGNES_BASE_URL") or "https://apihub.agnes-ai.com/v1"
            ).strip(),
        }
    if selected in {"volcano", "volcengine", "ark", "火山"}:
        return {
            "api_key": str(
                os.environ.get("VOLCENGINE_API_KEY") or os.environ.get("ARK_API_KEY") or ""
            ).strip(),
            "base_url": str(
                os.environ.get("VOLCENGINE_BASE_URL")
                or "https://ark.cn-beijing.volces.com/api/plan/v3"
            ).strip(),
        }
    return {}


def _bundled_provider_candidates(provider: str = "") -> list[tuple[str, dict[str, str]]]:
    """Return configured media providers in deterministic fallback order."""

    selected = provider.strip().lower()
    aliases = {
        "agnes": "agnes",
        "agnes-ai": "agnes",
        "volcano": "volcano",
        "volcengine": "volcano",
        "ark": "volcano",
        "火山": "volcano",
    }
    if selected:
        canonical = aliases.get(selected)
        if canonical is None:
            return []
        overrides = _bundled_provider_overrides(canonical)
        return [(canonical, overrides)] if overrides.get("api_key") else []

    candidates: list[tuple[str, dict[str, str]]] = []
    for name in ("volcano", "agnes"):
        overrides = _bundled_provider_overrides(name)
        if overrides.get("api_key"):
            candidates.append((name, overrides))
    return candidates


def _compact_media_result(result: dict[str, Any], *, provider: str) -> dict[str, Any]:
    """Return stable tool output without echoing bulky provider payloads."""

    compact = {key: value for key, value in result.items() if key != "raw"}
    compact["provider"] = provider
    compact["ok"] = not bool(compact.get("error"))
    return compact


def _media_output_path(
    kind: str,
    suffix: str,
    output_path: str = "",
    sandbox_dir: str | None = None,
) -> Path:
    if output_path:
        return _checked_write_target(output_path, sandbox_dir)
    root = _safe_output_dir(None, "generated_media") / kind
    root.mkdir(parents=True, exist_ok=True)
    # ``suffix`` can be model-supplied (generate_speech ``format``); keep it a
    # bare extension so it cannot smuggle separators / ``..`` into the name.
    safe_suffix = re.sub(r"[^A-Za-z0-9]", "", suffix)[:12] or "bin"
    return root / f"{kind}-{int(time.time() * 1000)}.{safe_suffix}"


def _generate_image(
    prompt: str = "",
    *,
    model: str | None = None,
    size: str = "1024x1024",
    n: int = 1,
    image: str | list[str] | None = None,
    provider: str = "",
    output_path: str = "",
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    if not prompt.strip():
        return {"error": "missing prompt"}
    if not HTTPX_AVAILABLE:
        return {"error": "httpx not installed"}
    # Validate a caller-chosen destination before spending a provider call.
    out_target: Path | None = None
    if output_path:
        try:
            out_target = _media_output_path("image", "png", output_path, sandbox_dir)
        except PermissionError as exc:
            return {"ok": False, "error": str(exc)}
    from . import media_gateway

    if media_gateway.selected():
        return media_gateway.generate("image", prompt, model=model, size=size, n=n, image=image)
    base_url, api_key = _openai_media_config()
    if not api_key:
        if _bundled_media_configured():
            module = _load_bundled_media_module("image")
            failures: list[str] = []
            candidates = _bundled_provider_candidates(provider)
            if not candidates:
                return _provider_missing(
                    "generate_image",
                    f"Requested provider {provider!r} is unknown or not configured.",
                )
            for selected, overrides in candidates:
                try:
                    result = module.generate_image(
                        prompt,
                        model=model,
                        size=size,
                        n=n,
                        image=image,
                        **overrides,
                    )
                    if not result.get("url") and not result.get("urls"):
                        failures.append(f"{selected}: empty response")
                        continue
                    compact = _compact_media_result(result, provider=selected)
                    if failures:
                        compact["fallback_from"] = [item.split(":", 1)[0] for item in failures]
                    return compact
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{selected}: {type(exc).__name__}: {exc}")
            return {
                "ok": False,
                "error": "generate_image_all_providers_failed: " + "; ".join(failures),
                "providers": [name for name, _ in candidates],
            }
        return _provider_missing(
            "generate_image",
            "Set OPENAI_API_KEY / OPENAI_MEDIA_API_KEY, VOLCENGINE_API_KEY / "
            "ARK_API_KEY, or AGNES_API_KEY.",
        )
    image_model = model or os.environ.get("OPENAI_IMAGE_MODEL") or "gpt-image-1"
    try:
        with _client(timeout_s=120) as client:
            payload: dict[str, Any] = {
                "model": image_model,
                "prompt": prompt,
                "size": size,
                "n": 1,
            }
            response_format = os.environ.get("OPENAI_IMAGE_RESPONSE_FORMAT", "")
            if response_format:
                payload["response_format"] = response_format
            r = client.post(
                f"{base_url}/images/generations",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
            r.raise_for_status()
            data = r.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"generate_image_error: {type(exc).__name__}: {exc}"}
    item = ((data.get("data") or [{}])[0]) if isinstance(data, dict) else {}
    if item.get("b64_json"):
        out = out_target or _media_output_path("image", "png")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(item["b64_json"]))
        return {"ok": True, "model": image_model, "path": str(out), "size": size}
    if item.get("url"):
        return {"ok": True, "model": image_model, "url": item["url"], "size": size}
    return {"error": "generate_image_empty_response", "response": data}


def _generate_video(
    prompt: str = "",
    *,
    task_id: str = "",
    model: str | None = None,
    provider: str = "",
    width: int = 1152,
    height: int = 768,
    num_frames: int = 49,
    frame_rate: int = 24,
    seconds: str | int = "5",
    image: str | list[str] | None = None,
    wait: bool = True,
    max_wait_seconds: int = 600,
    **_: Any,
) -> dict[str, Any]:
    if not prompt.strip() and not task_id.strip():
        return {"error": "missing prompt"}
    from . import media_gateway

    if media_gateway.selected():
        return media_gateway.generate(
            "video",
            prompt,
            model=model,
            task_id=task_id,
            width=width,
            height=height,
            seconds=seconds,
            image=image,
        )
    if not _bundled_media_configured():
        return _provider_missing(
            "generate_video",
            "Set VOLCENGINE_API_KEY / ARK_API_KEY or AGNES_API_KEY.",
        )
    module = _load_bundled_media_module("video")
    failures: list[str] = []
    candidates = _bundled_provider_candidates(provider)
    if not candidates:
        return _provider_missing(
            "generate_video",
            f"Requested provider {provider!r} is unknown or not configured.",
        )
    for selected, overrides in candidates:
        try:
            if task_id.strip():
                result = module.poll_video(task_id.strip(), model=model, **overrides)
            else:
                result = module.generate_video(
                    prompt,
                    model=model,
                    width=width,
                    height=height,
                    num_frames=num_frames,
                    frame_rate=frame_rate,
                    seconds=seconds,
                    image=image,
                    wait=wait,
                    max_wait_seconds=max_wait_seconds,
                    **overrides,
                )
            compact = _compact_media_result(result, provider=selected)
            if compact.get("ok") is False:
                failures.append(f"{selected}: {compact.get('error') or 'failed'}")
                continue
            if failures:
                compact["fallback_from"] = [item.split(":", 1)[0] for item in failures]
            return compact
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{selected}: {type(exc).__name__}: {exc}")
    return {
        "ok": False,
        "error": "generate_video_all_providers_failed: " + "; ".join(failures),
        "providers": [name for name, _ in candidates],
    }


def _generate_speech(
    text: str = "",
    voice: str = "alloy",
    *,
    model: str | None = None,
    format: str = "mp3",  # noqa: A002
    output_path: str = "",
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    if not text.strip():
        return {"error": "missing text"}
    if not HTTPX_AVAILABLE:
        return {"error": "httpx not installed"}
    # Validate a caller-chosen destination before spending a provider call.
    out_target: Path | None = None
    if output_path:
        try:
            out_target = _media_output_path("speech", format, output_path, sandbox_dir)
        except PermissionError as exc:
            return {"ok": False, "error": str(exc)}
    base_url, api_key = _openai_media_config()
    if not api_key:
        return _provider_missing(
            "generate_speech",
            "Set OPENAI_API_KEY or OPENAI_MEDIA_API_KEY, plus optional OPENAI_MEDIA_BASE_URL.",
        )
    tts_model = model or os.environ.get("OPENAI_TTS_MODEL") or "gpt-4o-mini-tts"
    try:
        with _client(timeout_s=120) as client:
            r = client.post(
                f"{base_url}/audio/speech",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": tts_model,
                    "input": text,
                    "voice": voice,
                    "response_format": format,
                },
            )
            r.raise_for_status()
            audio = r.content
    except Exception as exc:  # noqa: BLE001
        return {"error": f"generate_speech_error: {type(exc).__name__}: {exc}"}
    out = out_target or _media_output_path("speech", format)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    return {"ok": True, "model": tts_model, "voice": voice, "path": str(out), "bytes": len(audio)}


def _generate_sound_effects(prompt: str = "", **_: Any) -> dict[str, Any]:
    if not prompt.strip():
        return {"error": "missing prompt"}
    return _provider_missing(
        "generate_sound_effects",
        "Connect an audio effects generation backend before use.",
    )
