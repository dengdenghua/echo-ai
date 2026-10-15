"""广场(Square)只读代理 · ``/api/square/*``。

桌面端的「广场」和手机端读同一个广场后端(echo-mobile ``server/``)。前端只和本机同源的
``/api/square/*`` 通信:这里把白名单里的只读 GET 转发到配置的广场根地址,带短超时和响应
大小上限,不转发任何鉴权或 Cookie(匿名、只读),并把上游字段收敛成固定的响应类型。

上游根地址:环境变量 ``ECHO_SQUARE_BASE_URL``,默认 ``https://ai.echo-age.com``
(广场服务端 ``GET /config`` 下发的 ``squareBaseUrl``)。

转发白名单(全部是 GET,且不改变上游状态):

- ``/square/feed``                    灵感流(分类 / 排序 / 搜索 / 分页)
- ``/square/posts/{post_id}/comments`` 帖子评论
- ``/square/users/{user_id}``         作者主页
- ``/square/assets``                  市场 · 应用(手机小程序)
- ``/api/v1/registry/assets``         市场 · 技能 / 插件

刻意不转发:``/square/posts/{id}``(每次读取都会给浏览数 +1,帖子字段在 feed 里已经齐全)、
``/square/assets/.../download``(会累计下载量,而且是安装动作),以及所有写接口。

服务端在数据库为空时会回退到一组内置示例帖(``kind`` 为空、作者和点赞数是编的),
这里只保留 ``kind`` 为 ``post`` / ``mini-app`` 的真实内容。
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any
from urllib.parse import urljoin, urlsplit

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover - httpx ships with the runtime
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]

try:
    from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - fastapi optional at import time
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]

from pydantic import BaseModel, Field

from runtime.sensing._fastapi_guard import require_fastapi

logger = logging.getLogger(__name__)

SQUARE_BASE_ENV = "ECHO_SQUARE_BASE_URL"
DEFAULT_SQUARE_BASE_URL = "https://ai.echo-age.com"

FEED_PATH = "/square/feed"
COMMENTS_PATH = "/square/posts/{post_id}/comments"
USER_PATH = "/square/users/{user_id}"
MINI_APPS_PATH = "/square/assets"
REGISTRY_PATH = "/api/v1/registry/assets"
#: Every upstream path this proxy can reach. Requests are only ever built from these.
ALLOWED_UPSTREAM_PATHS = (FEED_PATH, COMMENTS_PATH, USER_PATH, MINI_APPS_PATH, REGISTRY_PATH)

#: The largest upstream body read (the skill registry list is ~0.2 MB).
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
CONNECT_TIMEOUT_S = 4.0
READ_TIMEOUT_S = 8.0

TOPICS = ("recommend", "automation", "efficiency", "life", "learning", "device")
FEED_SORTS = ("latest", "hot")
MARKET_KINDS = ("skill", "plugin", "app")
MARKET_SORTS = ("latest", "downloads", "trending")
POST_KINDS = ("post", "mini-app")

# Post and user ids: letters, digits and . _ : - only, so a path parameter can
# never climb out of its upstream template.
_ID_SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
_ID_PATTERN = f"^{_ID_SEGMENT}$"
_MAX_QUERY_CHARS = 64


def _template_regex(template: str) -> re.Pattern[str]:
    parts = re.split(r"(\{[a-z_]+\})", template)
    body = "".join(_ID_SEGMENT if part.startswith("{") else re.escape(part) for part in parts)
    return re.compile(f"^{body}$")


_ALLOWED_PATH_RES = tuple(_template_regex(path) for path in ALLOWED_UPSTREAM_PATHS)


def is_allowed_upstream_path(path: str) -> bool:
    """True when ``path`` is one of the allowlisted templates with valid ids filled in."""

    return any(regex.match(path) for regex in _ALLOWED_PATH_RES)


class SquarePost(BaseModel):
    id: str
    kind: str = Field(description="post = 图文帖;mini-app = 手机小程序分享帖")
    title: str = ""
    content: str = ""
    cover_url: str = ""
    images: list[str]
    tag: str = ""
    topic: str = "recommend"
    author: str = ""
    author_id: str = ""
    author_initial: str = ""
    likes_count: int = 0
    comments_count: int = 0
    favorites_count: int = 0
    views_count: int = 0
    app_ref: str = ""
    app_kind: str = ""
    price_credits: int = 0
    sub_price_credits: int = 0
    forked_from: str = ""
    created_at: int = 0


class SquareFeedResponse(BaseModel):
    posts: list[SquarePost]
    has_more: bool = False


class SquareComment(BaseModel):
    id: str
    author: str = ""
    author_id: str = ""
    content: str = ""
    parent_id: str = ""
    created_at: int = 0


class SquareCommentsResponse(BaseModel):
    comments: list[SquareComment]
    has_more: bool = False


class SquareUser(BaseModel):
    user_id: str
    nickname: str = ""
    following_count: int = 0
    followers_count: int = 0


class SquareUserResponse(BaseModel):
    user: SquareUser
    posts: list[SquarePost]


class SquareMarketItem(BaseModel):
    id: str
    slug: str = ""
    name: str = ""
    description: str = ""
    category: str = ""
    version: str = ""
    downloads: int = 0
    platforms: list[str]
    author: str = ""
    license: str = ""


class SquareMarketResponse(BaseModel):
    kind: str
    items: list[SquareMarketItem]


def resolve_square_base_url(value: str | None = None) -> str:
    """The configured Square root: an http(s) origin with an optional path, no trailing slash."""

    raw = (value if value is not None else os.environ.get(SQUARE_BASE_ENV, "")).strip()
    if not raw:
        return DEFAULT_SQUARE_BASE_URL
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.query or parts.fragment:
        logger.warning("ignoring %s=%r: not an http(s) base URL", SQUARE_BASE_ENV, raw)
        return DEFAULT_SQUARE_BASE_URL
    return raw.rstrip("/")


def _text(value: Any, limit: int = 20_000) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).strip()[:limit]


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _count(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, number)


def _media_url(value: Any, base: str) -> str:
    """An image URL the desktop may load: absolute https, or resolved against the Square root.

    Relative upload paths (``/static/…``) belong to the Square host. Anything else that is not
    https (data:, javascript:, plain http on another host) is dropped.
    """

    raw = _text(value, 2048)
    if not raw:
        return ""
    resolved = urljoin(base + "/", raw)
    parts = urlsplit(resolved)
    if parts.scheme == "https" and parts.netloc:
        return resolved
    base_parts = urlsplit(base)
    if parts.scheme == base_parts.scheme and parts.netloc == base_parts.netloc:
        return resolved
    return ""


def _post(raw: Any, base: str) -> SquarePost | None:
    if not isinstance(raw, dict):
        return None
    post_id = _text(raw.get("id"), 200)
    kind = _text(raw.get("kind"), 32)
    if not post_id or kind not in POST_KINDS:
        return None
    images = [
        url for url in (_media_url(item, base) for item in _list(raw.get("images"))[:12]) if url
    ]
    cover = _media_url(raw.get("coverUrl"), base) or (images[0] if images else "")
    author = _text(raw.get("author"), 80)
    topic = _text(raw.get("topic"), 32)
    return SquarePost(
        id=post_id,
        kind=kind,
        title=_text(raw.get("title"), 300),
        content=_text(raw.get("content")),
        cover_url=cover,
        images=images,
        tag=_text(raw.get("tag"), 40),
        topic=topic if topic in TOPICS else "recommend",
        author=author,
        author_id=_text(raw.get("authorId"), 128),
        author_initial=_text(raw.get("authorInitial"), 4) or author[:1],
        likes_count=_count(raw.get("likesCount")),
        comments_count=_count(raw.get("commentsCount")),
        favorites_count=_count(raw.get("favoritesCount")),
        views_count=_count(raw.get("viewsCount")),
        app_ref=_text(raw.get("appRef"), 128),
        app_kind=_text(raw.get("appKind"), 32),
        price_credits=_count(raw.get("priceCredits")),
        sub_price_credits=_count(raw.get("subPriceCredits")),
        forked_from=_text(raw.get("forkedFrom"), 200),
        created_at=_count(raw.get("createdAt")),
    )


def _posts(raw: Any, base: str) -> list[SquarePost]:
    if not isinstance(raw, list):
        return []
    return [post for post in (_post(item, base) for item in raw) if post is not None]


def _comment(raw: Any) -> SquareComment | None:
    if not isinstance(raw, dict):
        return None
    comment_id = _text(raw.get("id"), 200)
    if not comment_id:
        return None
    return SquareComment(
        id=comment_id,
        author=_text(raw.get("author"), 80),
        author_id=_text(raw.get("authorId"), 128),
        content=_text(raw.get("content"), 4000),
        parent_id=_text(raw.get("parentId"), 200),
        created_at=_count(raw.get("createdAt")),
    )


def _market_item(raw: Any, kind: str) -> SquareMarketItem | None:
    if not isinstance(raw, dict):
        return None
    item_id = _text(raw.get("id"), 200)
    if not item_id:
        return None
    category = _text(raw.get("category"), 60)
    # The registry tags every skill with the category "skill": that is the type, not a category.
    if category.lower() in ("skill", "plugin"):
        category = ""
    platforms = _list(raw.get("platforms"))
    return SquareMarketItem(
        id=item_id,
        slug=_text(raw.get("slug"), 128) or item_id.rsplit("/", 1)[-1],
        name=_text(raw.get("name"), 200),
        description=_text(raw.get("description"), 2000),
        category=category,
        version=_text(raw.get("version"), 40),
        downloads=_count(raw.get("download_count")) if kind == "app" else 0,
        platforms=[_text(item, 20) for item in platforms[:4] if _text(item, 20)],
        author=_text(raw.get("author"), 80),
        license=_text(raw.get("license"), 80),
    )


def create_square_router(
    *,
    base_url: str | None = None,
    transport: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> Any:
    """Build the ``/api/square`` read-only proxy.

    ``base_url`` overrides ``ECHO_SQUARE_BASE_URL``; ``transport`` is an httpx transport
    (tests pass ``httpx.MockTransport`` so no request leaves the process).
    """

    require_fastapi(__name__)
    base = resolve_square_base_url(base_url)
    timeout = httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S)

    def _auth_dep(request: Request) -> None:
        if not require_auth:
            return
        from runtime.adapters.web_auth import _resolve_actor

        _resolve_actor(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )  # AUTH-OK: actor-agnostic; public read-only Square content, never forwarded upstream

    router = APIRouter(prefix="/api/square", tags=["square"], dependencies=[Depends(_auth_dep)])

    async def _get_json(path: str, params: dict[str, str | int]) -> Any:
        if not is_allowed_upstream_path(path):
            raise HTTPException(500, "square_path_not_allowed")
        body = bytearray()
        try:
            async with (
                httpx.AsyncClient(
                    transport=transport,
                    timeout=timeout,
                    follow_redirects=False,
                    headers={"Accept": "application/json", "User-Agent": "ECHO-Square/1"},
                ) as client,
                client.stream("GET", base + path, params=params) as response,
            ):
                if response.status_code == 404:
                    raise HTTPException(404, "square_not_found")
                if response.status_code != 200:
                    logger.info("square upstream %s answered %s", path, response.status_code)
                    raise HTTPException(502, "square_upstream_error")
                declared = response.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                    raise HTTPException(502, "square_response_too_large")
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise HTTPException(502, "square_response_too_large")
        except httpx.TimeoutException as exc:
            logger.info("square upstream %s timed out: %s", path, exc)
            raise HTTPException(504, "square_timeout") from exc
        except httpx.HTTPError as exc:
            logger.info("square upstream %s unreachable: %s", path, exc)
            raise HTTPException(502, "square_unreachable") from exc
        try:
            return json.loads(body)
        except ValueError as exc:
            raise HTTPException(502, "square_bad_response") from exc

    @router.get("/feed", response_model=SquareFeedResponse)
    async def square_feed(
        topic: str = Query(default="recommend", max_length=32),
        sort: str = Query(default="latest", max_length=16),
        q: str = Query(default="", max_length=_MAX_QUERY_CHARS),
        limit: int = Query(default=20, ge=1, le=50),
        offset: int = Query(default=0, ge=0, le=5000),
    ) -> SquareFeedResponse:
        """灵感流:同手机「广场 · 灵感」,匿名读取。"""

        params: dict[str, str | int] = {"limit": limit, "offset": offset}
        if topic in TOPICS and topic != "recommend":
            params["topic"] = topic
        if sort == "hot":
            params["sort"] = "hot"
        if q.strip():
            params["q"] = q.strip()
        payload = await _get_json(FEED_PATH, params)
        if not isinstance(payload, dict):
            raise HTTPException(502, "square_bad_response")
        return SquareFeedResponse(
            posts=_posts(payload.get("posts"), base),
            has_more=bool(payload.get("has_more")),
        )

    @router.get("/posts/{post_id}/comments", response_model=SquareCommentsResponse)
    async def square_post_comments(
        post_id: str = Path(pattern=_ID_PATTERN),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=5000),
    ) -> SquareCommentsResponse:
        """帖子评论(只读)。"""

        payload = await _get_json(
            COMMENTS_PATH.format(post_id=post_id), {"limit": limit, "offset": offset}
        )
        if not isinstance(payload, dict):
            raise HTTPException(502, "square_bad_response")
        raw = _list(payload.get("comments"))
        return SquareCommentsResponse(
            comments=[item for item in (_comment(entry) for entry in raw) if item is not None],
            has_more=bool(payload.get("has_more")),
        )

    @router.get("/users/{user_id}", response_model=SquareUserResponse)
    async def square_user(user_id: str = Path(pattern=_ID_PATTERN)) -> SquareUserResponse:
        """作者主页:昵称、关注/粉丝数和 TA 的帖子。"""

        payload = await _get_json(USER_PATH.format(user_id=user_id), {})
        user = payload.get("user") if isinstance(payload, dict) else None
        if not isinstance(user, dict):
            raise HTTPException(502, "square_bad_response")
        return SquareUserResponse(
            user=SquareUser(
                user_id=_text(user.get("userId"), 128) or user_id,
                nickname=_text(user.get("nickname"), 80),
                following_count=_count(user.get("followingCount")),
                followers_count=_count(user.get("followersCount")),
            ),
            posts=_posts(payload.get("posts"), base),
        )

    @router.get("/market", response_model=SquareMarketResponse)
    async def square_market(
        kind: str = Query(default="skill", pattern="^(skill|plugin|app)$"),
        sort: str = Query(default="latest", pattern="^(latest|downloads|trending)$"),
    ) -> SquareMarketResponse:
        """市场:技能 / 插件来自技能注册表,应用是广场上审核通过的手机小程序。"""

        if kind == "app":
            params: dict[str, str | int] = {"type": "plugin", "kind": "mini-app"}
            if sort != "latest":
                params["sort"] = sort
            payload = await _get_json(MINI_APPS_PATH, params)
        else:
            payload = await _get_json(REGISTRY_PATH, {"type": kind})
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise HTTPException(502, "square_bad_response")
        items = [item for item in (_market_item(entry, kind) for entry in payload["data"]) if item]
        return SquareMarketResponse(kind=kind, items=items)

    return router


def mount_square_router(ctx: Any) -> None:
    """Mount the proxy on the app being assembled by ``create_app``."""

    ctx.app.include_router(
        create_square_router(
            identity_store=ctx.identity_store,
            require_auth=ctx.require_auth,
            jwt_secret=ctx.jwt_secret,
            jwt_issuer=ctx.jwt_issuer,
            jwt_audience=ctx.jwt_audience,
        )
    )


__all__ = [
    "ALLOWED_UPSTREAM_PATHS",
    "DEFAULT_SQUARE_BASE_URL",
    "MAX_RESPONSE_BYTES",
    "SQUARE_BASE_ENV",
    "create_square_router",
    "is_allowed_upstream_path",
    "mount_square_router",
    "resolve_square_base_url",
]
