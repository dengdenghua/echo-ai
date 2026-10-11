"""Canonical paths inside a mount, including compatibility with active old leases."""

from runtime.platform.io.lease import FileLease, LeaseStore


def workspace_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    parts = normalized.lstrip("/").split("/")
    if (
        normalized.startswith("//")
        or normalized.lstrip("/").startswith("~")
        or ":" in normalized
        or any(ord(char) < 32 for char in normalized)
        or ".." in parts
    ):
        raise ValueError("invalid workspace-relative path")
    return "/".join(part for part in parts if part not in {"", "."})


def conflicting_workspace_lease(
    store: LeaseStore, workspace_id: str, path: str, holder_id: str | None
) -> FileLease | None:
    # New HTTP acquisitions use canonical paths. Do not delete or bypass
    # still-active legacy aliases during an upgrade; let their TTLs expire.
    for lease in store.list_active(workspace_id):
        try:
            candidate = workspace_relative_path(lease.file_path)
        except ValueError:
            continue
        if candidate == path and lease.holder_id != holder_id:
            return lease
    return None
