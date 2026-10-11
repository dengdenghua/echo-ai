"""AI video generation skill (async) — dual-provider (Volcano / Agnes).

Provider is auto-detected from ``base_url``:

- **Volcano (火山方舟)** — ``https://ark.cn-beijing.volces.com/api/plan/v3``,
  model ``doubao-seedance-1.5-pro``:
    POST  {base}/contents/generations/tasks        — create task
    GET   {base}/contents/generations/tasks/{id}   — poll status
  Request body uses a ``content`` array (text / image_url). Terminal success
  status is ``succeeded``; the video URL lives under ``content.video_url``.
- **Agnes AI Gateway** — ``https://apihub.agnes-ai.com/v1``,
  model ``agnes-video-2.5-flash`` (legacy v2.0 remains selectable):
    POST  {base}/videos        — create task
    GET   /agnesapi?video_id={id}&model_name={model} — poll 2.5 status
  Terminal success status is ``completed``; video URL is top-level.

By default this skill blocks until the task completes (``wait=True``),
polling at a backed-off cadence so we don't hammer the gateway.

Usage:
    from agnes_video_generate import generate_video, poll_video

    r = generate_video("a red panda walking through a forest")
    print(r["video_url"])  # mp4 URL when status is terminal-success
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import requests

_LOG = logging.getLogger(__name__)

# Volcano (火山方舟) — Agent Plan 套餐端点
VOLC_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"
VOLC_MODEL = "doubao-seedance-1.5-pro"

# Agnes AI Gateway — OpenAI 兼容
AGNES_URL = "https://apihub.agnes-ai.com/v1"
AGNES_MODEL = "agnes-video-2.5-flash"

DEFAULT_BASE_URL = VOLC_URL
DEFAULT_MODEL = VOLC_MODEL

# Per Agnes docs: agnes-video-v2.0 frame_rule = "8n+1", max_frames = 441
_AGNES_MAX_FRAMES = 441


def _is_volcano(base_url: str) -> bool:
    """True when the base URL points at Volcano Ark (vs. Agnes)."""
    return "volces.com" in (base_url or "").lower()


def _resolve_api_key() -> str:
    for var in ("VOLCENGINE_API_KEY", "ARK_API_KEY", "AGNES_API_KEY", "OPENAI_API_KEY"):
        val = os.environ.get(var, "").strip()
        if val:
            return val
    return ""


@dataclass(frozen=True)
class AgnesConfig:
    api_key: str
    base_url: str = DEFAULT_BASE_URL

    @classmethod
    def from_env(cls) -> AgnesConfig:
        key = _resolve_api_key()
        if not key:
            raise ValueError(
                "No API key found. Set VOLCENGINE_API_KEY / ARK_API_KEY "
                "(Volcano) or AGNES_API_KEY / OPENAI_API_KEY (Agnes), "
                "or pass api_key= explicitly.",
            )
        base = (
            os.environ.get("VOLCENGINE_BASE_URL", "").strip()
            or os.environ.get("AGNES_BASE_URL", "").strip()
            or DEFAULT_BASE_URL
        ).rstrip("/")
        return cls(api_key=key, base_url=base)


def _build_content(
    prompt: str,
    image: str | list[str] | None,
) -> list[dict[str, Any]]:
    """Build the Volcano ``content`` array (text + optional image_url)."""
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    if image is not None:
        urls = [image] if isinstance(image, str) else image
        for u in urls:
            content.append(
                {"type": "image_url", "image_url": {"url": u}},
            )
    return content


def generate_video(
    prompt: str,
    *,
    model: str | None = None,
    width: int = 1152,
    height: int = 768,
    num_frames: int = 49,
    frame_rate: int = 24,
    seconds: str | int = "5",
    image: str | list[str] | None = None,
    seed: int | None = None,
    wait: bool = True,
    max_wait_seconds: int = 600,
    poll_interval_seconds: float = 5.0,
    api_key: str | None = None,
    base_url: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a video generation task and (optionally) wait for completion.

    Parameters
    ----------
    prompt
        Text instruction for the desired video. Required.
    model
        Default ``doubao-seedance-1.5-pro`` (Volcano) if base URL is Volcano,
        else ``agnes-video-2.5-flash``.
    width, height
        Output resolution hint. Used to derive ratio for Volcano.
    num_frames
        Legacy Agnes v2.0 frames must satisfy ``8n+1`` (49, 81, 121, ...).
        Agnes 2.5 uses ``seconds`` instead and omits legacy frame controls.
        For Volcano this maps to a ``duration`` hint (frames/fps, clamped ≥1).
    frame_rate
        Legacy/Volcano frames per second, 1..60. Default 24.
    seconds
        Agnes 2.5 duration, string or integer 4..12; default 5.
    image
        Optional reference image URL(s):
          - single string: image-to-video (first frame)
          - list of two strings: keyframe (first/last frame) transition
    seed
        Optional deterministic seed.
    wait
        When True (default), block until the task reaches a terminal state
        (succeeded/completed/failed) or ``max_wait_seconds`` elapses. When
        False, return immediately after submitting — caller polls later via
        ``agnes_video_poll(task_id)``.
    max_wait_seconds
        Hard ceiling on how long to wait when ``wait=True``.
    poll_interval_seconds
        Initial poll cadence. Backs off mildly on each iteration.

    Returns
    -------
    dict
        Always contains ``task_id``, ``status``, ``model``.
        On completion: ``video_url`` is populated.
        On failure / timeout: includes ``error`` field.

    Raises
    ------
    ValueError
        Bad inputs (empty prompt, invalid num_frames for Agnes, missing key).
    RuntimeError
        Non-200 from the gateway, or terminal status=failed/expired.
    TimeoutError
        ``wait=True`` and task didn't finish in time.
    """
    if not prompt or not str(prompt).strip():
        raise ValueError("prompt is required")
    if not 1 <= int(frame_rate) <= 60:
        raise ValueError(f"frame_rate must be 1..60; got {frame_rate}")

    if api_key is None or base_url is None:
        cfg = AgnesConfig.from_env()
        api_key = api_key or cfg.api_key
        base_url = (base_url or cfg.base_url).rstrip("/")

    volcano = _is_volcano(base_url)
    if model is None:
        model = VOLC_MODEL if volcano else AGNES_MODEL

    if volcano:
        # Seedance: content array + resolution/ratio/duration hints.
        minutes = (int(num_frames) / int(frame_rate)) if int(frame_rate) else 0
        duration = max(1, round(minutes))
        payload: dict[str, Any] = {
            "model": model,
            "content": _build_content(str(prompt).strip(), image),
            "resolution": "1080p",
            "ratio": _ratio_from_size(width, height),
            "duration": duration,
        }
        if seed is not None:
            payload["seed"] = int(seed)
    elif model in {"agnes-video-2.5", "agnes-video-2.5-flash"}:
        # 2.5 uses seconds/mode/size; legacy frame controls are forbidden.
        duration = str(seconds)
        if duration not in {str(value) for value in range(4, 13)}:
            raise ValueError("Agnes 2.5 seconds must be 4..12")
        payload = {
            "model": model,
            "prompt": str(prompt).strip(),
            "mode": "keyframe" if image is not None else "text",
            "seconds": duration,
            "size": "720P",
        }
        if image is not None:
            frames = [image] if isinstance(image, str) else image
            if not 1 <= len(frames) <= 2 or not all(
                isinstance(item, str) and item for item in frames
            ):
                raise ValueError("Agnes 2.5 keyframes require one or two image URLs")
            payload["first_frame"] = frames[0]
            if len(frames) == 2:
                payload["last_frame"] = frames[1]
        if seed is not None:
            payload["seed"] = int(seed)
        forbidden = {
            "width",
            "height",
            "num_frames",
            "frame_rate",
            "fps",
            "num_inference_steps",
            "quality",
        }
        if extra and forbidden.intersection(extra):
            raise ValueError("Agnes 2.5 does not accept legacy frame controls")
    else:
        _validate_agnes_frames(int(num_frames))
        payload = {
            "model": model,
            "prompt": str(prompt).strip(),
            "width": int(width),
            "height": int(height),
            "num_frames": int(num_frames),
            "frame_rate": int(frame_rate),
        }
        if seed is not None:
            payload["seed"] = int(seed)
        if image is not None:
            payload.setdefault("extra_body", {})["image"] = image

    if extra:
        for key, value in extra.items():
            if key == "extra_body" and isinstance(value, dict):
                payload.setdefault("extra_body", {}).update(value)
            elif key not in payload:
                payload[key] = value

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    create_url = f"{base_url}/contents/generations/tasks" if volcano else f"{base_url}/videos"
    _LOG.info(
        "video_generate provider=%s model=%s frames=%d fps=%d size=%dx%d wait=%s",
        "volcano" if volcano else "agnes",
        model,
        num_frames,
        frame_rate,
        width,
        height,
        wait,
    )

    try:
        resp = requests.post(
            create_url,
            headers=headers,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            timeout=60,
        )
    except requests.RequestException as exc:
        raise RuntimeError(
            f"video create failed: {type(exc).__name__}: {exc}",
        ) from exc

    if resp.status_code != 200:
        body = resp.text[:500].replace("\n", " ")
        raise RuntimeError(
            f"video create error: HTTP {resp.status_code} — {body}",
        )

    data = resp.json()
    task_id = str(data.get("video_id") or data.get("task_id") or data.get("id") or "")
    if not task_id:
        raise RuntimeError(f"video create returned no task_id: {data!r}")

    initial = {
        "task_id": task_id,
        "status": str(data.get("status") or "queued"),
        "model": data.get("model") or model,
        "video_url": None,
        "size": data.get("size"),
        "seconds": data.get("seconds") or data.get("duration"),
        "progress": int(data.get("progress") or 0),
        "raw": data,
    }
    if not wait:
        return initial

    return _poll_until_done(
        task_id,
        api_key=api_key,
        base_url=base_url,
        initial=initial,
        model=model,
        max_wait_seconds=int(max_wait_seconds),
        poll_interval_seconds=float(poll_interval_seconds),
    )


