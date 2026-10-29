"""ICE configuration shared with the paired phone, including expiring TURN credentials."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlsplit

VIDEO_PROFILES = {
    "auto": (1280, 15, 3),
    "smooth": (960, 24, 5),
    "sharp": (1920, 15, 3),
    "saver": (854, 8, 2),
}


def ice_servers(device_id: str, env=None, now: float | None = None) -> list[dict]:
    env = os.environ if env is None else env
    servers = json.loads(
        env.get("ECHO_REMOTE_ICE_SERVERS") or '[{"urls":"stun:stun.cloudflare.com:3478"}]'
    )
    if not isinstance(servers, list) or len(servers) > 8:
        raise ValueError("Invalid remote ICE configuration")
    if any(not isinstance(item, dict) for item in servers):
        raise ValueError("Invalid ICE server entry")
    servers = [dict(item) for item in servers]
    turn_urls = env.get("ECHO_REMOTE_TURN_URLS", "").split(",")
    secret = env.get("ECHO_REMOTE_TURN_SECRET", "")
    if any(turn_urls):
        if not secret:
            raise ValueError("TURN credential secret is missing")
        expiry = int(time.time() if now is None else now) + 3600
        # Avoid putting a device identifier into third-party TURN logs.
        username = f"{expiry}:{hashlib.sha256(device_id.encode()).hexdigest()[:16]}"
        password = base64.b64encode(
            hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
        ).decode()
        servers.append(
            {"urls": [u.strip() for u in turn_urls], "username": username, "credential": password}
        )
    for server in servers:
        if set(server) - {"urls", "username", "credential", "credentialType"}:
            raise ValueError("Unsupported ICE server option")
        if server.get("credentialType", "password") != "password":
            raise ValueError("Unsupported ICE credential type")
        urls = server.get("urls")
        urls = [urls] if isinstance(urls, str) else urls
        if not isinstance(urls, list) or not urls or len(urls) > 8:
            raise ValueError("Invalid ICE server URLs")
        for url in urls:
            if (
                not isinstance(url, str)
                or len(url) > 512
                or urlsplit(url).scheme not in {"stun", "stuns", "turn", "turns"}
            ):
                raise ValueError("Invalid ICE server URL")
        if any(u.startswith(("turn:", "turns:")) for u in urls) and not all(
            isinstance(server.get(k), str) and server[k] for k in ("username", "credential")
        ):
            raise ValueError("TURN credentials are missing")
    return servers


def has_relay(servers: list[dict]) -> bool:
    return any(
        url.startswith(("turn:", "turns:"))
        for s in servers
        for url in ([s["urls"]] if isinstance(s["urls"], str) else s["urls"])
    )
