from __future__ import annotations

import contextvars
import queue
import threading
from typing import Any

from runtime.execution.suckers._html_text import (
    _strip_html_fallback as _strip_html_fallback,
)
from runtime.execution.suckers.web_skills_catalog import (
    _LOW_SIGNAL_DOMAINS as _LOW_SIGNAL_DOMAINS,
)
from runtime.execution.suckers.web_skills_catalog import (
    _PRIMARY_SOURCE_DOMAINS as _PRIMARY_SOURCE_DOMAINS,
)
from runtime.execution.suckers.web_skills_catalog import (
    _SEARCH_STOP_WORDS as _SEARCH_STOP_WORDS,
)
from runtime.execution.suckers.web_skills_catalog import (
    _SEARXNG_COOLDOWN_S as _SEARXNG_COOLDOWN_S,
)
from runtime.execution.suckers.web_skills_catalog import (
    _SEARXNG_FAILURE_LOCK as _SEARXNG_FAILURE_LOCK,
)
from runtime.execution.suckers.web_skills_catalog import (
    _SEARXNG_UNHEALTHY_UNTIL as _SEARXNG_UNHEALTHY_UNTIL,
)
from runtime.execution.suckers.web_skills_catalog import (
    _SNIPPET_CAP as _SNIPPET_CAP,
)
from runtime.execution.suckers.web_skills_catalog import (
    _TRACKING_QUERY_KEYS as _TRACKING_QUERY_KEYS,
)
from runtime.execution.suckers.web_skills_catalog import (  # noqa: F401
    HTTPX_AVAILABLE as HTTPX_AVAILABLE,
)
from runtime.execution.suckers.web_skills_catalog import (  # noqa: F401
    TRAFILATURA_AVAILABLE as TRAFILATURA_AVAILABLE,
)
from runtime.execution.suckers.web_skills_catalog import (
    _available_backends as _available_backends,
)
from runtime.execution.suckers.web_skills_catalog import (
    _brave_search as _brave_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _canonical_search_url as _canonical_search_url,
)
from runtime.execution.suckers.web_skills_catalog import (
    _ddg_search as _ddg_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _ddgs_text_search as _ddgs_text_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _dispatch_search as _dispatch_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _doubao_search as _doubao_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _extract_main_content as _extract_main_content,
)
from runtime.execution.suckers.web_skills_catalog import (
    _extract_text_for_prompt as _extract_text_for_prompt,
)
from runtime.execution.suckers.web_skills_catalog import (
    _fetch_url as _fetch_url,
)
from runtime.execution.suckers.web_skills_catalog import (
    _finalize_search_result as _finalize_search_result,
)
from runtime.execution.suckers.web_skills_catalog import (
    _matched_search_terms as _matched_search_terms,
)
from runtime.execution.suckers.web_skills_catalog import (
    _rank_search_results as _rank_search_results,
)
from runtime.execution.suckers.web_skills_catalog import (
    _relaxed_query as _relaxed_query,
)
from runtime.execution.suckers.web_skills_catalog import (
    _resolve_backend as _resolve_backend,
)
from runtime.execution.suckers.web_skills_catalog import (
    _results_look_irrelevant as _results_look_irrelevant,
)
from runtime.execution.suckers.web_skills_catalog import (
    _search_terms as _search_terms,
)
from runtime.execution.suckers.web_skills_catalog import (
    _searxng_search as _searxng_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _serper_search as _serper_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _source_quality as _source_quality,
)
from runtime.execution.suckers.web_skills_catalog import (
    _tavily_search as _tavily_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _web_search as _web_search,
)
from runtime.execution.suckers.web_skills_catalog import (
    _web_search_impl as _web_search_impl,
)
from runtime.execution.suckers.web_skills_catalog import (
    httpx as httpx,
)
from runtime.execution.suckers.web_skills_catalog import (
    trafilatura as trafilatura,
)

from .registry import Skill, SkillRegistry
from .testing import SkillExpect, SkillTestCase

# ═══════════════════════════════════════════════════════════
# fetch_url
# ═══════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════
# web_search
# ═══════════════════════════════════════════════════════════

