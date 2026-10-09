"""This host's address on the local network."""

from __future__ import annotations

import socket


def lan_ip() -> str:
    """Best-effort LAN IP of this host (the address a phone on the same Wi-Fi
    should dial). Falls back to loopback if offline."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No packet is actually sent for a UDP connect; it just picks the
        # outbound interface so getsockname() yields the LAN address.
        sock.connect(("8.8.8.8", 80))
        return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


__all__ = ["lan_ip"]
