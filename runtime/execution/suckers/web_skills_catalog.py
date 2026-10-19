"""Split out of :mod:`web_skills` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import os
import re
import threading
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from runtime.execution.suckers._html_text import _strip_html_fallback as _strip_html_fallback

try:
    import trafilatura  # type: ignore[import-untyped]

    TRAFILATURA_AVAILABLE = True
except ImportError:  # pragma: no cover
    TRAFILATURA_AVAILABLE = False
    trafilatura = None  # type: ignore[assignment]


try:
    import httpx  # type: ignore[import-untyped]

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]


def _extract_main_content(html: str, url: str) -> dict[str, Any] | None:
    if not TRAFILATURA_AVAILABLE or not html:
        return None
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        text = trafilatura.extract(
            html,
            url=url,
            favor_precision=True,
            include_comments=False,
            include_tables=True,
            with_metadata=False,
        )
    except (OSError, ValueError):
        return None
    if not text:
        return None
    meta_dict: dict[str, Any] = {}
    if meta is not None:
        as_dict = meta.as_dict() if hasattr(meta, "as_dict") else {}
        for key in ("title", "author", "date", "sitename", "description", "language"):
            val = as_dict.get(key)
            if val:
                meta_dict[key] = val
    return {"text": text, "metadata": meta_dict}


def _fetch_url(
    url: str = "",
    *,
    timeout_ms: int = 5000,
    max_bytes: int = 100_000,
    client: Any = None,
    allow_private: bool = False,
    extract: bool = False,
    retries: int = 2,
    **_kw: Any,
) -> dict[str, Any]:
    if not url:
        return {"error": "missing url"}

    from runtime.safety.auth.url_guard import check_url

    verdict = check_url(url, allow_private=allow_private)
    if not verdict.allow:
        return {
            "error": f"ssrf_blocked: {verdict.reason}",
            "url": url,
            "blocked": True,
        }

    pinned_fetch = client is None
    if client is None and not HTTPX_AVAILABLE:
        return {"error": "httpx not installed"}

    max_attempts = max(1, min(int(retries) + 1, 4))
    attempt_count = 0
    last_retryable = False
    resp = None
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        attempt_count += 1
        try:
            if pinned_fetch:
                from runtime.safety.auth.url_guard import safe_httpx_get

                resp = safe_httpx_get(
                    url,
                    timeout=timeout_ms / 1000,
                    allow_private=allow_private,
                    follow_redirects=False,
                )
            else:
                resp = client.get(url)
            break
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            label = f"{type(exc).__name__}: {exc}".lower()
            retryable = any(
                marker in label
                for marker in (
                    "ssl",
                    "tls",
                    "unexpected_eof",
                    "eof_while_reading",
                    "connection reset",
                    "remoteprotocolerror",
                    "readerror",
                    "connecterror",
                    "timeout",
                )
            )
            last_retryable = retryable
            if not retryable or attempt + 1 >= max_attempts:
                break
            time.sleep(0.15 * (attempt + 1))
    if resp is None:
        assert last_error is not None
        return {
            "error": f"http_error: {type(last_error).__name__}: {last_error}",
            "error_type": "network_error",
            "retryable": last_retryable,
            "attempts": attempt_count,
        }

    raw = resp.text
    result: dict[str, Any] = {
        "url": str(resp.url),
        "status_code": resp.status_code,
        "content_type": resp.headers.get("content-type", ""),
        "length": len(raw),
    }

    if extract:
        extracted = _extract_main_content(raw, str(resp.url))
        if extracted is not None:
            text = extracted["text"]
            truncated = len(text) > max_bytes
            if truncated:
                text = text[:max_bytes]
            result.update(
                {
                    "extracted": True,
                    "truncated": truncated,
                    "content": text,
                    "metadata": extracted["metadata"],
                }
            )
            return result
        result["extract_failed"] = (
            "trafilatura_unavailable" if not TRAFILATURA_AVAILABLE else "no_main_content"
        )

    body = raw
    truncated = len(body) > max_bytes
    if truncated:
        body = body[:max_bytes]
    result.update(
        {
            "extracted": False,
            "truncated": truncated,
            "content": body,
        }
    )
    return result


_SNIPPET_CAP = 2000
_SEARCH_STOP_WORDS = {
    "and",
    "are",
    "for",
    "from",
    "how",
    "into",
    "not",
    "or",
    "the",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
}


def _search_terms(query: str) -> set[str]:
    """Extract stable terms used only to detect catastrophically bad hits."""
    return {
        token
        for token in re.findall(r"[a-z0-9]+", (query or "").lower())
        if len(token) >= 3 and token not in _SEARCH_STOP_WORDS
    }


_PRIMARY_SOURCE_DOMAINS = (
    "courtlistener.com",
    "govinfo.gov",
    "justia.com",
    "law.justia.com",
    "pacermonitor.com",
    "patents.google.com",
    "sec.gov",
    "supremecourt.gov",
    "uscourts.gov",
    "uspto.gov",
)
_LOW_SIGNAL_DOMAINS = (
    "baijiahao.baidu.com",
    "facebook.com",
    "instagram.com",
    "pinterest.com",
    "reddit.com",
    "sohu.com",
    "tiktok.com",
    "wikipedia.org",
    "youtube.com",
    "zhihu.com",
)
_TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "ref",
    "source",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}


def _canonical_search_url(url: str) -> str:
    """Canonical URL used for cross-engine result deduplication."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parts.query)
            if key.lower() not in _TRACKING_QUERY_KEYS
        ]
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


