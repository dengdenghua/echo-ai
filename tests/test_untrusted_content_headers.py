"""User/agent-generated files served from the API origin must be sandboxed.

A prompt-injected agent can write ``report.svg`` / ``index.html`` with
``<script>``; rendered same-origin it would read the session token or call
admin APIs.  Every inline response for such content carries
``Content-Security-Policy: sandbox`` (opaque origin, never
``allow-same-origin``) plus ``X-Content-Type-Options: nosniff``.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers import storage_skills
from runtime.sensing.gateway import deployments_router
from runtime.sensing.gateway._untrusted_content import (
    SANDBOX_CSP,
    SANDBOX_SCRIPTS_CSP,
    untrusted_content_headers,
)
from runtime.sensing.gateway.storage_proxy_router import create_storage_proxy_router
from runtime.sensing.gateway.workspaces_router import create_workspaces_router

_SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def _sandbox_flags(csp: str) -> set[str]:
    directive = next(part.strip() for part in csp.split(";") if part.strip().startswith("sandbox"))
    return set(directive.split()[1:])


# ── helper ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "media_type",
    [
        "image/svg+xml",
        "text/xml",
        "application/xml",
        "application/xhtml+xml",
        "text/html; charset=utf-8",
        "application/x-unknown",
        None,
    ],
)
def test_active_and_unknown_types_are_sandboxed_without_scripts(media_type: str | None) -> None:
    headers = untrusted_content_headers(media_type)

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Security-Policy"] == SANDBOX_CSP
    assert _sandbox_flags(headers["Content-Security-Policy"]) == set()


def test_allow_scripts_only_relaxes_html_and_never_grants_same_origin() -> None:
    html = untrusted_content_headers("text/html", allow_scripts=True)
    svg = untrusted_content_headers("image/svg+xml", allow_scripts=True)

    assert html["Content-Security-Policy"] == SANDBOX_SCRIPTS_CSP
    assert "allow-scripts" in _sandbox_flags(SANDBOX_SCRIPTS_CSP)
    assert "allow-same-origin" not in _sandbox_flags(SANDBOX_SCRIPTS_CSP)
    assert svg["Content-Security-Policy"] == SANDBOX_CSP


def test_pdf_and_downloads_skip_the_sandbox_but_keep_nosniff() -> None:
    assert untrusted_content_headers("application/pdf") == {"X-Content-Type-Options": "nosniff"}
    assert untrusted_content_headers("image/svg+xml", download=True) == {
        "X-Content-Type-Options": "nosniff"
    }


def test_sandbox_policies_keep_same_origin_framing_only() -> None:
    for csp in (SANDBOX_CSP, SANDBOX_SCRIPTS_CSP):
        assert "frame-ancestors 'self'" in csp


# ── workspace outputs ─────────────────────────────────────────────────────


def _workspace_client(root: Path) -> TestClient:
    app = FastAPI()
    app.include_router(create_workspaces_router(workspace_root=root))
    return TestClient(app)


def test_workspace_output_svg_is_sandboxed_without_scripts(tmp_path: Path) -> None:
    client = _workspace_client(tmp_path)
    client.get("/api/workspaces/th-svg")
    (tmp_path.resolve() / "th-svg" / "output" / "report.svg").write_bytes(_SVG)

    response = client.get("/api/threads/th-svg/outputs/report.svg")

    assert response.status_code == 200
    assert response.headers["content-security-policy"] == SANDBOX_CSP
    assert response.headers["x-content-type-options"] == "nosniff"


def test_workspace_output_html_runs_scripts_in_an_opaque_origin(tmp_path: Path) -> None:
    client = _workspace_client(tmp_path)
    client.get("/api/workspaces/th-html")
    (tmp_path.resolve() / "th-html" / "output" / "report.html").write_text(
        "<script>fetch('/api/admin')</script>", encoding="utf-8"
    )

    response = client.get("/api/workspaces/th-html/outputs/report.html")

    csp = response.headers["content-security-policy"]
    assert csp == SANDBOX_SCRIPTS_CSP
    assert "allow-same-origin" not in _sandbox_flags(csp)


def test_workspace_output_download_is_an_attachment(tmp_path: Path) -> None:
    client = _workspace_client(tmp_path)
    client.get("/api/workspaces/th-dl")
    (tmp_path.resolve() / "th-dl" / "output" / "report.svg").write_bytes(_SVG)

    response = client.get("/api/workspaces/th-dl/outputs/report.svg?download=true")

    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in response.headers


# ── deployments ───────────────────────────────────────────────────────────


@pytest.fixture
def deployments_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "deployments"
    site = root / "20260927-demo"
    site.mkdir(parents=True)
    (site / "index.html").write_text("<script>1</script>", encoding="utf-8")
    (site / "logo.svg").write_bytes(_SVG)
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "deployments": [
                    {
                        "id": "20260927-demo",
                        "label": "demo",
                        "source": "C:/Users/someone/project",
                        "path": str(site),
                        "url": "http://127.0.0.1:8310/api/deployments/20260927-demo/index.html",
                        "created_at": 1.0,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(deployments_router, "_deployments_root", lambda: root)
    return root


def _deployments_client() -> TestClient:
    app = FastAPI()
    app.include_router(deployments_router.create_deployments_router())
    return TestClient(app)


def test_deployment_site_runs_scripts_only_in_an_opaque_origin(deployments_root: Path) -> None:
    client = _deployments_client()

    for url in ("/api/deployments/20260927-demo", "/api/deployments/20260927-demo/index.html"):
        response = client.get(url)
        assert response.status_code == 200
        assert response.headers["content-security-policy"] == SANDBOX_SCRIPTS_CSP
        assert response.headers["x-content-type-options"] == "nosniff"

    svg = client.get("/api/deployments/20260927-demo/logo.svg")
    assert svg.headers["content-security-policy"] == SANDBOX_CSP


def test_deployment_list_omits_absolute_server_paths(deployments_root: Path) -> None:
    response = _deployments_client().get("/api/deployments")

    assert response.status_code == 200
    assert response.json() == {
        "deployments": [
            {
                "id": "20260927-demo",
                "label": "demo",
                "url": "http://127.0.0.1:8310/api/deployments/20260927-demo/index.html",
                "created_at": 1.0,
            }
        ]
    }


# ── storage proxy ─────────────────────────────────────────────────────────


class _AsyncBytes(httpx.AsyncByteStream):
    def __init__(self, content: bytes) -> None:
        self.content = content

    async def __aiter__(self):
        yield self.content


def test_storage_proxy_sandboxes_stored_svg(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(storage_skills, "_base_url", lambda: "http://127.0.0.1:8767")
    monkeypatch.setattr(storage_skills, "_storage_token", lambda: "private-storage-token")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, stream=_AsyncBytes(_SVG), headers={"Content-Type": "image/svg+xml"}
        )

    app = FastAPI()
    app.include_router(
        create_storage_proxy_router(
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )
    )
    response = TestClient(app).get("/api/storage/v1/files/x/content")

    assert response.status_code == 200
    assert response.headers["content-security-policy"] == SANDBOX_CSP
    assert response.headers["x-content-type-options"] == "nosniff"
