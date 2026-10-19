"""Read bounded documentation from an enabled plugin, never arbitrary host files."""

from pathlib import Path
from typing import Any


def read_plugin_reference(
    skill_dir: Path, plugin_id: str, reference: str, offset: int, limit: int
) -> dict[str, Any]:
    from runtime.platform.capabilities.permission_grants import current_capability_permission_store
    from runtime.safety.auth.path_denylist import is_blocked

    try:
        current_capability_permission_store().require_granted(plugin_id, require_active=True)
        root = skill_dir.resolve(strict=True)
        document = (root / reference).resolve(strict=True)
        relative = document.relative_to(root)
        if (
            not relative.parts
            or relative.parts[0] != "references"
            or document.suffix.lower() not in {".md", ".rst", ".txt"}
            or not document.is_file()
        ):
            return {
                "error": "reference must be a documentation file inside this skill's references directory"
            }
        blocked, prefix = is_blocked(document, include_defaults=False)
        if blocked:
            return {"error": f"reference blocked by explicit path policy: {prefix}"}
        if document.stat().st_size > 1024 * 1024:
            return {"error": "reference exceeds 1 MiB documentation limit"}
        start, count = max(0, int(offset)), min(2000, max(1, int(limit)))
        lines = document.read_text(encoding="utf-8").splitlines()
        content = "\n".join(lines[start : start + count])
        bounded = content.encode("utf-8")[:65536].decode("utf-8", errors="ignore")
        return {
            "reference": reference,
            "content": bounded,
            "offset": start,
            "total_lines": len(lines),
            "truncated": start + count < len(lines) or bounded != content,
        }
    except (OSError, ValueError, RuntimeError, KeyError, PermissionError) as exc:
        return {"error": f"plugin reference unavailable: {type(exc).__name__}"}
