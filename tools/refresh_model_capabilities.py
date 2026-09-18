"""Regenerate ``data/model_capabilities.json`` from models.dev.

models.dev is a community-maintained database of per-MODEL capabilities. Our
own compat profiles are per-PROVIDER, which is the right granularity for
request quirks that a whole vendor shares but the wrong one for facts that
differ between a vendor's own models — ``kimi-k3`` rejects ``temperature``
while its siblings accept it, and a relay's ``deepseek-v4-flash`` has a 1M
window where our hand-written entry said 128k.

The snapshot is vendored rather than fetched at runtime so startup makes no
network call, offline installs behave identically, and CI is deterministic.
Run this to refresh it:

    make refresh-model-capabilities

Only the fields we act on are kept, so the snapshot stays small and
reviewable in a diff:

``context``       input window, corrects an entry's ``context_window``
``temperature``   False means the model 400s on a temperature parameter
``reasoning``     True means it spends output tokens thinking before writing
``free``          True only when EVERY provider listing the id prices it at 0

Prices are additionally kept per provider under ``free_by_provider``, because
price is the one fact that genuinely differs between services hosting the same
model id. Callers that know which service they bill against should look there;
``free`` is the conservative fallback for callers that do not.

Usage:
    python -m tools.refresh_model_capabilities [--url URL] [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_URL = "https://models.dev/api.json"
# Lives under resources/, not data/: data/ is gitignored operator state, while
# this is a bundled read-only asset that must ship with the repo. See
# runtime.platform.process.paths.resources_root.
DEFAULT_OUT = Path("resources/models/capabilities.json")

# A bare "python-httpx/x.y" gets rejected by bot-protection layers; see
# runtime.sensing.model_router.models.DEFAULT_USER_AGENT for the full story.
_USER_AGENT = "echo-ai-capability-refresh"


def _fetch(url: str) -> dict[str, Any]:
    import httpx

    response = httpx.get(url, timeout=120.0, headers={"User-Agent": _USER_AGENT})
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise SystemExit(f"unexpected payload shape from {url}: {type(payload).__name__}")
    return payload


def free_by_provider(raw: dict[str, Any]) -> dict[str, list[str]]:
    """Zero-input-cost model ids, kept per provider.

    Price is the one fact that genuinely differs between providers hosting the
    same model id, so it cannot be flattened the way capability claims can.
    Measured on the live dump: 162 ids are free on one provider and paid on
    another — ``qwen3.5-plus`` costs 0.2 on ``opencode`` while
    ``alibaba-coding-plan-cn`` lists it at 0. Flattening let that 0 win and
    painted a paid Zen model with a Free badge.

    This is how the OpenCode CLI reads it too: look up the price under the
    provider you are actually calling, never under a bare model name.
    """
    out: dict[str, list[str]] = {}
    for provider_id, provider in raw.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, dict):
            continue
        free = sorted(
            model_id
            for model_id, model in models.items()
            if isinstance(model, dict)
            and isinstance(model.get("cost"), dict)
            and model["cost"].get("input") == 0
        )
        if free:
            out[str(provider_id)] = free
    return dict(sorted(out.items()))


def distill(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Reduce the upstream dump to the fields we actually act on.

    A model id can appear under several providers (a relay and the vendor
    itself). Their capability claims agree in practice; when they disagree we
    keep the first and do not try to arbitrate — the operator's own
    ``custom_models.json`` entry always wins over this snapshot anyway.

    Price is the exception and is NOT flattened here; see ``free_by_provider``.
    """
    out: dict[str, dict[str, Any]] = {}
    # Must be complete before the main pass: a model seen first under a
    # zero-cost provider would otherwise be flagged free before the paid
    # record that disqualifies it is ever read.
    paid_somewhere = {
        model_id
        for provider in raw.values()
        if isinstance(provider, dict) and isinstance(provider.get("models"), dict)
        for model_id, model in provider["models"].items()
        if isinstance(model, dict)
        and isinstance(model.get("cost"), dict)
        and isinstance(model["cost"].get("input"), int | float)
        and model["cost"]["input"] != 0
    }
    for provider in raw.values():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, dict):
            continue
        for model_id, model in models.items():
            if not isinstance(model, dict) or model_id in out:
                continue
            cost = model.get("cost")
            record: dict[str, Any] = {}

            limit = model.get("limit")
            if isinstance(limit, dict):
                context = limit.get("context")
                if isinstance(context, int) and context > 0:
                    record["context"] = context

            # Only ``False`` is worth recording: it is the actionable claim
            # ("omit this parameter"). ``True`` is the default assumption.
            if model.get("temperature") is False:
                record["temperature"] = False

            # Reasoning models spend max_tokens on thinking before they write,
            # so an output budget that only covers the thinking returns HTTP
            # 200 with empty content. Recording this lets the router raise its
            # floor for models the operator never declared.
            if model.get("reasoning") is True:
                record["reasoning"] = True

            # OpenCode (and models.dev) treat ``cost.input === 0`` as free.
            # Zen's own ``/models`` endpoint does not publish prices, so this
            # snapshot is what lets Echo mark Free badges without a hardcoded
            # id list that goes stale the next time upstream ships a model.
            #
            # This flattened flag is only the fallback for callers that have no
            # provider in hand, so it is deliberately conservative: free ONLY
            # when every provider listing the id prices it at zero. An id that
            # is free on one relay and paid on another resolves to False here
            # and must be looked up via ``free_by_provider``.
            if isinstance(cost, dict) and cost.get("input") == 0 and model_id not in paid_somewhere:
                record["free"] = True

            # ``interleaved.field`` (which response key carries reasoning) is
            # deliberately NOT captured. Across the whole upstream dump it only
            # ever names ``reasoning_content`` (211 models) or
            # ``reasoning_details`` (2), and extract_openai_compat_reasoning
            # already reads both — recording it would be dead weight in the
            # snapshot and dead code in the parser. Revisit if upstream starts
            # declaring a key we do not handle.

            if record:
                out[model_id] = record
    return dict(sorted(out.items()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    raw = _fetch(args.url)
    models = distill(raw)
    if not models:
        raise SystemExit("refusing to write an empty snapshot")
    free = free_by_provider(raw)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {"source": args.url, "models": models, "free_by_provider": free},
            indent=1,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {args.out} · {len(models)} models from {len(raw)} providers · "
        f"free prices for {len(free)} providers"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
