from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

# Image-search provider adapters live in image_search_backends; the skill
# registration below keeps the private aliases as its handler names.
from .image_search_backends import (
    search_image_by_image as _search_image_by_image,
)
from .image_search_backends import (
    search_image_by_text as _search_image_by_text,
)
from .registry import Skill, SkillRegistry
from .testing import SkillExpect, SkillTestCase

try:
    import httpx  # type: ignore[import-untyped]

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]

try:
    from PIL import Image  # type: ignore[import-untyped]

    PIL_AVAILABLE = True
except ImportError:  # pragma: no cover
    PIL_AVAILABLE = False
    Image = None  # type: ignore[assignment]


from runtime.execution.suckers.kimi_media_skills import (
    _client,
    _ensure_path,
    _generate_image,
    _generate_sound_effects,
    _generate_speech,
    _generate_video,
    _get_available_voices,
    _safe_output_dir,
)


def _get_data_source_desc(source: str | None = None, **_: Any) -> dict[str, Any]:
    sources = {
        "yahoo_finance": {
            "description": "Yahoo chart API for public market OHLCV time series.",
            "params": ["symbol", "range", "interval"],
            "examples": [{"source": "yahoo_finance", "symbol": "AAPL", "range": "1mo"}],
        },
        "arxiv": {
            "description": "Arxiv Atom API for academic paper search.",
            "params": ["query", "max_results"],
            "examples": [{"source": "arxiv", "query": "graph neural networks"}],
        },
        "openalex": {
            "description": "OpenAlex public works search.",
            "params": ["query", "max_results"],
            "examples": [{"source": "openalex", "query": "large language models"}],
        },
        "crossref": {
            "description": "Crossref works search.",
            "params": ["query", "max_results"],
            "examples": [{"source": "crossref", "query": "AI chips"}],
        },
    }
    if source:
        key = source.lower()
        if key not in sources:
            return {"error": f"unknown data source: {source}", "available": sorted(sources)}
        return {"source": key, **sources[key]}
    return {"sources": sources}


def _get_data_source(
    source: str = "",
    *,
    query: str = "",
    symbol: str = "",
    range: str = "1mo",  # noqa: A002
    interval: str = "1d",
    max_results: int = 10,
    **_: Any,
) -> dict[str, Any]:
    if not HTTPX_AVAILABLE:
        return {"error": "httpx not installed"}
    key = source.lower().strip()
    max_results = max(1, min(int(max_results), 50))
    with _client() as client:
        if key == "yahoo_finance":
            return _yahoo_finance(client, symbol, range, interval)
        if key == "arxiv":
            return _arxiv_search(client, query, max_results)
        if key == "openalex":
            return _openalex_search(client, query, max_results)
        if key == "crossref":
            return _crossref_search(client, query, max_results)
    return {
        "error": f"unknown data source: {source}",
        "available": ["yahoo_finance", "arxiv", "openalex", "crossref"],
    }


def _yahoo_finance(client: Any, symbol: str, range_: str, interval: str) -> dict[str, Any]:
    if not symbol:
        return {"error": "missing symbol"}
    try:
        r = client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": range_, "interval": interval},
        )
        r.raise_for_status()
        data = r.json()
        result = (data.get("chart") or {}).get("result") or []
    except Exception as exc:  # noqa: BLE001
        return {"error": f"yahoo_finance_error: {type(exc).__name__}: {exc}"}
    if not result:
        return {"error": "no data", "symbol": symbol}
    payload = result[0]
    quote = ((payload.get("indicators") or {}).get("quote") or [{}])[0]
    timestamps = payload.get("timestamp") or []
    rows = []
    for i, ts in enumerate(timestamps):
        rows.append(
            {
                "timestamp": ts,
                "open": (quote.get("open") or [None])[i],
                "high": (quote.get("high") or [None])[i],
                "low": (quote.get("low") or [None])[i],
                "close": (quote.get("close") or [None])[i],
                "volume": (quote.get("volume") or [None])[i],
            }
        )
    return {
        "source": "yahoo_finance",
        "symbol": symbol,
        "range": range_,
        "interval": interval,
        "rows": rows,
    }