def poll_video(
    task_id: str,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """One-shot status poll for a previously-submitted task."""
    if not task_id:
        raise ValueError("task_id is required")
    if api_key is None or base_url is None:
        cfg = AgnesConfig.from_env()
        api_key = api_key or cfg.api_key
        base_url = (base_url or cfg.base_url).rstrip("/")

    chosen_model = model or (VOLC_MODEL if _is_volcano(base_url) else AGNES_MODEL)
    poll_url = (
        f"{base_url}/contents/generations/tasks/{task_id}"
        if _is_volcano(base_url)
        else f"{base_url}/videos/{task_id}"
    )
    if not _is_volcano(base_url) and chosen_model in {"agnes-video-2.5", "agnes-video-2.5-flash"}:
        parts = urlsplit(base_url)
        poll_url = urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                "/agnesapi",
                urlencode(
                    {
                        "video_id": task_id,
                        "model_name": chosen_model,
                    }
                ),
                "",
            )
        )
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        resp = requests.get(poll_url, headers=headers, timeout=30)
    except requests.RequestException as exc:
        raise RuntimeError(
            f"video poll failed: {type(exc).__name__}: {exc}",
        ) from exc
    if resp.status_code != 200:
        body = resp.text[:300].replace("\n", " ")
        raise RuntimeError(
            f"video poll error: HTTP {resp.status_code} — {body}",
        )
    return _normalize_poll_response(task_id, resp.json())