# Snippets were hard-truncated to 400 chars, which silently dropped the
# exact numbers/figures the model needs (e.g. "17.6 亿美元"). Raise the cap
# and keep it in one place so every backend stays consistent.


# ═══════════════════════════════════════════════════════════
# web_fetch — extract just the answer to a prompt via cheap LLM
# ═══════════════════════════════════════════════════════════


_WEB_FETCH_SYSTEM = (
    "You extract specific information from web pages. Return ONLY the answer "
    "to the user's question, no preamble. If the page doesn't contain the "
    "answer, say 'not found in page'."
)


def set_web_fetch_router(router: Any, *, default_model: str | None = None) -> None:
    """Install the lightweight LLM route used by ``web_fetch``."""
    from runtime.platform.process.service_provider import get_provider

    provider = get_provider()
    provider.register_instance("web_fetch_cheap", router)
    provider.register_instance("web_fetch_default_model", default_model)


def _web_fetch(
    url: str = "",
    prompt: str = "",
    *,
    max_chars: int = 16000,
    cheap_model: str | None = None,
    client: Any = None,
    allow_private: bool = False,
    timeout_ms: int = 5000,
    llm_timeout_ms: int = 30_000,
    _llm_caller: Any = None,
    _trafilatura_override: Any = "__unset__",
    _rendered_fetcher: Any = None,
    **_kw: Any,
) -> dict[str, Any]:
    if not prompt:
        question = _kw.get("question")
        if isinstance(question, str) and question.strip():
            prompt = question
    if not url:
        return {"error": "missing url", "error_type": "invalid_argument"}
    if not prompt:
        return {"error": "missing prompt", "error_type": "invalid_argument"}

    # Step 1+2: reuse fetch_url to do GET + SSRF guard.
    fetched = _fetch_url(
        url=url,
        timeout_ms=timeout_ms,
        max_bytes=max(max_chars * 4, 200_000),
        client=client,
        allow_private=allow_private,
        extract=False,
    )
    if "error" in fetched:
        return {
            "error": fetched["error"],
            "error_type": "network_error",
            "url": url,
            "retryable": fetched.get("retryable", False),
            "attempts": fetched.get("attempts", 1),
            "recovery_hint": (
                "Do not end the task because one URL failed. Retry once, then use "
                "web_search to locate the same document on an official mirror, "
                "court docket, patent database, or cached source."
            ),
        }

    raw_html = fetched.get("content", "") or ""
    final_url = fetched.get("url", url)

    # Step 3+4: extract + truncate.
    if _trafilatura_override == "__unset__":
        extracted_text = _extract_text_for_prompt(raw_html, final_url)
    elif _trafilatura_override is None:
        # Test hook: simulate trafilatura import-missing.
        extracted_text = _strip_html_fallback(raw_html)
    else:
        extracted_text = _trafilatura_override

    if len(extracted_text) > max_chars:
        extracted_text = extracted_text[:max_chars]

    fetch_mode = "http"
    if not extracted_text:
        # JS-only shells frequently return a valid HTTP 200 with no readable
        # body. Escalate internally to a background renderer; do not expose or
        # open the user's interactive browser merely because extraction was
        # empty. Explicit Browser/Chrome turns use their own browser tools.
        rendered_fetcher = _rendered_fetcher
        if rendered_fetcher is None:
            try:
                from runtime.execution.suckers.browser_skills import _browser_get

                rendered_fetcher = _browser_get
            except ImportError:
                rendered_fetcher = None
        if callable(rendered_fetcher):
            try:
                rendered = rendered_fetcher(
                    url=final_url,
                    timeout_ms=max(timeout_ms, 10_000),
                    wait_ms=800,
                    max_bytes=max_chars,
                    allow_private=allow_private,
                    _background_only=True,
                )
            except Exception:  # noqa: BLE001 - optional recovery lane
                rendered = {}
            rendered_text = rendered.get("content") if isinstance(rendered, dict) else ""
            if isinstance(rendered_text, str) and rendered_text.strip():
                extracted_text = rendered_text.strip()
                final_url = str(rendered.get("url") or final_url)
                fetch_mode = "background_browser"

    if not extracted_text:
        return {
            "error": "empty_extract",
            "error_type": "network_error",
            "url": final_url,
            "recovery_hint": (
                "HTTP extraction and background rendering both returned no readable text. "
                "Use web_search for an official mirror or cached source; only request an "
                "interactive browser if login, clicking, or visual inspection is required."
            ),
        }

    # External engines can answer from extracted source text themselves. Do
    # not add an implicit second provider call for their shared web tool.
    from runtime.execution.request import current_execution_request

    request = current_execution_request()
    if request is not None and request.task.execution_engine in {"codex", "opencode", "codebuddy"}:
        return {
            "ok": True,
            "url": final_url,
            "prompt": prompt,
            "content": extracted_text[:max_chars],
            "extracted_chars": len(extracted_text[:max_chars]),
            "fetch_mode": fetch_mode,
            "model": None,
            "answer_pending": True,
        }

    # Step 5+6: cheap LLM call for native callers.
    caller = _llm_caller
    if caller is None:
        try:
            from runtime.platform.llm_infra.llm_caller import LLMCaller

            caller = LLMCaller("web_fetch_cheap", "web_fetch_default_model")
        except Exception as exc:  # noqa: BLE001
            return {
                "error": f"llm_caller_unavailable: {exc}",
                "error_type": "unsupported",
                "url": final_url,
                "fallback_extract": extracted_text,
            }

    user_msg = f"URL: {final_url}\nQuestion: {prompt}\n\nPage content:\n{extracted_text}"
    result_queue: queue.Queue[tuple[str, Any]] = queue.Queue(maxsize=1)
    caller_context = contextvars.copy_context()

    def _call_llm() -> None:
        try:
            result = caller.call(
                system=_WEB_FETCH_SYSTEM,
                user=user_msg,
                model=cheap_model,
                max_tokens=512,
                temperature=0.1,
            )
        except Exception as exc:  # noqa: BLE001 — returned to the caller thread
            result_queue.put(("error", exc))
        else:
            result_queue.put(("result", result))

    worker = threading.Thread(
        target=lambda: caller_context.run(_call_llm),
        name="web-fetch-llm",
        daemon=True,
    )
    worker.start()
    try:
        kind, payload = result_queue.get(timeout=max(0.001, llm_timeout_ms / 1000))
    except queue.Empty:
        return {
            "error": f"llm_timeout: no response within {llm_timeout_ms}ms",
            "error_type": "llm_timeout",
            "url": final_url,
            "fallback_extract": extracted_text,
        }
    if kind == "error":
        exc = payload
        return {
            "error": f"llm_failed: {type(exc).__name__}: {exc}",
            "error_type": "llm_failed",
            "url": final_url,
            "fallback_extract": extracted_text,
        }
    answer_text, meta = payload

    if not answer_text or (isinstance(meta, dict) and meta.get("error")):
        return {
            "error": (
                f"llm_failed: {meta.get('error', 'empty response')}"
                if isinstance(meta, dict)
                else "llm_failed: empty response"
            ),
            "error_type": "llm_failed",
            "url": final_url,
            "fallback_extract": extracted_text,
        }

    return {
        "ok": True,
        "url": final_url,
        "prompt": prompt,
        "answer": answer_text.strip(),
        "extracted_chars": len(extracted_text),
        "fetch_mode": fetch_mode,
        "model": (meta or {}).get("model") if isinstance(meta, dict) else None,
    }


