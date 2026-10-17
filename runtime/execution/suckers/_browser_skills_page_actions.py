"""Playwright page interactions behind the browser_skills action handlers.

Each function runs one action (navigate / click / type / scroll / upload /
wait / screenshot) on an already-open Playwright ``page`` and returns the
handler's result dict.  The handlers in ``browser_skills`` keep argument
validation, SSRF / path checks and higher-track routing, then hand one of
these to ``_with_page``.  This module never imports ``browser_skills``.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Any


def _navigate_page(p: Any, url: str, timeout_ms: int, wait_ms: int) -> dict[str, Any]:
    try:
        resp = p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
    except Exception as e:  # noqa: BLE001
        return {"error": f"nav_error: {type(e).__name__}: {e}"}
    if wait_ms > 0:
        p.wait_for_timeout(wait_ms)
    try:
        title = p.title()
    except (AttributeError, RuntimeError):  # noqa: BLE001
        title = ""
    return {
        "url": p.url,
        "status_code": resp.status if resp else None,
        "title": title,
    }


def _click_page(
    p: Any, url: str, selector: str, timeout_ms: int, wait_after_ms: int
) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            return {"error": f"nav_error: {type(e).__name__}: {e}"}
    try:
        p.click(selector, timeout=timeout_ms)
    except Exception as e:  # noqa: BLE001
        return {"error": f"click_error: {type(e).__name__}: {e}"}
    if wait_after_ms > 0:
        p.wait_for_timeout(wait_after_ms)
    try:
        title = p.title()
    except (AttributeError, RuntimeError):  # noqa: BLE001
        title = ""
    return {
        "clicked": selector,
        "final_url": p.url,
        "title": title,
    }


def _type_page(
    p: Any,
    url: str,
    selector: str,
    text: str,
    *,
    press_enter: bool,
    clear_first: bool,
    timeout_ms: int,
) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            return {"error": f"nav_error: {type(e).__name__}: {e}"}
    try:
        locator = p.locator(selector)
        try:
            tag_name = locator.evaluate("element => element.tagName")
        except AttributeError:
            # Lightweight/test backends may expose the older page-level
            # fill/press API without a full Locator implementation.
            if clear_first:
                p.fill(selector, "", timeout=timeout_ms)
                p.fill(selector, text, timeout=timeout_ms)
            else:
                p.focus(selector, timeout=timeout_ms)
                p.press(selector, "ControlOrMeta+End", timeout=timeout_ms)
                p.type(selector, text, timeout=timeout_ms)
            if press_enter:
                p.press(selector, "Enter", timeout=timeout_ms)
            input_kind = "text"
        else:
            if str(tag_name).upper() == "SELECT":
                # Keep one generic form-entry primitive while still handling
                # native selects correctly. Prefer the visible label, then
                # fall back to the value for machine-oriented forms.
                try:
                    locator.select_option(label=text, timeout=timeout_ms)
                except Exception:  # noqa: BLE001
                    locator.select_option(value=text, timeout=timeout_ms)
                input_kind = "select"
            else:
                replacement = text
                if not clear_first:
                    existing = (
                        locator.input_value(timeout=timeout_ms)
                        if str(tag_name).upper() in {"INPUT", "TEXTAREA"}
                        else locator.inner_text(timeout=timeout_ms)
                    )
                    replacement = existing + text
                locator.fill(replacement, timeout=timeout_ms)
                input_kind = "text"
            if press_enter:
                locator.press("Enter", timeout=timeout_ms)
    except Exception as e:  # noqa: BLE001
        return {"error": f"type_error: {type(e).__name__}: {e}"}
    return {
        "filled": selector,
        "text_len": len(text),
        "input_kind": input_kind,
        "pressed_enter": press_enter,
        "final_url": p.url,
    }


def _scroll_page(
    p: Any, url: str, to_selector: str | None, to_y: int | None, timeout_ms: int
) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            return {"error": f"nav_error: {type(e).__name__}: {e}"}
    try:
        if to_selector is not None:
            p.locator(to_selector).scroll_into_view_if_needed(
                timeout=timeout_ms,
            )
            scrolled_to = {"selector": to_selector}
        else:
            p.evaluate(f"window.scrollTo(0, {int(to_y)})")
            scrolled_to = {"y": int(to_y)}
    except Exception as e:  # noqa: BLE001
        return {"error": f"scroll_error: {type(e).__name__}: {e}"}
    return {"scrolled_to": scrolled_to, "final_url": p.url}


def _upload_page(
    p: Any, url: str, selector: str, resolved: Path, size: int, timeout_ms: int
) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as exc:  # noqa: BLE001
            return {"error": f"nav_error: {type(exc).__name__}: {exc}"}
    try:
        p.locator(selector).set_input_files(str(resolved), timeout=timeout_ms)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"upload_error: {type(exc).__name__}: {exc}"}
    return {
        "uploaded": selector,
        "file_name": resolved.name,
        "size_bytes": size,
        "final_url": p.url,
    }


def _wait_page(p: Any, url: str, selector: str, state: str, timeout_ms: int) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            return {"error": f"nav_error: {type(e).__name__}: {e}"}
    try:
        p.wait_for_selector(selector, state=state, timeout=timeout_ms)
    except Exception as e:  # noqa: BLE001
        return {
            "error": f"wait_timeout: {type(e).__name__}: {e}",
            "timed_out": True,
            "selector": selector,
            "state": state,
        }
    return {"waited_for": selector, "state": state, "final_url": p.url}


def _screenshot_page(
    p: Any,
    url: str,
    resolved: Any,
    *,
    full_page: bool,
    timeout_ms: int,
    wait_ms: int,
    max_bytes: int,
) -> dict[str, Any]:
    if url:
        try:
            p.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
        except Exception as e:  # noqa: BLE001
            return {"error": f"nav_error: {type(e).__name__}: {e}"}
    if wait_ms > 0:
        p.wait_for_timeout(wait_ms)
    try:
        p.screenshot(path=str(resolved), full_page=full_page)
    except Exception as e:  # noqa: BLE001
        return {"error": f"screenshot_error: {type(e).__name__}: {e}"}

    size = 0
    with contextlib.suppress(OSError):
        size = Path(str(resolved)).stat().st_size
    if size > max_bytes:
        with contextlib.suppress(OSError):
            Path(str(resolved)).unlink()
        return {
            "error": f"screenshot too large: {size} > {max_bytes}",
            "path": str(resolved),
        }
    return {
        "path": str(resolved),
        "size_bytes": size,
        "full_page": full_page,
    }
