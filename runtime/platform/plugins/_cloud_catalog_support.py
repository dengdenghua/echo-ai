"""Module-level paths, limits, and HTTP helpers for the cloud catalog.

Lives below ``cloud_catalog`` and its mixins so all of them can import these
without a cycle.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from runtime.platform.plugins._secure_fetch import fetch_public_https_bytes
from runtime.platform.plugins.host_api import HOST_API_VERSION as HOST_API_VERSION
from runtime.platform.plugins.install_errors import ContentPackUnavailableError
from runtime.platform.process.paths import app_paths

REPO = Path(__file__).resolve().parents[3]
LOCAL_MIRROR_DIR = REPO / "extensions" / "workbuddy-experts" / "storefront" / "data"
CACHE_DIR = app_paths().data_dir / "cache"

_log = logging.getLogger(__name__)


def _download_content_pack(url: str, *, timeout: float, max_bytes: int) -> bytes:
    """Fetch a content pack, turning transport failures into a readable error.

    A missing release used to surface as an unhandled 500 with an httpx
    traceback, which the UI could only show as "HTTP 500".
    """
    try:
        return fetch_public_https_bytes(url, timeout=timeout, max_bytes=max_bytes)
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        _log.warning("content pack download failed: HTTP %s for %s", status, url)
        if status == 404:
            raise ContentPackUnavailableError("应用安装包尚未在云端发布，暂时无法安装。") from exc
        raise ContentPackUnavailableError(
            f"应用安装包下载失败（HTTP {status}），请稍后重试。"
        ) from exc
    except (httpx.HTTPError, OSError) as exc:
        _log.warning("content pack download failed for %s: %s", url, exc)
        raise ContentPackUnavailableError("无法连接应用下载服务，请检查网络后重试。") from exc


_REMOTE_BASE = os.environ.get(
    "ECHO_CLOUD_STORE_URL",
    "https://ai.echo-age.com/marketplace",
)

_MAX_CATALOG_BYTES = 8 * 1024 * 1024
# The first-party plugin content pack is currently about 140 MiB. Keep enough
# headroom for reviewed built-ins to grow without turning remote reinstall into
# a server error, while retaining a strict bound below the extracted-size cap.
_MAX_ARCHIVE_BYTES = 192 * 1024 * 1024
_MAX_ARCHIVE_MEMBERS = 10_000
_MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
_MAX_MEMBER_BYTES = 64 * 1024 * 1024


def _load_remote(name: str) -> dict[str, Any] | None:
    try:
        body = fetch_public_https_bytes(
            f"{_REMOTE_BASE.rstrip('/')}/{name}",
            timeout=15,
            max_bytes=_MAX_CATALOG_BYTES,
        )
        return json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None