# ═══════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════


WEB_SKILL_NAMES = ["fetch_url", "web_search", "web_fetch"]


def register_web_skills(registry: SkillRegistry) -> int:
    if not HTTPX_AVAILABLE:
        return 0

    registry.register(
        Skill(
            name="fetch_url",
            description=(
                "用途: 对一个已知 URL 发 HTTP GET；默认返回原始 body 文本 (有上限)。开 extract=true 走 trafilatura 抽取正文 + 元数据 (title/author/date/sitename/description/language)，把导航/广告/页脚剥掉。\n"
                "何时不用: 不知道目标网址、要先「搜一下」用 web_search；要执行本地命令用 exec_shell (curl/wget 不要绕道这里)；私网地址默认被 SSRF 拦截，需要时显式 allow_private=true。\n"
                "关键参数: url (必填); extract (默认 False, 阅读文章问答时建议 True); timeout_ms (默认 5000); max_bytes (默认 100000)。\n"
                '示例: fetch_url({"url": "https://example.com/post", "extract": true})'
            ),
            affinity=["web", "io"],
            cost_profile="low",
            trusted_source="skill://public/fetch_url",
            handler=_fetch_url,
            tests=[
                SkillTestCase(
                    name="missing_url_returns_error",
                    tier="golden",
                    args={"url": ""},
                    expect=SkillExpect(schema_keys=["error"]),
                ),
            ],
        )
    )
    registry.register(
        Skill(
            name="web_search",
            description=(
                "用途: 网上检索 — 任何「需要谷歌一下」的查询 (新闻、价格、定义、X 的现状、近期事件、产品对比) 都走这里；返回结构化 [{title, url, snippet}]。\n"
                "何时不用: 已经知道具体 URL 直接读用 fetch_url；不要用 exec_shell 跑 curl/wget 拿 HTML (没法解析)；查本地代码/配置用 grep_text 或 glob_files。\n"
                "关键参数: query (必填); max_results (默认 5); backend (可选, 留空时按环境变量自动选 doubao/tavily/brave/serper/searxng/ddg)。\n"
                "路由提示: 通常不要填写 backend，让系统按当前可用凭据自动选择和故障降级；仅当用户明确要求某个搜索源时再指定。\n"
                "研究要求: 复杂调研至少使用两组不同关键词，优先读取 source_quality=primary 的原始来源；搜索摘要只用于发现候选 URL，关键结论必须再用 web_fetch 核验正文。\n"
                '示例: web_search({"query": "langgraph 0.2 release notes", "max_results": 5})'
            ),
            affinity=["web", "search"],
            cost_profile="low",
            trusted_source="skill://public/web_search",
            handler=_web_search,
            tests=[
                SkillTestCase(
                    name="empty_query_returns_error",
                    tier="golden",
                    args={"query": ""},
                    expect=SkillExpect(schema_keys=["error", "results"]),
                ),
            ],
        )
    )
    registry.register(
        Skill(
            name="web_fetch",
            description=(
                "用途: 给一个 URL + 一个问题，提取页面正文。外部执行引擎收到 content 正文并自行回答；原生调用由辅助模型提取 answer。\n"
                "何时不用: 只想拿原文 / 自己解析用 fetch_url(extract=true)；不知道目标网址先用 web_search；要本地文件 Q&A 用 read_file 自己问。\n"
                "关键参数: url (必填); prompt (必填, 你想从页面里得到的答案); max_chars (送进 LLM 的正文上限, 默认 16000); cheap_model (可选, 留空走 web_fetch_default_model)。\n"
                '示例: web_fetch({"url": "https://docs.example.com/limits", "prompt": "What is the rate limit?"})'
            ),
            affinity=["web", "io", "llm"],
            cost_profile="mid",
            trusted_source="skill://public/web_fetch",
            handler=_web_fetch,
            tests=[
                SkillTestCase(
                    name="missing_url_returns_error",
                    tier="golden",
                    args={"url": "", "prompt": "what?"},
                    expect=SkillExpect(schema_keys=["error", "error_type"]),
                ),
                SkillTestCase(
                    name="missing_prompt_returns_error",
                    tier="golden",
                    args={"url": "https://example.com/", "prompt": ""},
                    expect=SkillExpect(schema_keys=["error", "error_type"]),
                ),
            ],
        )
    )
    # Native multi-platform reach shares the web capability gate. Importing
    # here avoids a module cycle because reach routes reuse _web_search and
    # _fetch_url at execution time.
    from .reach_skills import register_reach_skills

    return 3 + register_reach_skills(registry)