def _arxiv_search(client: Any, query: str, max_results: int) -> dict[str, Any]:
    if not query:
        return {"error": "missing query", "results": []}
    try:
        r = client.get(
            "https://export.arxiv.org/api/query",
            params={"search_query": f"all:{query}", "start": 0, "max_results": max_results},
        )
        r.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"arxiv_error: {type(exc).__name__}: {exc}", "results": []}
    entries = re.findall(r"<entry>(.*?)</entry>", r.text, flags=re.DOTALL)
    results = []
    for entry in entries:
        title = re.search(r"<title>(.*?)</title>", entry, flags=re.DOTALL)
        link = re.search(r'<link[^>]+href="([^"]+)"', entry)
        summary = re.search(r"<summary>(.*?)</summary>", entry, flags=re.DOTALL)
        results.append(
            {
                "title": html.unescape(re.sub(r"\s+", " ", title.group(1)).strip())
                if title
                else "",
                "url": link.group(1) if link else "",
                "summary": html.unescape(re.sub(r"\s+", " ", summary.group(1)).strip())[:800]
                if summary
                else "",
            }
        )
    return {"source": "arxiv", "query": query, "results": results}


def _openalex_search(client: Any, query: str, max_results: int) -> dict[str, Any]:
    if not query:
        return {"error": "missing query", "results": []}
    try:
        r = client.get(
            "https://api.openalex.org/works", params={"search": query, "per-page": max_results}
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"openalex_error: {type(exc).__name__}: {exc}", "results": []}
    results = []
    for item in (data.get("results") or [])[:max_results]:
        results.append(
            {
                "title": item.get("title") or "",
                "url": item.get("doi") or item.get("id") or "",
                "year": item.get("publication_year"),
                "cited_by_count": item.get("cited_by_count"),
            }
        )
    return {"source": "openalex", "query": query, "results": results}


def _crossref_search(client: Any, query: str, max_results: int) -> dict[str, Any]:
    if not query:
        return {"error": "missing query", "results": []}
    try:
        r = client.get(
            "https://api.crossref.org/works", params={"query": query, "rows": max_results}
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"crossref_error: {type(exc).__name__}: {exc}", "results": []}
    results = []
    for item in ((data.get("message") or {}).get("items") or [])[:max_results]:
        title = item.get("title") or [""]
        results.append(
            {
                "title": title[0] if title else "",
                "url": item.get("URL") or "",
                "doi": item.get("DOI") or "",
                "published": item.get("published-print") or item.get("published-online"),
            }
        )
    return {"source": "crossref", "query": query, "results": results}


def _screenshot_web_full_page(
    url: str = "",
    path: str = "",
    *,
    sandbox_dir: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    if not path:
        root = _safe_output_dir(None, "browser_artifacts")
        root.mkdir(parents=True, exist_ok=True)
        path = str(root / f"full-page-{int(time.time() * 1000)}.png")
    from .browser_skills import _browser_screenshot

    return _browser_screenshot(
        url=url,
        path=path,
        full_page=True,
        sandbox_dir=sandbox_dir,
        **kwargs,
    )


def _copytree_without_symlinks(src: Path, dest: Path, *ignore_names: str) -> list[str]:
    """``shutil.copytree`` that never follows (or copies) symbolic links.

    ``copytree`` dereferences symlinks by default, so a link inside a
    project (``leak -> ~/.ssh/id_rsa``) would copy the target's bytes into
    the servable deployments / snapshot area. Symlinks (and Windows
    junctions) are skipped outright; ``symlinks=True`` is a second guard.
    Returns the skipped entries relative to ``src``.
    """
    skipped: list[str] = []
    name_filter = shutil.ignore_patterns(*ignore_names) if ignore_names else None

    def _ignore(directory: str, names: list[str]) -> set[str]:
        ignored = set(name_filter(directory, names)) if name_filter else set()
        for name in names:
            if name in ignored:
                continue
            entry = Path(directory) / name
            is_junction = getattr(entry, "is_junction", None)
            if entry.is_symlink() or (callable(is_junction) and is_junction()):
                ignored.add(name)
                try:
                    skipped.append(str(entry.relative_to(src)))
                except ValueError:
                    skipped.append(str(entry))
        return ignored

    shutil.copytree(src, dest, symlinks=True, ignore=_ignore)
    return skipped


def _version_root(project_dir: str | Path) -> Path:
    digest = hashlib.sha1(
        str(Path(project_dir).resolve()).encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:12]
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / "website_versions" / digest


def _website_version_manager(
    action: str = "list",
    project_dir: str = "",
    *,
    version_id: str = "",
    label: str = "",
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    if not project_dir:
        return {"error": "missing project_dir"}
    project, err = _ensure_path(project_dir, sandbox_dir=sandbox_dir)
    if err:
        return {"error": err}
    if not project.exists() or not project.is_dir():
        return {"error": f"project_dir not found: {project}"}
    root = _version_root(project)
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "manifest.json"
    try:
        manifest = (
            json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest_path.exists()
            else {"versions": []}
        )
    except (OSError, json.JSONDecodeError):
        manifest = {"versions": []}

    if action == "list":
        return {"ok": True, "project_dir": str(project), "versions": manifest.get("versions", [])}
    if action == "snapshot":
        vid = (
            time.strftime("%Y%m%d-%H%M%S")
            + "-"
            + hashlib.sha1(os.urandom(8), usedforsecurity=False).hexdigest()[:6]
        )
        dest = root / vid
        _copytree_without_symlinks(
            project, dest, "node_modules", ".git", "dist", "build", ".next", ".vite"
        )
        record = {"id": vid, "label": label or vid, "created_at": time.time(), "path": str(dest)}
        manifest.setdefault("versions", []).insert(0, record)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"ok": True, "version": record}
    if action == "restore":
        if not version_id:
            return {"error": "missing version_id"}
        src = root / version_id
        if not src.is_dir():
            return {"error": f"version not found: {version_id}"}
        for child in project.iterdir():
            if child.name in {".git", "node_modules"}:
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
        for child in src.iterdir():
            if child.is_symlink():
                continue
            dest = project / child.name
            if child.is_dir():
                _copytree_without_symlinks(child, dest)
            else:
                shutil.copy2(child, dest)
        return {"ok": True, "restored": version_id, "project_dir": str(project)}
    if action == "delete":
        if not version_id:
            return {"error": "missing version_id"}
        shutil.rmtree(root / version_id, ignore_errors=True)
        manifest["versions"] = [
            v for v in manifest.get("versions", []) if v.get("id") != version_id
        ]
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"ok": True, "deleted": version_id}
    return {"error": f"unknown action: {action}"}


