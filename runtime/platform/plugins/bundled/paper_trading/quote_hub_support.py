"""Sources, payload normalization, and subscriptions for :class:`QuoteHub`.

Extracted from ``quote_hub`` to keep the hub class under the god-file
threshold. The hub module re-imports every name, so ``from .quote_hub
import X`` keeps working unchanged.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

QuoteCallback = Callable[[str, Any], None]


@runtime_checkable
class QuotePushSource(Protocol):
    """Minimal protocol implemented by a push source.

    A polling/MCP provider can implement this directly.  The callback retains
    LivePush's convenient ``callback(event, data)`` shape while symbol updates
    and transport-specific event names stay outside the hub.
    """

    def subscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        """Add ``codes`` to the set delivered to ``callback``."""

        ...

    def unsubscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        """Remove ``codes`` from the set delivered to ``callback``."""

        ...


class CallbackQuoteSourceAdapter:
    """Adapt an event-based push client (including ``LivePushClient``).

    The wrapped object is intentionally typed as ``Any``: structural checks
    happen at this narrow boundary and importing the concrete platform client
    would defeat the protocol separation.
    """

    def __init__(self, client: Any, *, event: str = "kLineRealTime") -> None:
        self._client = client
        self._event = event
        self._lock = threading.Lock()
        self._codes: dict[QuoteCallback, set[str]] = {}

    def subscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        with self._lock:
            merged = set(self._codes.get(callback, set()))
            merged.update(codes)
            self._client.subscribe(self._event, sorted(merged), callback)
            self._codes[callback] = merged

    def unsubscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        with self._lock:
            remaining = set(self._codes.get(callback, set()))
            remaining.difference_update(codes)
            if remaining:
                # LivePush's subscribe replaces the event parameter list.
                self._client.subscribe(self._event, sorted(remaining), callback)
                self._codes[callback] = remaining
            else:
                self._client.unsubscribe(self._event, callback)
                self._codes.pop(callback, None)


class PollingQuoteSource:
    """Wrap a batch snapshot callable as a push-shaped fallback source.

    The worker exists only while at least one callback owns codes.  All codes
    are fetched once per interval as one union, so downstream user count never
    multiplies upstream requests.
    """

    def __init__(
        self,
        fetcher: Callable[[list[str]], Any],
        *,
        interval: float = 3.0,
        event: str = "kLineRealTime",
    ) -> None:
        if interval <= 0:
            raise ValueError("poll interval must be positive")
        self._fetcher = fetcher
        self._interval = float(interval)
        self._event = event
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._codes: dict[QuoteCallback, set[str]] = {}
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive()

    def subscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        started = False
        with self._lock:
            merged = set(self._codes.get(callback, set()))
            merged.update(codes)
            self._codes[callback] = merged
            if not self.running:
                self._thread = threading.Thread(
                    target=self._run,
                    name="paper-trading-quote-poller",
                    daemon=True,
                )
                self._thread.start()
                started = True
        if not started:
            self._wake.set()

    def unsubscribe(self, codes: Sequence[str], callback: QuoteCallback) -> None:
        with self._lock:
            remaining = set(self._codes.get(callback, set()))
            remaining.difference_update(codes)
            if remaining:
                self._codes[callback] = remaining
            else:
                self._codes.pop(callback, None)
        self._wake.set()

    def _run(self) -> None:
        while True:
            with self._lock:
                callbacks = {
                    callback: frozenset(codes) for callback, codes in self._codes.items() if codes
                }
                union = sorted({code for codes in callbacks.values() for code in codes})
                if not callbacks:
                    self._thread = None
                    return
            try:
                payload = {"data": self._fetcher(union)}
            except Exception as exc:  # noqa: BLE001 - provider isolation boundary
                payload = {"data": [], "error": str(exc)[:300]}
            for callback in callbacks:
                try:
                    callback(self._event, payload)
                except Exception:
                    # A consumer callback cannot stop the shared poller.
                    continue
            self._wake.wait(self._interval)
            self._wake.clear()


QUOTE_FIELDS: tuple[str, ...] = (
    "code",
    "name",
    "market",
    "exchange",
    "state",
    "price",
    "change_pct",
    "change",
    "open",
    "high",
    "low",
    "prev_close",
    "volume",
    "amount",
    "turnover",
    "amplitude",
    "pe",
    "pb",
    "bids",
    "asks",
    "source",
    "source_ts",
    "received_at",
    "seq",
    "stale",
)


def _utc_iso(epoch: float) -> str:
    return (
        datetime.fromtimestamp(epoch, tz=UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _source_timestamp(value: Any) -> str:
    """Return a JSON-safe source timestamp without inventing vendor time."""

    if value in (None, ""):
        return ""
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
        return dt.isoformat(timespec="milliseconds")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        epoch = float(value)
        if epoch > 10_000_000_000:  # common millisecond Unix timestamp
            epoch /= 1000.0
        try:
            return _utc_iso(epoch)
        except (OverflowError, OSError, ValueError):
            return str(value)
    return str(value)


def _canonical_code(value: Any, exchange: Any = "") -> str:
    code = str(value or "").strip()
    if not code:
        return ""
    if "." in code:
        base, suffix = code.rsplit(".", 1)
        return f"{base.strip()}.{suffix.strip().lower()}"
    exchange_text = str(exchange or "").strip().lower()
    suffixes = {
        "sh": "sh",
        "sse": "sh",
        "xshg": "sh",
        "sz": "sz",
        "sze": "sz",
        "szse": "sz",
        "xshe": "sz",
        "bj": "bj",
        "bse": "bj",
        "xbje": "bj",
    }
    suffix = suffixes.get(exchange_text, "")
    return f"{code}.{suffix}" if suffix else code


def _base_code(code: str) -> str:
    return code.rsplit(".", 1)[0]


def _pick(raw: Mapping[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in raw and raw[name] is not None:
            return raw[name]
    return default


def _extract_quote_rows(payload: Any) -> list[Mapping[str, Any]]:
    """Accept LivePush, normalized, or adapter payload shapes."""

    if isinstance(payload, (list, tuple)):
        return [row for row in payload if isinstance(row, Mapping)]
    if not isinstance(payload, Mapping):
        return []

    nested = payload.get("data")
    if isinstance(nested, (list, tuple)):
        return [row for row in nested if isinstance(row, Mapping)]
    if isinstance(nested, Mapping):
        rows = _extract_quote_rows(nested)
        if rows:
            return rows

    # A quote response wrapper often also has ``code``; require a quote-like
    # field before treating the mapping itself as one row.
    if any(
        key in payload
        for key in (
            "stockCode",
            "symbol",
            "price",
            "currentPrice",
            "last",
            "lastPrice",
        )
    ):
        return [payload]
    return []


def normalize_quote(
    raw: Mapping[str, Any],
    *,
    source: str,
    received_epoch: float,
    seq: int,
) -> dict[str, Any]:
    """Normalize one vendor row into the stable public quote schema."""

    exchange = _pick(raw, "exchange", "exchangeType", "exchange_code", default="")
    code = _canonical_code(
        _pick(raw, "code", "stockCode", "symbol", "securityCode", default=""), exchange
    )
    source_ts = _pick(
        raw,
        "source_ts",
        "ts",
        "lastUpdateDate",
        "updateTime",
        "timestamp",
        "time",
        default="",
    )
    result: dict[str, Any] = {
        "code": code,
        "name": _pick(raw, "name", "stockName", "securityName", default=""),
        "market": _pick(raw, "market", "marketType", default=""),
        "exchange": exchange,
        "state": _pick(raw, "state", "stockState", "status", default=""),
        "price": _pick(raw, "price", "currentPrice", "last", "lastPrice"),
        "change_pct": _pick(raw, "change_pct", "stockIncrease", "pctChange", "changePct"),
        "change": _pick(raw, "change", "stockRiseFall", "priceChange"),
        "open": _pick(raw, "open", "openPrice"),
        "high": _pick(raw, "high", "highPrice"),
        "low": _pick(raw, "low", "lowPrice"),
        "prev_close": _pick(raw, "prev_close", "yClose", "preClose", "previousClose"),
        "volume": _pick(raw, "volume", "vol"),
        "amount": _pick(raw, "amount", "turnoverAmount"),
        "turnover": _pick(raw, "turnover", "exchangeRate", "turnoverRate"),
        "amplitude": _pick(raw, "amplitude"),
        "pe": _pick(raw, "pe", "peRatio"),
        "pb": _pick(raw, "pb", "pbRatio"),
        "bids": list(_pick(raw, "bids", "tenGearBuy", default=[]) or []),
        "asks": list(_pick(raw, "asks", "tenGearSell", default=[]) or []),
        "source": source,
        "source_ts": _source_timestamp(source_ts),
        "received_at": _utc_iso(received_epoch),
        "seq": seq,
        "stale": False,
    }
    # Keep the public contract exact and deterministic.
    return {field_name: result[field_name] for field_name in QUOTE_FIELDS}


@dataclass
class _SourceHealth:
    name: str
    source: QuotePushSource
    priority: int
    state: str = "standby"
    consecutive_failures: int = 0
    recovery_successes: int = 0
    recovery_started_epoch: float = 0.0
    total_failures: int = 0
    total_successes: int = 0
    last_success_epoch: float = 0.0
    last_failure_epoch: float = 0.0
    last_failure_check_epoch: float = 0.0
    last_error: str = ""
    attached_codes: tuple[str, ...] | None = None
    callback: QuoteCallback | None = None


class QuoteSubscription:
    """One downstream consumer with a bounded, latest-wins queue."""

    def __init__(
        self,
        subscriber_id: str,
        codes: Iterable[str],
        *,
        max_queue: int,
        on_close: Callable[[str], None],
    ) -> None:
        self.id = subscriber_id
        self._codes = frozenset(codes)
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=max_queue)
        self._on_close = on_close
        self._lock = threading.Lock()
        self._closed = False
        self._dropped = 0

    @property
    def codes(self) -> frozenset[str]:
        with self._lock:
            return self._codes

    @property
    def closed(self) -> bool:
        with self._lock:
            return self._closed

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped

    @property
    def pending(self) -> int:
        return self._queue.qsize()

    @property
    def max_queue(self) -> int:
        return self._queue.maxsize

    def get(self, timeout: float | None = None) -> dict[str, Any]:
        """Read the next REST/SSE-ready event."""

        if timeout is None:
            return self._queue.get()
        return self._queue.get(timeout=timeout)

    def get_nowait(self) -> dict[str, Any]:
        return self._queue.get_nowait()

    def drain(self, limit: int | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        while limit is None or len(items) < limit:
            try:
                items.append(self._queue.get_nowait())
            except queue.Empty:
                break
        return items

    def close(self) -> None:
        """Idempotently remove this subscription from its hub."""

        self._on_close(self.id)

    def _set_codes(self, codes: Iterable[str]) -> None:
        with self._lock:
            self._codes = frozenset(codes)

    def _offer(self, event: dict[str, Any]) -> None:
        with self._lock:
            if self._closed:
                return
        try:
            self._queue.put_nowait(event)
            return
        except queue.Full:  # expected: slow clients drop the oldest quote below
            pass
        # Quotes are state, not an audit log: retain the newest event and drop
        # the oldest one for a slow client.  The counter remains observable.
        with suppress(queue.Empty):  # another consumer may have drained it
            self._queue.get_nowait()
        with self._lock:
            self._dropped += 1
            if self._closed:
                return
        try:
            self._queue.put_nowait(event)
        except queue.Full:  # concurrent producer won the freed slot
            with self._lock:
                self._dropped += 1

    def _mark_closed(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        # Wake a blocking SSE worker.  This event follows the same JSON-ready
        # shape as other hub control events.
        try:
            self._queue.put_nowait({"type": "closed", "subscriber_id": self.id})
        except queue.Full:
            with suppress(queue.Empty):
                self._queue.get_nowait()
            with suppress(queue.Full):
                self._queue.put_nowait({"type": "closed", "subscriber_id": self.id})