def _source_quality(url: str) -> tuple[str, int]:
    """Return a transparent source tier and a small ranking bonus."""
    host = (urlsplit(url).hostname or "").lower()
    if (
        host.endswith(".gov")
        or host.endswith(".edu")
        or any(host == domain or host.endswith(f".{domain}") for domain in _PRIMARY_SOURCE_DOMAINS)
    ):
        return "primary", 6
    if any(host == domain or host.endswith(f".{domain}") for domain in _LOW_SIGNAL_DOMAINS):
        return "community", -5
    return "web", 0


def _matched_search_terms(query: str, item: dict[str, Any]) -> set[str]:
    terms = _search_terms(query)
    haystack = " ".join(str(item.get(field) or "") for field in ("title", "url", "snippet")).lower()
    return {term for term in terms if term in haystack}


def _results_look_irrelevant(query: str, results: list[dict[str, Any]]) -> bool:
    """True only when a multi-term query has no lexical anchor in any hit.

    This is a narrow circuit breaker for failures such as an ``Eight Sleep``
    lawsuit query returning only the Wikipedia page for the number 8.  It is
    not a general relevance ranker: one matching meaningful term is enough to
    keep a result set.
    """
    terms = _search_terms(query)
    if len(terms) < 2 or not results:
        return False
    required = 2 if len(terms) >= 3 else 1
    relevant_count = sum(
        1 for item in results if len(_matched_search_terms(query, item)) >= required
    )
    if relevant_count == 0:
        return True
    # One valid hit buried under a page of entity drift is still a failed
    # result set: the model should not have to discover the only useful source
    # among definitions, social posts and unrelated videos.
    return len(results) >= 5 and relevant_count / len(results) < 0.3


