"""Turn-scoped command boundaries and required deployment isolation."""

import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .sandbox_backends import BackendChoice


def isolated_auto_execution() -> bool:
    from runtime.platform.process.session import current_session
    from runtime.safety.approval.permission_modes import canonical_permission_mode

    session = current_session()
    return (
        session is not None
        and canonical_permission_mode(session.metadata.get("permission_mode")) == "autoSandbox"
    )


def command_sandbox_required() -> bool:
    from .sandbox import process_sandbox_required

    return isolated_auto_execution() or process_sandbox_required()


def local_command_execution() -> bool:
    """Use the effective task scope; metadata cannot override a sandbox ceiling."""
    from runtime.platform.process.scope import resolve_execution_scope
    from runtime.platform.process.session import current_session

    if command_sandbox_required():
        return False
    session = current_session()
    if session is None:
        return False
    scope = resolve_execution_scope(session)
    return scope.permission_mode == "bypassPermissions" and scope.execution_environment == "local"


def command_boundary(cwd: str | None, sandbox_dir: str | None) -> tuple[str | None, str | None]:
    """A scoped tool's directory is not a request to isolate full-access commands."""
    if sandbox_dir is not None and local_command_execution():
        from runtime.safety.auth.path_guard import normalize_scoped_relative_path

        root = Path(sandbox_dir).expanduser().resolve()
        directory = Path(cwd).expanduser() if cwd else root
        if not directory.is_absolute():
            directory = root / normalize_scoped_relative_path(directory, root)
        return str(directory.resolve()), None
    return cwd, sandbox_dir


def command_process_backend() -> "BackendChoice":
    from .sandbox import effective_process_sandbox_mode, resolved_process_backend

    # Apply the turn's hard requirement to commands, not model login or trusted
    # plugin control planes that must communicate with their local applications.
    if isolated_auto_execution():
        return resolved_process_backend("strict")
    if local_command_execution():
        # Honor the effective full-access scope for backend selection too.
        # Explicit hard requirements and parent ceilings are checked above.
        return resolved_process_backend("direct")
    if os.environ.get("ECHO_PROCESS_SANDBOX") or os.environ.get("ECHO_DEPLOYMENT_MODE"):
        return resolved_process_backend(effective_process_sandbox_mode())
    return resolved_process_backend()
