"""The credential a request presents, for role checks outside ``resolve_principal``.

This lives outside :mod:`runtime.safety.auth.principal` on purpose: that module
is pinned by ``runtime/kernel-release.json`` (product principal adapter), so a
new public helper there would change a reviewed kernel source.
"""

from __future__ import annotations

from typing import Any

from runtime.safety.auth.principal import _request_token


def request_credential(request: Any) -> str:
    """The bearer token, WebSocket bearer or session cookie a request presents.

    Role checks must read the same credential as authentication: a browser
    whose tab-scoped token is gone (after a restart) authenticates with the
    HttpOnly session cookie alone.
    """
    return _request_token(request)


__all__ = ["request_credential"]