def _rank_search_results(
    query: str,
    results: list[dict[str, Any]],
    *,
    drop_irrelevant: bool = False,
) -> list[dict[str, Any]]:
    """Deduplicate, filter obvious drift, and rank by relevance + authority."""
    terms = _search_terms(query)
    entity_phrases = [
        " ".join(match.split()).lower()
        for match in re.findall(r"\b(?:[A-Z][\w-]+\s+){1,3}[A-Z][\w-]+\b", query or "")
    ]
    seen: set[str] = set()
    ranked: list[tuple[int, dict[str, Any]]] = []

    for original in results:
        item = dict(original)
        canonical_url = _canonical_search_url(str(item.get("url") or ""))
        dedupe_key = canonical_url or " ".join(str(item.get("title") or "").lower().split())
        if not dedupe_key or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        title = str(item.get("title") or "").lower()
        haystack = " ".join(
            str(item.get(field) or "") for field in ("title", "url", "snippet")
        ).lower()
        matched = _matched_search_terms(query, item)
        title_matches = sum(1 for term in terms if term in title)
        source_tier, source_bonus = _source_quality(str(item.get("url") or ""))
        value = len(matched) * 3 + title_matches * 2 + source_bonus
        value += 5 * sum(1 for phrase in entity_phrases if phrase in haystack)
        item["source_quality"] = source_tier
        if terms:
            item["relevance_score"] = round(len(matched) / len(terms), 2)
        ranked.append((value, item))

    ranked.sort(key=lambda pair: pair[0], reverse=True)
    if drop_irrelevant and len(terms) >= 3:
        relevant = [pair for pair in ranked if len(_matched_search_terms(query, pair[1])) >= 2]
        # Returning no result is safer than feeding the model a confident page
        # of entity drift. The caller has already attempted the configured
        # backend fallback before this finalization point.
        ranked = relevant
    return [item for _, item in ranked]


def _finalize_search_result(result: dict[str, Any], query: str, max_results: int) -> dict[str, Any]:
    if result.get("error"):
        return result
    finalized = dict(result)
    finalized["results"] = _rank_search_results(
        query,
        list(result.get("results") or []),
        drop_irrelevant=result.get("quality_warning") == "low_relevance",
    )[:max_results]
    finalized["result_count"] = len(finalized["results"])
    return finalized


def _resolve_backend() -> str:
    explicit = (os.environ.get("WEB_SEARCH_BACKEND") or "").strip().lower()
    if explicit:
        return explicit
    if os.environ.get("DOUBAO_SEARCH_API_KEY"):
        return "doubao"
    if os.environ.get("TAVILY_API_KEY"):
        return "tavily"
    if os.environ.get("BRAVE_API_KEY"):
        return "brave"
    if os.environ.get("SERPER_API_KEY"):
        return "serper"
    if os.environ.get("SEARXNG_URL"):
        return "searxng"
    return "ddg"


def _available_backends() -> list[str]:
    """All backends that have credentials / are usable, in fallback priority."""
    backs: list[str] = []
    if os.environ.get("SEARXNG_URL"):
        backs.append("searxng")
    if os.environ.get("DOUBAO_SEARCH_API_KEY"):
        backs.append("doubao")
    if os.environ.get("TAVILY_API_KEY"):
        backs.append("tavily")
    if os.environ.get("BRAVE_API_KEY"):
        backs.append("brave")
    if os.environ.get("SERPER_API_KEY"):
        backs.append("serper")
    backs.append("ddg")  # keyless last resort
    return backs