def _deploy_website(
    local_dir: str = "",
    *,
    project_dir: str = "",
    label: str = "",
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    """Publish a static site to the local Echo deployment directory."""
    source_arg = local_dir or project_dir
    if not source_arg:
        return {"error": "missing local_dir"}
    source, err = _ensure_path(source_arg, sandbox_dir=sandbox_dir)
    if err:
        return {"error": err}
    if not source.is_dir():
        return {"error": f"local_dir not found: {source}"}
    if not (source / "index.html").is_file():
        return {"error": f"index.html not found in local_dir: {source}"}

    from runtime.platform.personal_apps import read_personal_app

    try:
        app_manifest = read_personal_app(source)
    except (ValueError, OSError) as exc:
        return {"error": f"invalid app manifest: {exc}"}

    slug_base = re.sub(r"[^a-zA-Z0-9_-]+", "-", (label or source.name).strip()).strip("-")
    slug = (slug_base or "site")[:48]
    deploy_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{slug}-{uuid.uuid4().hex[:8]}"
    from runtime.platform.runtime_policy.deployments import deployments_root, record_deployment

    dest = deployments_root() / deploy_id
    skipped_links = _copytree_without_symlinks(
        source, dest, "node_modules", ".git", ".next", ".vite", "__pycache__"
    )
    base_url = (os.environ.get("ECHO_PUBLIC_BASE_URL") or "http://127.0.0.1:8310").rstrip("/")
    # The record carries the publishing principal; only its owner (or an admin
    # for legacy rows) can list or open it. The tool result keeps its shape.
    record = record_deployment(
        deploy_id=deploy_id,
        label=label or source.name,
        source=source,
        dest=dest,
        url=f"{base_url}/api/deployments/{deploy_id}/index.html",
        created_at=time.time(),
        app=app_manifest,
    )
    public_keys = ("id", "label", "source", "path", "url", "created_at")
    return {
        "ok": True,
        "deployment": {key: record[key] for key in public_keys},
        **({"app": app_manifest} if app_manifest else {}),
        **({"skipped_symlinks": skipped_links} if skipped_links else {}),
    }


def _load_image(path: str, sandbox_dir: str | None = None) -> tuple[Any, Path | None, str | None]:
    if not PIL_AVAILABLE:
        return None, None, "pillow not installed"
    p, err = _ensure_path(path, sandbox_dir=sandbox_dir)
    if err:
        return None, None, err
    if not p.is_file():
        return None, p, f"not a file: {p}"
    try:
        return Image.open(p).convert("RGBA"), p, None
    except Exception as exc:  # noqa: BLE001
        return None, p, f"image_open_failed: {type(exc).__name__}: {exc}"


def _find_asset_bbox(
    image_path: str = "",
    *,
    threshold: int = 245,
    min_area: int = 100,
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    if not image_path:
        return {"error": "missing image_path", "boxes": []}
    img, p, err = _load_image(image_path, sandbox_dir=sandbox_dir)
    if err:
        return {"error": err, "boxes": []}
    width, height = img.size
    pixels = img.load()
    visited: set[tuple[int, int]] = set()
    boxes: list[dict[str, int]] = []

    def is_fg(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        if a < 16:
            return False
        return not (r >= threshold and g >= threshold and b >= threshold)

    for y in range(height):
        for x in range(width):
            if (x, y) in visited or not is_fg(x, y):
                continue
            stack = [(x, y)]
            visited.add((x, y))
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            while stack:
                cx, cy = stack.pop()
                count += 1
                min_x, max_x = min(min_x, cx), max(max_x, cx)
                min_y, max_y = min(min_y, cy), max(max_y, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if (
                        0 <= nx < width
                        and 0 <= ny < height
                        and (nx, ny) not in visited
                        and is_fg(nx, ny)
                    ):
                        visited.add((nx, ny))
                        stack.append((nx, ny))
            area = (max_x - min_x + 1) * (max_y - min_y + 1)
            if area >= min_area and count >= min_area:
                boxes.append(
                    {
                        "x": min_x,
                        "y": min_y,
                        "width": max_x - min_x + 1,
                        "height": max_y - min_y + 1,
                        "area": area,
                    }
                )
    boxes.sort(key=lambda item: item["area"], reverse=True)
    return {"ok": True, "image_path": str(p), "width": width, "height": height, "boxes": boxes}


def _crop_and_replicate_assets_in_image(
    image_path: str = "",
    *,
    boxes: list[dict[str, int]] | None = None,
    output_dir: str = "",
    sandbox_dir: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    if not image_path:
        return {"error": "missing image_path", "assets": []}
    img, p, err = _load_image(image_path, sandbox_dir=sandbox_dir)
    if err:
        return {"error": err, "assets": []}
    if boxes is None:
        detected = _find_asset_bbox(image_path, sandbox_dir=sandbox_dir)
        if "error" in detected:
            return {"error": detected["error"], "assets": []}
        boxes = detected.get("boxes") or []
    try:
        out_dir = _safe_output_dir(output_dir or None, "image_assets", sandbox_dir=sandbox_dir)
    except PermissionError as exc:
        return {"error": str(exc), "assets": []}
    out_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    for i, box in enumerate(boxes):
        x = int(box.get("x", 0))
        y = int(box.get("y", 0))
        w = int(box.get("width", 0))
        h = int(box.get("height", 0))
        if w <= 0 or h <= 0:
            continue
        crop = img.crop((x, y, x + w, y + h))
        out_path = out_dir / f"{Path(str(p)).stem}-asset-{i + 1}.png"
        crop.save(out_path)
        assets.append({"path": str(out_path), "bbox": {"x": x, "y": y, "width": w, "height": h}})
    return {"ok": True, "image_path": str(p), "output_dir": str(out_dir), "assets": assets}


KIMI_COMPAT_SKILL_NAMES = [
    "generate_image",
    "generate_video",
    "generate_speech",
    "get_available_voices",
    "generate_sound_effects",
    "search_image_by_text",
    "search_image_by_image",
    "get_data_source_desc",
    "get_data_source",
    "deploy_website",
    "screenshot_web_full_page",
    "website_version_manager",
    "find_asset_bbox",
    "crop_and_replicate_assets_in_image",
]


def register_kimi_compat_skills(registry: SkillRegistry) -> int:
    specs: list[tuple[str, str, list[str], Any, list[SkillTestCase]]] = [
        (
            "generate_image",
            "Generate images through the server-configured media service. Echo gateway takes priority when configured. Optional model must be enabled on the server; do not invent endpoints or credentials.",
            # ``write``: may persist to a caller-chosen output_path, so the
            # executor injects the write-scope sandbox_dir and applies the
            # write-tool policy (plan mode, audit read-only, file safety).
            ["media", "image", "generate", "write"],
            _generate_image,
            [
                SkillTestCase(
                    name="missing_prompt",
                    tier="golden",
                    args={"prompt": ""},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "generate_video",
            "Generate video through the server-configured media service. Echo gateway returns an asynchronous task_id: query it with this same tool instead of submitting again. Optional model must be enabled on the server. Report queued/failed states accurately.",
            ["media", "video", "generate"],
            _generate_video,
            [
                SkillTestCase(
                    name="missing_prompt",
                    tier="golden",
                    args={"prompt": ""},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "generate_speech",
            "Generate speech via a configured TTS provider.",
            ["media", "audio", "speech", "write"],
            _generate_speech,
            [
                SkillTestCase(
                    name="missing_text",
                    tier="golden",
                    args={"text": ""},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "get_available_voices",
            "List voice ids supported by the configured TTS provider.",
            ["media", "audio", "speech"],
            _get_available_voices,
            [],
        ),
        (
            "generate_sound_effects",
            "Generate sound effects via a configured audio provider.",
            ["media", "audio", "generate"],
            _generate_sound_effects,
            [
                SkillTestCase(
                    name="missing_prompt",
                    tier="golden",
                    args={"prompt": ""},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "search_image_by_text",
            "Search the web for image candidates by text query.",
            ["web", "image", "search"],
            _search_image_by_text,
            [
                SkillTestCase(
                    name="missing_query",
                    tier="golden",
                    args={"query": ""},
                    expect=SkillExpect(schema_keys=["error", "results"]),
                )
            ],
        ),
        (
            "search_image_by_image",
            "Reverse image search through a configured provider.",
            ["web", "image", "search"],
            _search_image_by_image,
            [
                SkillTestCase(
                    name="missing_image",
                    tier="golden",
                    args={},
                    expect=SkillExpect(schema_keys=["error", "results"]),
                )
            ],
        ),
        (
            "get_data_source_desc",
            "Describe available public data-source adapters.",
            ["data", "api"],
            _get_data_source_desc,
            [],
        ),
        (
            "get_data_source",
            "Fetch data from public adapters: yahoo_finance, arxiv, openalex, crossref.",
            ["data", "api"],
            _get_data_source,
            [
                SkillTestCase(
                    name="unknown_source",
                    tier="golden",
                    args={"source": "nope"},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "deploy_website",
            "Publish a local static website directory to Echo' local deployments area.",
            ["deploy", "website", "file"],
            _deploy_website,
            [
                SkillTestCase(
                    name="missing_local_dir",
                    tier="golden",
                    args={},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "screenshot_web_full_page",
            "Capture a full-page screenshot of a URL.",
            ["web", "browser", "capture"],
            _screenshot_web_full_page,
            [
                SkillTestCase(
                    name="missing_url",
                    tier="golden",
                    args={"url": "", "path": "x.png"},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "website_version_manager",
            "Snapshot/list/restore/delete local website project versions.",
            ["web", "version", "file"],
            _website_version_manager,
            [
                SkillTestCase(
                    name="missing_project",
                    tier="golden",
                    args={"action": "list"},
                    expect=SkillExpect(schema_keys=["error"]),
                )
            ],
        ),
        (
            "find_asset_bbox",
            "Detect non-background asset bounding boxes in an image.",
            ["image", "vision", "asset"],
            _find_asset_bbox,
            [
                SkillTestCase(
                    name="missing_image",
                    tier="golden",
                    args={},
                    expect=SkillExpect(schema_keys=["error", "boxes"]),
                )
            ],
        ),
        (
            "crop_and_replicate_assets_in_image",
            "Crop detected or provided image asset boxes into PNG files.",
            ["image", "asset", "file"],
            _crop_and_replicate_assets_in_image,
            [
                SkillTestCase(
                    name="missing_image",
                    tier="golden",
                    args={},
                    expect=SkillExpect(schema_keys=["error", "assets"]),
                )
            ],
        ),
    ]
    for name, description, affinity, handler, tests in specs:
        registry.register(
            Skill(
                name=name,
                description=description,
                affinity=affinity,
                cost_profile="mid",
                trusted_source=f"skill://public/{name}",
                handler=handler,
                tests=tests,
            )
        )
    return len(specs)


__all__ = ["KIMI_COMPAT_SKILL_NAMES", "register_kimi_compat_skills"]
