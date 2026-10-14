"""Dependency-free HTML text extraction for web fetch fallback."""


def _strip_html_fallback(html: str) -> str:
    """Regex-based fallback when trafilatura is unavailable.

    Strips <script>/<style> blocks then tags via html.parser, collapsing
    whitespace. Lossy but enough for ad-hoc Q&A.
    """
    import re
    from html.parser import HTMLParser

    cleaned = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>",
        " ",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    class _Stripper(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self._chunks: list[str] = []

        def handle_data(self, data: str) -> None:
            self._chunks.append(data)

        def text(self) -> str:
            return "".join(self._chunks)

    parser = _Stripper()
    try:  # noqa: SIM105
        parser.feed(cleaned)
    except Exception:  # noqa: BLE001 — malformed HTML; return what we got
        pass
    return re.sub(r"\s+", " ", parser.text()).strip()