def _web_search_impl(
    query: str = "",
    *,
    max_results: int = 5,
    timeout_ms: int = 8000,
    client: Any = None,
    backend: str | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    if not query:
        return {"error": "missing query", "results": []}

    chosen = (backend or _resolve_backend()).lower()
    close_after = False
    if client is None:
        if not HTTPX_AVAILABLE:
            return {"error": "httpx not installed", "results": []}
        client = httpx.Client(timeout=timeout_ms / 1000)
        close_after = True

    retrieval_limit = min(max(max_results * 3, 10), 30)
    try:
        result = _dispatch_search(client, chosen, query, retrieval_limit)
        error_code = str(result.get("error") or "")
        # ``backend`` is exposed to the model as a routing hint, so the model
        # can occasionally name a provider that is not configured locally.
        # Missing credentials and an open SearXNG circuit are not meaningful
        # hard selections: recover through another usable backend instead of
        # surfacing an avoidable tool failure to the conversation.
        recoverable_backend_error = (
            error_code.endswith("_missing_key")
            or error_code == "searxng_temporarily_unhealthy"
            or error_code == "searxng_missing_url"
        )
        # Fallback chain (Hermes parity): if the configured/default backend
        # errors, try every other available backend once before giving up.
        # Explicit, usable providers remain hard selections. An unavailable
        # provider is treated as a hint because model-generated tool arguments
        # must not turn absent local credentials into a fatal research error.
        if result.get("error") and (backend is None or recoverable_backend_error):
            for alt in _available_backends():
                if alt == chosen:
                    continue
                alt_res = _dispatch_search(client, alt, query, retrieval_limit)
                if (
                    not alt_res.get("error")
                    and alt_res.get("results")
                    and not _results_look_irrelevant(query, alt_res["results"])
                ):
                    alt_res["fallback_from"] = chosen
                    alt_res["fallback_reason"] = "backend_error"
                    return _finalize_search_result(alt_res, query, max_results)
        # Some engines return syntactically valid but catastrophically
        # irrelevant results (for example interpreting "Eight Sleep" as the
        # number 8). Treat that as a soft backend failure and try another
        # available provider once. Explicit backend selection remains hard.
        if (
            backend is None
            and not result.get("error")
            and _results_look_irrelevant(query, result.get("results") or [])
        ):
            for alt in _available_backends():
                if alt == chosen:
                    continue
                alt_res = _dispatch_search(client, alt, query, retrieval_limit)
                if alt_res.get("error") or not alt_res.get("results"):
                    continue
                if _results_look_irrelevant(query, alt_res["results"]):
                    continue
                alt_res["fallback_from"] = chosen
                alt_res["fallback_reason"] = "low_relevance"
                return _finalize_search_result(alt_res, query, max_results)
            result["quality_warning"] = "low_relevance"
        # A healthy backend can still return zero hits because of throttling
        # or an over-specific query. Try the remaining configured providers
        # before relaxing the query on the same backend.
        if (
            backend is None
            and chosen == "ddg"
            and not result.get("error")
            and not result.get("results")
        ):
            for alt in _available_backends():
                if alt == chosen:
                    continue
                alt_res = _dispatch_search(client, alt, query, retrieval_limit)
                if (
                    alt_res.get("error")
                    or not alt_res.get("results")
                    or _results_look_irrelevant(query, alt_res["results"])
                ):
                    continue
                alt_res["fallback_from"] = chosen
                alt_res["fallback_reason"] = "empty_results"
                return _finalize_search_result(alt_res, query, max_results)
        # Near-miss recovery (Hermes parity): a query that returns nothing is
        # retried once with a loosened form — quotes / parens / operators
        # stripped, and the first N words kept. Models often over-qualify a
        # query with exact phrases that no index matches; the relaxed form
        # probes whether the topic exists at all. The retry keeps the original
        # ``query`` on the result so the model can tell the hit is approximate.
        if not result.get("results") and not result.get("error"):
            relaxed = _relaxed_query(query)
            if relaxed and relaxed != query:
                retry = _dispatch_search(client, chosen, relaxed, retrieval_limit)
                if retry.get("results"):
                    retry["query"] = relaxed
                    retry["near_miss_retry"] = True
                    retry["original_query"] = query
                    return _finalize_search_result(retry, relaxed, max_results)
        return _finalize_search_result(result, query, max_results)
    finally:
        if close_after:
            client.close()


def _web_search(
    query: str = "",
    *,
    max_results: int = 5,
    timeout_ms: int = 8000,
    client: Any = None,
    backend: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """One result contract for shared search, preserving provider fallback policy."""
    started = time.monotonic()
    result = _web_search_impl(
        query,
        max_results=max_results,
        timeout_ms=timeout_ms,
        client=client,
        backend=backend,
        **kwargs,
    )
    provider = str(result.get("backend") or result.get("provider") or backend or _resolve_backend())
    seen: set[str] = set()
    normalized = []
    for item in result.get("results") or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("link") or "").strip()
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                continue
            key = _canonical_search_url(url)
        except ValueError:
            continue
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                **item,
                "url": url,
                "title": str(item.get("title") or ""),
                "snippet": str(item.get("snippet") or item.get("content") or ""),
                "source": parsed.hostname,
                "provider": provider,
            }
        )
    return {
        **result,
        "query": result.get("query", query),
        "results": normalized,
        "result_count": len(normalized),
        "provider": provider,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "schema_version": 1,
    }


