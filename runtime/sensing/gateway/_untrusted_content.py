"""Response hardening for user/agent-generated files served inline.

Thread uploads, workspace outputs, deployments and design assets are written
by users or (potentially prompt-injected) agents, yet they are served from
the same origin as the API.  Rendered inline, an ``.html``/``.svg``/``.xml``
file would run script with the app's origin — reading
``sessionStorage.echo_auth_token`` or calling admin APIs with the session
cookie.

Every inline response for such content therefore carries a
``Content-Security-Policy: sandbox`` header.  The browser renders the
document in an *opaque* origin, so even when scripts are allowed (agent-built
web apps, interactive HTML reports) they cannot touch the app's storage,
cookies or same-origin APIs.  ``allow-same-origin`` is never granted.

``application/pdf`` is the one exemption: browsers refuse to run their PDF
viewer inside a sandboxed document, and the viewer never executes with the
serving origin anyway.  Downloads (``Content-Disposition: attachment``) never
become documents, so they only get ``nosniff``.
"""

from __future__ import annotations

import mimetypes
from os import PathLike
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi.responses import FileResponse

# Same-origin framing stays allowed (the workspace previews iframe these
# URLs); cross-origin clickjacking stays blocked, matching the app-wide
# ``frame-ancestors 'self'`` default this header replaces.
_FRAME_ANCESTORS = "frame-ancestors 'self'"

#: Opaque origin, no script: plain file / artifact views (SVG, XML, unknown).
SANDBOX_CSP = f"sandbox; {_FRAME_ANCESTORS}"

#: Opaque origin with script: interactive HTML documents that the product
#: legitimately runs (HTML artifact previews, deployed agent-built sites).
#: Never combined with ``allow-same-origin``.
SANDBOX_SCRIPTS_CSP = (
    f"sandbox allow-scripts allow-forms allow-popups allow-modals; {_FRAME_ANCESTORS}"
)

# The only types that may run script under ``SANDBOX_SCRIPTS_CSP``.  SVG,
# XML/XSLT and every other active type stay script-free.
_HTML_MEDIA_TYPES = frozenset({"text/html", "application/xhtml+xml"})

# Types that break inside a sandboxed document and never execute with the
# serving origin.  Everything else — active types (HTML, XHTML, SVG, XML,
# XSLT) as well as unknown types browsers might sniff — gets the sandbox;
# for passive media (images, audio, video, text) it is a harmless no-op.
_SANDBOX_EXEMPT_MEDIA_TYPES = frozenset({"application/pdf"})


def _essence(media_type: str | None) -> str:
    return str(media_type or "").split(";", 1)[0].strip().lower()


def is_html_media_type(media_type: str | None) -> bool:
    return _essence(media_type) in _HTML_MEDIA_TYPES


def guess_media_type(path: str | PathLike[str]) -> str:
    """Mirror Starlette's ``FileResponse`` guess so headers match the body."""
    return mimetypes.guess_type(str(path))[0] or "text/plain"


def untrusted_content_headers(
    media_type: str | None,
    *,
    allow_scripts: bool = False,
    download: bool = False,
) -> dict[str, str]:
    """Headers for serving untrusted file bytes from the app origin.

    ``allow_scripts`` only relaxes the sandbox for HTML/XHTML documents; SVG,
    XML and unknown types stay script-free regardless.
    """
    headers = {"X-Content-Type-Options": "nosniff"}
    if download or _essence(media_type) in _SANDBOX_EXEMPT_MEDIA_TYPES:
        return headers
    scripted = allow_scripts and is_html_media_type(media_type)
    headers["Content-Security-Policy"] = SANDBOX_SCRIPTS_CSP if scripted else SANDBOX_CSP
    return headers


def untrusted_file_response(
    path: str | PathLike[str],
    *,
    filename: str | None = None,
    download: bool = False,
    media_type: str | None = None,
    allow_scripts: bool = False,
    headers: dict[str, str] | None = None,
    **kwargs: Any,
) -> FileResponse:
    """``FileResponse`` for user/agent-generated content with sandbox headers."""
    from fastapi.responses import FileResponse

    resolved_type = media_type or guess_media_type(filename or path)
    merged = dict(headers or {})
    merged.update(
        untrusted_content_headers(
            resolved_type,
            allow_scripts=allow_scripts,
            download=download,
        )
    )
    return FileResponse(
        path,
        media_type=resolved_type,
        filename=filename,
        headers=merged,
        **kwargs,
    )


__all__ = [
    "SANDBOX_CSP",
    "SANDBOX_SCRIPTS_CSP",
    "guess_media_type",
    "is_html_media_type",
    "untrusted_content_headers",
    "untrusted_file_response",
]
