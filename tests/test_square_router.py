"""The /api/square read-only proxy: allowlist, limits, normalization, no auth forwarding.

Every test runs against ``httpx.MockTransport``; no request leaves the process.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.sensing.gateway import square_router
from runtime.sensing.gateway.square_router import (
    DEFAULT_SQUARE_BASE_URL,
    MAX_RESPONSE_BYTES,
    create_square_router,
    is_allowed_upstream_path,
    resolve_square_base_url,
)

BASE = "https://square.example"


def _post(**overrides: Any) -> dict[str, Any]:
    post = {
        "id": "p1",
        "kind": "post",
        "title": "Weekly report",
        "content": "Body",
        "coverUrl": "/static/cover.webp",
        "images": ["/static/cover.webp", "javascript:alert(1)", "http://elsewhere.example/a.png"],
        "tag": "Work",
        "topic": "efficiency",
        "author": "ECHO",
        "authorId": "abc123",
        "authorInitial": "E",
        "authorColor": "#7C6FF0",
        "coverGradient": ["#667EEA", "#764BA2"],
        "likesCount": 3,
        "commentsCount": 2,
        "favoritesCount": 1,
        "viewsCount": 9,
        "appRef": "",
        "appKind": "",
        "priceCredits": 0,
        "subPriceCredits": 0,
        "createdAt": 1_700_000_000_000,
    }
    post.update(overrides)
    return post


class Upstream:
    """Records requests and answers from a route table."""

    def __init__(self, routes: dict[str, Any]) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.routes.get(request.url.path)
        if answer is None:
            return httpx.Response(404, json={"detail": "not found"})
        if isinstance(answer, httpx.Response):
            return answer
        if callable(answer):
            return answer(request)
        return httpx.Response(200, json=answer)


def _client(upstream: Any, **kwargs: Any) -> TestClient:
    app = FastAPI()
    app.include_router(
        create_square_router(
            base_url=kwargs.pop("base_url", BASE),
            transport=httpx.MockTransport(upstream),
            **kwargs,
        )
    )
    return TestClient(app)


def test_feed_forwards_only_known_params_and_never_auth() -> None:
    upstream = Upstream({"/square/feed": {"posts": [_post()], "has_more": True}})
    client = _client(upstream)

    response = client.get(
        "/api/square/feed",
        params={"topic": "life", "sort": "hot", "q": "  report ", "limit": 10, "offset": 20},
        headers={"Authorization": "Bearer local-token", "Cookie": "session=secret"},
    )

    assert response.status_code == 200
    sent = upstream.requests[0]
    assert str(sent.url).startswith(f"{BASE}/square/feed?")
    assert dict(sent.url.params) == {
        "limit": "10",
        "offset": "20",
        "topic": "life",
        "sort": "hot",
        "q": "report",
    }
    assert "authorization" not in sent.headers
    assert "cookie" not in sent.headers
    assert sent.method == "GET"


def test_feed_ignores_unknown_topic_and_default_sort() -> None:
    upstream = Upstream({"/square/feed": {"posts": []}})
    response = _client(upstream).get(
        "/api/square/feed", params={"topic": "../admin", "sort": "random"}
    )
    assert response.status_code == 200
    assert dict(upstream.requests[0].url.params) == {"limit": "20", "offset": "0"}
    assert response.json() == {"posts": [], "has_more": False}


def test_feed_normalizes_posts_and_drops_made_up_examples() -> None:
    legacy_example = {"id": "s1", "title": "Seed", "author": "Made up", "likes": "1.2k"}
    mini_app = _post(
        id="plugin/seed-ledger",
        kind="mini-app",
        coverUrl="",
        images=[],
        appRef="seed-ledger",
        appKind="mini-app",
        topic="not-a-topic",
    )
    upstream = Upstream(
        {"/square/feed": {"posts": [_post(), legacy_example, mini_app], "has_more": False}}
    )

    body = _client(upstream).get("/api/square/feed").json()

    assert [post["id"] for post in body["posts"]] == ["p1", "plugin/seed-ledger"]
    first = body["posts"][0]
    assert first["cover_url"] == f"{BASE}/static/cover.webp"
    assert first["images"] == [f"{BASE}/static/cover.webp"]
    assert first["likes_count"] == 3
    assert first["author_id"] == "abc123"
    assert "authorColor" not in first and "coverGradient" not in first
    assert body["posts"][1]["topic"] == "recommend"
    assert body["posts"][1]["cover_url"] == ""


def test_absolute_https_images_on_other_hosts_are_kept() -> None:
    upstream = Upstream(
        {"/square/feed": {"posts": [_post(coverUrl="https://cdn.example/t.png", images=[])]}}
    )
    body = _client(upstream).get("/api/square/feed").json()
    assert body["posts"][0]["cover_url"] == "https://cdn.example/t.png"


def test_unreachable_upstream_is_502() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    response = _client(refuse).get("/api/square/feed")
    assert response.status_code == 502
    assert response.json()["detail"] == "square_unreachable"


def test_timeout_is_504() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    response = _client(slow).get("/api/square/feed")
    assert response.status_code == 504
    assert response.json()["detail"] == "square_timeout"


def test_upstream_error_status_and_redirects_are_not_passed_through() -> None:
    for answer in (
        httpx.Response(500, json={"detail": "boom"}),
        httpx.Response(302, headers={"Location": "https://evil.example/"}),
    ):
        upstream = Upstream({"/square/feed": answer})
        response = _client(upstream).get("/api/square/feed")
        assert response.status_code == 502
        assert response.json()["detail"] == "square_upstream_error"
        assert len(upstream.requests) == 1


def test_oversized_and_invalid_bodies_are_rejected() -> None:
    too_big = httpx.Response(200, content=b"x" * (MAX_RESPONSE_BYTES + 1))
    response = _client(Upstream({"/square/feed": too_big})).get("/api/square/feed")
    assert response.status_code == 502
    assert response.json()["detail"] == "square_response_too_large"

    not_json = httpx.Response(200, content=b"<html>maintenance</html>")
    response = _client(Upstream({"/square/feed": not_json})).get("/api/square/feed")
    assert response.status_code == 502
    assert response.json()["detail"] == "square_bad_response"


def test_comments_are_read_only_and_ids_cannot_escape_the_template() -> None:
    upstream = Upstream(
        {
            "/square/posts/p1/comments": {
                "comments": [
                    {
                        "id": "c1",
                        "author": "A",
                        "authorId": "u1",
                        "content": "Nice",
                        "createdAt": 5,
                    },
                    {"content": "no id"},
                ],
                "has_more": False,
            }
        }
    )
    client = _client(upstream)

    body = client.get("/api/square/posts/p1/comments").json()
    assert body["comments"] == [
        {
            "id": "c1",
            "author": "A",
            "author_id": "u1",
            "content": "Nice",
            "parent_id": "",
            "created_at": 5,
        }
    ]
    assert dict(upstream.requests[0].url.params) == {"limit": "50", "offset": "0"}

    for bad in ("..", "p1%2F..%2F..%2Fadmin", "%2E%2E"):
        assert client.get(f"/api/square/posts/{bad}/comments").status_code in (404, 422)
    assert len(upstream.requests) == 1


def test_user_profile_and_missing_user() -> None:
    upstream = Upstream(
        {
            "/square/users/abc123": {
                "user": {
                    "userId": "abc123",
                    "nickname": "ECHO",
                    "followingCount": 1,
                    "followersCount": 2,
                    "isFollowing": True,
                },
                "posts": [_post()],
            }
        }
    )
    client = _client(upstream)
    body = client.get("/api/square/users/abc123").json()
    assert body["user"] == {
        "user_id": "abc123",
        "nickname": "ECHO",
        "following_count": 1,
        "followers_count": 2,
    }
    assert [post["id"] for post in body["posts"]] == ["p1"]

    missing = client.get("/api/square/users/nobody")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "square_not_found"


def test_market_maps_kinds_to_the_two_catalogs() -> None:
    registry_item = {
        "id": "skill/pdf",
        "name": "pdf",
        "description": "Read PDFs",
        "category": "skill",
        "version": "1",
        "icon": "x",
        "author": "echo",
        "platforms": ["mobile", "desktop"],
        "download_count": 99,
    }
    app_item = {
        "id": "plugin/seed-ledger",
        "slug": "seed-ledger",
        "name": "Ledger",
        "category": "Finance",
        "platforms": ["mobile"],
        "download_count": 61,
    }
    upstream = Upstream(
        {
            "/api/v1/registry/assets": {"success": True, "data": [registry_item]},
            "/square/assets": {"success": True, "data": [app_item]},
        }
    )
    client = _client(upstream)

    skills = client.get("/api/square/market", params={"kind": "skill"}).json()
    assert skills["kind"] == "skill"
    assert skills["items"][0]["category"] == ""
    assert skills["items"][0]["downloads"] == 0
    assert skills["items"][0]["slug"] == "pdf"
    assert dict(upstream.requests[-1].url.params) == {"type": "skill"}

    apps = client.get("/api/square/market", params={"kind": "app", "sort": "downloads"}).json()
    assert apps["items"][0]["downloads"] == 61
    assert apps["items"][0]["platforms"] == ["mobile"]
    assert upstream.requests[-1].url.path == "/square/assets"
    assert dict(upstream.requests[-1].url.params) == {
        "type": "plugin",
        "kind": "mini-app",
        "sort": "downloads",
    }

    assert client.get("/api/square/market", params={"kind": "agent"}).status_code == 422
    assert client.get("/api/square/market", params={"sort": "price"}).status_code == 422


def test_base_url_comes_from_env_and_rejects_non_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(square_router.SQUARE_BASE_ENV, raising=False)
    assert resolve_square_base_url() == DEFAULT_SQUARE_BASE_URL
    monkeypatch.setenv(square_router.SQUARE_BASE_ENV, "http://127.0.0.1:8081/")
    assert resolve_square_base_url() == "http://127.0.0.1:8081"
    monkeypatch.setenv(square_router.SQUARE_BASE_ENV, "file:///etc/passwd")
    assert resolve_square_base_url() == DEFAULT_SQUARE_BASE_URL
    assert resolve_square_base_url("https://square.example/root/") == "https://square.example/root"


def test_allowlist_matches_only_the_five_read_paths() -> None:
    for path in (
        "/square/feed",
        "/square/posts/p1/comments",
        "/square/users/abc123",
        "/square/assets",
        "/api/v1/registry/assets",
    ):
        assert is_allowed_upstream_path(path), path
    for path in (
        "/square/posts/p1",
        "/square/posts/p1/like",
        "/square/assets/plugin/seed-ledger/download",
        "/square/posts/../users/x/comments",
        "/square/notifications",
        "/config",
    ):
        assert not is_allowed_upstream_path(path), path


def test_requires_auth_when_the_host_does() -> None:
    upstream = Upstream({"/square/feed": {"posts": []}})
    response = _client(upstream, require_auth=True).get("/api/square/feed")
    assert response.status_code == 401
    assert upstream.requests == []


def test_response_models_are_json_serializable_snapshot_shape() -> None:
    upstream = Upstream({"/square/feed": {"posts": [_post()], "has_more": False}})
    body = _client(upstream).get("/api/square/feed").json()
    assert set(body["posts"][0]) == {
        "id",
        "kind",
        "title",
        "content",
        "cover_url",
        "images",
        "tag",
        "topic",
        "author",
        "author_id",
        "author_initial",
        "likes_count",
        "comments_count",
        "favorites_count",
        "views_count",
        "app_ref",
        "app_kind",
        "price_credits",
        "sub_price_credits",
        "forked_from",
        "created_at",
    }
    json.dumps(body)