def _dispatch_search(
    client: Any,
    chosen: str,
    query: str,
    max_results: int,
) -> dict[str, Any]:
    """Route a web search to the configured backend."""
    if chosen == "doubao":
        key = os.environ.get("DOUBAO_SEARCH_API_KEY", "")
        if not key:
            return {"error": "doubao_missing_key", "results": []}
        return _doubao_search(client, key, query, max_results)
    if chosen == "tavily":
        key = os.environ.get("TAVILY_API_KEY", "")
        if not key:
            return {"error": "tavily_missing_key", "results": []}
        return _tavily_search(client, key, query, max_results)
    if chosen == "brave":
        key = os.environ.get("BRAVE_API_KEY", "")
        if not key:
            return {"error": "brave_missing_key", "results": []}
        return _brave_search(client, key, query, max_results)
    if chosen == "serper":
        key = os.environ.get("SERPER_API_KEY", "")
        if not key:
            return {"error": "serper_missing_key", "results": []}
        return _serper_search(client, key, query, max_results)
    if chosen == "searxng":
        base = os.environ.get("SEARXNG_URL", "")
        if not base:
            return {"error": "searxng_missing_url", "results": []}
        return _searxng_search(client, base, query, max_results)
    if chosen == "ddg":
        return _ddg_search(client, query, max_results)
    return {"error": f"unknown_backend: {chosen}", "results": []}


def _relaxed_query(query: str, max_words: int = 6) -> str:
    """Loosen an over-qualified search query for a near-miss retry.

    Strips quoted phrases, parentheses, boolean operators and site:/filetype:
    filters, collapses whitespace, then keeps the first ``max_words`` tokens.
    Returns an empty string when nothing searchable remains.
    """
    import re as _re

    # Quoted phrases: strip the quotes but keep the words — a "near miss"
    # retry loosens exact-phrase matching, it does not throw the topic away.
    stripped = _re.sub(r'"([^"]*)"', r" \1 ", query)
    stripped = _re.sub(r"[()\[\]{}]", " ", stripped)  # grouping
    # Boolean operators and field filters (site:example.com → drop both).
    stripped = _re.sub(
        r"\b(?:AND|OR|NOT)\b",
        " ",
        stripped,
        flags=_re.IGNORECASE,
    )
    stripped = _re.sub(
        r"\b(?:site|filetype|intitle|inurl):\S*",
        " ",
        stripped,
        flags=_re.IGNORECASE,
    )
    tokens = [t for t in stripped.split() if t]
    return " ".join(tokens[:max_words]).strip()