def _poll_until_done(
    task_id: str,
    *,
    api_key: str,
    base_url: str,
    initial: dict[str, Any],
    model: str,
    max_wait_seconds: int,
    poll_interval_seconds: float,
) -> dict[str, Any]:
    deadline = time.time() + max_wait_seconds
    interval = poll_interval_seconds
    last = initial
    while time.time() < deadline:
        time.sleep(interval)
        interval = min(15.0, interval * 1.2)
        try:
            last = poll_video(task_id, api_key=api_key, base_url=base_url, model=model)
        except RuntimeError as exc:
            _LOG.warning("video poll transient error: %s", exc)
            continue
        status = str(last.get("status") or "").lower()
        if status in ("succeeded", "completed"):
            return last
        if status in ("failed", "expired"):
            raise RuntimeError(
                f"video task failed: {last.get('error') or last.get('raw')}",
            )
        # else: still queued / running — keep waiting
    raise TimeoutError(
        f"video task did not complete within "
        f"{max_wait_seconds}s (last status: {last.get('status')!r}, "
        f"task_id={task_id})",
    )


def _normalize_poll_response(
    task_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Project the raw poll response into a stable shape (both providers)."""
    status = str(data.get("status") or "").lower() or "unknown"
    # Volcano: video_url lives under content.video_url; Agnes: top-level.
    content = data.get("content") if isinstance(data.get("content"), dict) else {}
    video_url = (
        data.get("video_url")
        or data.get("url")
        or content.get("video_url")
        or _extract_video_url(data.get("output"))
    )
    error = data.get("error")
    if isinstance(error, dict):
        error = error.get("message") or error.get("code") or error
    return {
        "task_id": task_id,
        "status": status,
        "model": data.get("model"),
        "video_url": video_url,
        "progress": int(data.get("progress") or 0),
        "created_at": data.get("created_at"),
        "completed_at": data.get("updated_at") or data.get("completed_at"),
        "error": error,
        "raw": data,
    }


def _extract_video_url(output: Any) -> str | None:
    """Try to find a video URL inside an `output` field of varying shape."""
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        for key in ("url", "video_url", "video", "mp4_url"):
            value = output.get(key)
            if isinstance(value, str) and value:
                return value
    if isinstance(output, list):
        for entry in output:
            url = _extract_video_url(entry)
            if url:
                return url
    return None


def _ratio_from_size(width: int, height: int) -> str:
    """Map a WxH in pixels to the nearest Seedance ratio string."""
    ratios = {
        "21:9": 21 / 9,
        "16:9": 16 / 9,
        "4:3": 4 / 3,
        "1:1": 1.0,
        "3:4": 0.75,
        "9:16": 9 / 16,
    }
    if height <= 0:
        return "16:9"
    target = max(1e-6, float(width) / float(height))
    return min(ratios, key=lambda k: abs(ratios[k] - target))


def _validate_agnes_frames(num_frames: int) -> None:
    """Enforce the 8n+1 frame rule documented for agnes-video-v2.0."""
    if num_frames <= 0 or num_frames > _AGNES_MAX_FRAMES:
        raise ValueError(
            f"num_frames must be 1..{_AGNES_MAX_FRAMES}; got {num_frames}",
        )
    if (num_frames - 1) % 8 != 0:
        raise ValueError(
            f"num_frames must satisfy 8n+1 (e.g. 49, 81, 121, 161, "
            f"...); got {num_frames}. "
            "Try the closest valid value.",
        )


__all__ = ["AgnesConfig", "generate_video", "poll_video"]


if __name__ == "__main__":  # pragma: no cover — manual smoke test
    import argparse

    parser = argparse.ArgumentParser(description="Video generate (Volcano/Agnes)")
    parser.add_argument("prompt", help="Text prompt")
    parser.add_argument("--model", default=None)
    parser.add_argument("--width", type=int, default=1152)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--frames", type=int, default=49)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--no-wait", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--base-url", default=None)
    args = parser.parse_args()

    result = generate_video(
        args.prompt,
        model=args.model,
        width=args.width,
        height=args.height,
        num_frames=args.frames,
        frame_rate=args.fps,
        wait=not args.no_wait,
        max_wait_seconds=args.timeout,
        base_url=args.base_url,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
