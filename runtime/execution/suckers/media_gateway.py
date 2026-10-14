"""Server-owned media adapter. No credential or endpoint arguments from the agent."""

import os
from urllib.parse import quote, urlparse

import httpx


def selected() -> bool:
    return bool(os.environ.get("ECHO_MEDIA_BASE_URL") or os.environ.get("ECHO_MEDIA_API_KEY"))


def model_catalog() -> dict:
    result = {}
    for kind in ("image", "video"):
        default = os.environ.get(f"ECHO_{kind.upper()}_MODEL", "").strip()
        models = list(
            dict.fromkeys(
                x.strip()
                for x in [default, *os.environ.get(f"ECHO_{kind.upper()}_MODELS", "").split(",")]
                if x.strip()
            )
        )
        result[kind] = {
            "default": default or None,
            "models": models,
            "available": not bool(configuration_error(kind)),
        }
    return result


def configuration_error(kind: str) -> str:
    base = os.environ.get("ECHO_MEDIA_BASE_URL", "").strip()
    parsed = urlparse(base)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return "Echo 生成服务地址未配置或无效"
    if not os.environ.get("ECHO_MEDIA_API_KEY", "").strip():
        return "Echo 生成服务凭据未配置"
    if not os.environ.get(f"ECHO_{kind.upper()}_MODEL", "").strip():
        return "Echo 生成服务默认模型未配置"
    return ""


def generate(kind: str, prompt: str, *, model: str | None = None, task_id: str = "", **parameters):
    if kind not in {"image", "video"}:
        return {"ok": False, "error": "unsupported_media_kind"}
    error = configuration_error(kind)
    if error:
        return {"ok": False, "error": error}
    default = os.environ[f"ECHO_{kind.upper()}_MODEL"].strip()
    allowed = {
        default,
        *(
            x.strip()
            for x in os.environ.get(f"ECHO_{kind.upper()}_MODELS", "").split(",")
            if x.strip()
        ),
    }
    from runtime.platform.process.session import current_session

    session = current_session()
    preferences = session.metadata.get("design_capabilities", {}) if session else {}
    pinned = preferences.get(f"{kind}_model") if isinstance(preferences, dict) else None
    chosen = pinned or model or default
    if chosen not in allowed:
        return {"ok": False, "error": "所选模型未在 Echo 生成服务中启用"}
    base = os.environ["ECHO_MEDIA_BASE_URL"].rstrip("/")
    path = "/images/generations" if kind == "image" else "/videos/generations"
    if task_id:
        if kind != "video":
            return {"ok": False, "error": "unsupported_media_task"}
        path = "/videos/" + quote(task_id, safe="")
    payload = {
        "model": chosen,
        "prompt": prompt,
        **{k: v for k, v in parameters.items() if v is not None},
    }
    try:
        with httpx.Client(timeout=120, follow_redirects=False) as client:
            headers = {"Authorization": f"Bearer {os.environ['ECHO_MEDIA_API_KEY']}"}
            response = (
                client.get(base + path, headers=headers)
                if task_id
                else client.post(base + path, headers=headers, json=payload)
            )
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        # Never automatically repeat a possibly billed creation request.
        return {
            "ok": False,
            "error": "Echo 生成服务请求失败，请检查服务任务记录后再重试",
            "task_id": task_id or None,
        }
    if not isinstance(data, dict):
        return {"ok": False, "error": "Echo 生成服务返回格式无效"}
    if kind == "image":
        images = data.get("data", [])
        urls = (
            [
                item["url"]
                for item in images
                if isinstance(item, dict) and isinstance(item.get("url"), str)
            ]
            if isinstance(images, list)
            else []
        )
        if not urls:
            return {"ok": False, "error": "Echo 图片服务未返回图片 URL"}
        return {"ok": True, "provider": "echo", "model": chosen, "url": urls[0], "urls": urls}
    result = {key: data[key] for key in ("status", "progress", "video_url", "url") if key in data}
    identifier = data.get("task_id") or data.get("id") or task_id
    if not identifier and not result.get("video_url") and not result.get("url"):
        return {"ok": False, "error": "Echo 视频服务未返回任务或视频 URL"}
    return {
        "ok": data.get("status") not in {"failed", "cancelled", "canceled"},
        "provider": "echo",
        "model": chosen,
        "task_id": identifier,
        **result,
    }