def _doubao_search(client: Any, api_key: str, query: str, max_results: int) -> dict[str, Any]:
    """豆包搜索 (Doubao Search) — 火山引擎为 AI Agent 构建的联网搜索服务。

    使用 Global 版端点 (``search_api/global_search``)，覆盖全球站点、每条结果带
    ``ContentTokenCount`` 等对 Agent 友好的字段。返回字段参考官方文档与开源实现
    huashu-doubao-search。
    """
    endpoint = "https://open.feedcoopapi.com/search_api/global_search"
    try:
        r = client.post(
            endpoint,
            json={
                "query": query,
                "doc_count": max_results,
                "max_snippet_length": _SNIPPET_CAP,
                "max_image_count_per_doc": 0,
            },
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"doubao_error: {type(e).__name__}: {e}", "results": []}

    meta_err = (data.get("ResponseMetadata") or {}).get("Error")
    if meta_err:
        return {
            "error": f"doubao_api_error: {str(meta_err.get('Message') or meta_err)[:300]}",
            "results": [],
        }

    docs = (data.get("Result") or {}).get("Documents") or []
    results: list[dict[str, str]] = []
    for item in docs[:max_results]:
        snippets: list[str] = []
        for part in item.get("Snippet") or []:
            if part.get("Type") == "text" and part.get("Text"):
                snippets.append(str(part["Text"]).strip())
        doc_info = item.get("DocumentInfo") or {}
        results.append(
            {
                "title": item.get("Title") or "",
                "url": item.get("Url") or "",
                "snippet": "\n".join(snippets)[:_SNIPPET_CAP],
                "host": (item.get("HostInfo") or {}).get("Hostname") or "",
                "publish_time": doc_info.get("PublishTime") or "",
            }
        )
    return {"query": query, "backend": "doubao", "results": results}


def _tavily_search(client: Any, api_key: str, query: str, max_results: int) -> dict[str, Any]:
    try:
        r = client.post(
            "https://api.tavily.com/search",
            json={"api_key": api_key, "query": query, "max_results": max_results},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"tavily_error: {type(e).__name__}: {e}", "results": []}

    results = [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("content", "")[:_SNIPPET_CAP],
        }
        for item in data.get("results", [])[:max_results]
    ]
    return {"query": query, "backend": "tavily", "results": results}


def _brave_search(client: Any, api_key: str, query: str, max_results: int) -> dict[str, Any]:
    try:
        r = client.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": max_results},
            headers={
                "X-Subscription-Token": api_key,
                "Accept": "application/json",
            },
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"brave_error: {type(e).__name__}: {e}", "results": []}

    web = (data.get("web") or {}).get("results") or []
    results = [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": (item.get("description") or "")[:_SNIPPET_CAP],
        }
        for item in web[:max_results]
    ]
    return {"query": query, "backend": "brave", "results": results}


def _serper_search(client: Any, api_key: str, query: str, max_results: int) -> dict[str, Any]:
    try:
        r = client.post(
            "https://google.serper.dev/search",
            json={"q": query, "num": max_results},
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"serper_error: {type(e).__name__}: {e}", "results": []}

    organic = data.get("organic") or []
    results = [
        {
            "title": item.get("title", ""),
            "url": item.get("link", ""),
            "snippet": (item.get("snippet") or "")[:_SNIPPET_CAP],
        }
        for item in organic[:max_results]
    ]
    return {"query": query, "backend": "serper", "results": results}


_SEARXNG_FAILURE_LOCK = threading.Lock()
_SEARXNG_UNHEALTHY_UNTIL = 0.0
_SEARXNG_COOLDOWN_S = 60.0


def _searxng_search(client: Any, base_url: str, query: str, max_results: int) -> dict[str, Any]:
    global _SEARXNG_UNHEALTHY_UNTIL
    now = time.monotonic()
    with _SEARXNG_FAILURE_LOCK:
        unhealthy_until = _SEARXNG_UNHEALTHY_UNTIL
    if unhealthy_until > now:
        return {
            "error": "searxng_temporarily_unhealthy",
            "results": [],
            "retry_after_s": max(1, int(unhealthy_until - now)),
        }
    endpoint = base_url.rstrip("/") + "/search"
    headers: dict[str, str] = {"Accept": "application/json"}
    api_key = os.environ.get("SEARXNG_API_KEY", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        r = client.get(
            endpoint,
            params={
                "q": query,
                "format": "json",
                "engines": "google,bing,brave,duckduckgo",
                "categories": "general",
            },
            headers=headers,
            timeout=3.0,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        with _SEARXNG_FAILURE_LOCK:
            _SEARXNG_UNHEALTHY_UNTIL = time.monotonic() + _SEARXNG_COOLDOWN_S
        return {"error": f"searxng_error: {type(e).__name__}: {e}", "results": []}

    with _SEARXNG_FAILURE_LOCK:
        _SEARXNG_UNHEALTHY_UNTIL = 0.0

    items = data.get("results") or []
    results = [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": (item.get("content") or "")[:_SNIPPET_CAP],
        }
        for item in items[:max_results]
    ]
    return {
        "query": query,
        "backend": "searxng",
        "results": _rank_search_results(query, results),
    }


def _ddgs_text_search(query: str, max_results: int) -> list[dict[str, str]] | None:
    """Search through the maintained DDGS adapter when it is available.

    Returning ``None`` asks the caller to use the keyless HTML fallback. DDGS
    aggregates multiple public search sources, but upstream throttling is
    expected and must never abort an agent turn.
    """
    try:
        from ddgs import DDGS
    except ImportError:
        return None

    try:
        raw_items = DDGS().text(query, max_results=max(max_results * 2, 10))
    except Exception:  # noqa: BLE001
        return None

    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_items or []:
        url = str(item.get("href") or item.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        results.append(
            {
                "title": str(item.get("title") or "").strip(),
                "url": url,
                "snippet": str(item.get("body") or item.get("snippet") or "").strip()[
                    :_SNIPPET_CAP
                ],
            }
        )
        if len(results) >= max_results:
            break
    return results or None


def _ddg_search(client: Any, query: str, max_results: int) -> dict[str, Any]:
    # A caller-supplied client represents an explicit network boundary (proxy,
    # enterprise transport, fixture, or policy-enforcing adapter). DDGS owns
    # its own transport, so invoking it for arbitrary client-like objects would
    # silently bypass that boundary. Use the aggregator only for Echo's
    # ordinary in-process httpx client; otherwise keep all traffic on the
    # injected client's HTML path.
    use_library_adapter = bool(HTTPX_AVAILABLE and isinstance(client, httpx.Client))
    library_results = _ddgs_text_search(query, max_results) if use_library_adapter else None
    if library_results:
        return {
            "query": query,
            "backend": "ddg",
            "adapter": "ddgs",
            "results": library_results,
        }

    try:
        r = client.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers={"User-Agent": "echo-ai/0.1"},
        )
    except Exception as e:  # noqa: BLE001
        return {"error": f"ddg_error: {type(e).__name__}: {e}", "results": []}

    text = r.text
    # DDG HTML: <a class="result__a" href="URL">TITLE</a>
    import re

    items = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        text,
        flags=re.DOTALL,
    )
    snippets = re.findall(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', text, flags=re.DOTALL)

    def _clean(s: str) -> str:
        s = re.sub(r"<[^>]+>", "", s)
        return re.sub(r"\s+", " ", s).strip()

    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for i, (url, title) in enumerate(items[:max_results]):
        if not url or url in seen:
            continue
        seen.add(url)
        snippet = snippets[i] if i < len(snippets) else ""
        results.append(
            {
                "title": _clean(title),
                "url": url,
                "snippet": _clean(snippet)[:_SNIPPET_CAP],
            }
        )
    return {
        "query": query,
        "backend": "ddg",
        "adapter": "html-fallback",
        "results": results,
    }


def _extract_text_for_prompt(html: str, url: str) -> str:
    """Try trafilatura.extract first, fall back to regex strip."""
    if TRAFILATURA_AVAILABLE and html:
        try:
            text = trafilatura.extract(
                html,
                url=url,
                include_links=False,
                include_comments=False,
                favor_precision=True,
            )
        except (OSError, ValueError):
            text = None
        if text:
            return text
    return _strip_html_fallback(html)
