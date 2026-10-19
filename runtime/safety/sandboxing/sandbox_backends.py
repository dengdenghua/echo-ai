"""Platform sandbox backends (direct / bubblewrap / seatbelt / landlock).

Extracted from ``sandbox`` to keep that module under the god-file threshold.
The parent module re-imports these classes, so ``sandbox.BubblewrapBackend``
(and test monkeypatches on its class attributes) keep working.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from runtime.safety.sandboxing._landlock_wrapper import LANDLOCK_WRAPPER

if TYPE_CHECKING:
    from runtime.safety.sandboxing.sandbox import SandboxEnforcement, SandboxPolicy


class Backend(Protocol):
    """Plug point for platform-specific sandbox launchers.

    Implementations rewrite the ``argv``/``env``/``cwd`` to invoke the
    actual command under their isolation primitive (e.g. ``bwrap --
    <argv>`` on Linux). The default ``DirectBackend`` returns the input
    unchanged.
    """

    def transform(
        self,
        argv: list[str],
        env: dict[str, str],
        cwd: Path,
        policy: SandboxPolicy,
    ) -> tuple[list[str], dict[str, str], Path]: ...

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        """Report how completely this backend governs the policy tier.

        ``full`` / ``partial`` only mean anything for confined tiers
        (``read-only`` / ``workspace-write``); ``danger-full-access``
        consumers bypass confinement entirely.
        """
        ...


@dataclass(frozen=True)
class BackendChoice:
    """Resolved process sandbox backend for one command."""

    backend: Backend
    name: str
    hard: bool
    strict: bool = False
    needs_approval: bool = False


@dataclass(frozen=True)
class DirectBackend:
    """No isolation primitive applied — soft constraints only.

    Used by default. Replaceable by a caller who has bubblewrap /
    sandbox-exec / Job Object configured.
    """

    def transform(
        self,
        argv: list[str],
        env: dict[str, str],
        cwd: Path,
        policy: SandboxPolicy,
    ) -> tuple[list[str], dict[str, str], Path]:
        return argv, env, cwd

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        return "none"


@dataclass(frozen=True)
class BubblewrapBackend:
    """Linux hard sandbox backend using ``bwrap``.

    The workspace is bind-mounted read/write at its original absolute
    path so callers can keep using host paths. System directories are
    mounted read-only; home directories and unrelated project folders
    are not mounted unless they are the workspace.
    """

    executable: str = "bwrap"

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        return "full"

    @staticmethod
    def available() -> bool:
        return shutil.which("bwrap") is not None

    def transform(
        self,
        argv: list[str],
        env: dict[str, str],
        cwd: Path,
        policy: SandboxPolicy,
    ) -> tuple[list[str], dict[str, str], Path]:
        workspace = policy.workspace.expanduser().resolve()
        run_cwd = cwd.expanduser().resolve()
        try:
            run_cwd.relative_to(workspace)
        except ValueError as exc:
            raise SandboxViolation(f"cwd {run_cwd} escapes workspace {workspace}") from exc

        bwrap = shutil.which(self.executable)
        if not bwrap:
            raise SandboxViolation("bubblewrap sandbox requested but bwrap is not installed")

        wrapped: list[str] = [
            bwrap,
            "--die-with-parent",
            "--new-session",
            "--unshare-pid",
            "--unshare-ipc",
            "--unshare-uts",
            "--unshare-cgroup",
        ]
        if not policy.allow_network:
            wrapped.append("--unshare-net")

        system_mounts: list[Path] = []
        for path in ("/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"):
            if Path(path).exists():
                wrapped.extend(["--ro-bind", path, path])
                system_mounts.append(Path(path).resolve(strict=False))
        if Path("/dev").exists():
            wrapped.extend(["--dev", "/dev"])
        if Path("/proc").exists():
            wrapped.extend(["--proc", "/proc"])
        wrapped.extend(["--tmpfs", "/tmp"])  # bwrap mount arg, not a temp file  # nosec B108

        mount_roots = _unique_paths([workspace, *policy.additional_write_roots])
        namespace_parents: list[Path] = []
        for mount_root in mount_roots:
            for parent in reversed(mount_root.parents):
                if parent.parent == parent:
                    continue
                if any(parent == system or system in parent.parents for system in system_mounts):
                    continue
                if parent not in namespace_parents:
                    namespace_parents.append(parent)
        for parent in namespace_parents:
            # /tmp already exists as the private tmpfs mounted above; its
            # descendants still need explicit namespace directories.
            if parent != Path("/tmp"):  # nosec B108
                wrapped.extend(["--dir", str(parent)])

        workspace_flag = "--ro-bind" if policy.mode == "read-only" else "--bind"
        mount_specs = [
            (workspace, workspace_flag),
            *[(root, "--bind") for root in policy.additional_write_roots],
        ]
        # A deeper exact root must be mounted after its parent so it cannot be
        # hidden by a later broad bind.  This is especially relevant to a
        # thread state root plus its task-scoped child.
        for source, flag in sorted(mount_specs, key=lambda item: len(item[0].parts)):
            wrapped.extend([flag, str(source), str(source)])
        wrapped.extend(["--chdir", str(run_cwd), "--"])
        wrapped.extend(argv)
        return wrapped, env, run_cwd


@dataclass(frozen=True)
class SeatbeltBackend:
    """macOS hard write/network sandbox using ``sandbox-exec``.

    Seatbelt profiles that fully confine reads tend to break language
    runtimes without a curated framework allow-list, so this backend is
    intentionally scoped as a hard write/network guard: it allows reads
    needed to launch tooling, denies network unless explicitly allowed,
    and restricts writes to the workspace plus temporary directories.
    """

    executable: str = "sandbox-exec"

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        # Reads are intentionally unconfined (full read confinement breaks
        # language runtimes without a curated framework allow-list), so the
        # write/network guard is only a partial enforcement of the tier.
        return "partial"

    @staticmethod
    def available() -> bool:
        return shutil.which("sandbox-exec") is not None and sys.platform == "darwin"

    def transform(
        self,
        argv: list[str],
        env: dict[str, str],
        cwd: Path,
        policy: SandboxPolicy,
    ) -> tuple[list[str], dict[str, str], Path]:
        workspace = policy.workspace.expanduser().resolve()
        run_cwd = cwd.expanduser().resolve()
        try:
            run_cwd.relative_to(workspace)
        except ValueError as exc:
            raise SandboxViolation(f"cwd {run_cwd} escapes workspace {workspace}") from exc

        sandbox_exec = shutil.which(self.executable)
        if not sandbox_exec:
            raise SandboxViolation("seatbelt sandbox requested but sandbox-exec is not installed")

        if policy.mode == "read-only":
            write_subpaths = ["/dev/null", *(str(path) for path in policy.additional_write_roots)]
        else:
            write_subpaths = [
                str(workspace),
                "/dev/null",
                "/tmp",  # nosec B108 — sandbox write-allow rule target, not a temp file
                "/private/tmp",  # nosec B108 — sandbox write-allow rule target, not a temp file
                "/var/tmp",  # nosec B108 — sandbox write-allow rule target, not a temp file
                str(Path(os.environ.get("TMPDIR", "/tmp")).expanduser().resolve(strict=False)),  # nosec B108 — sandbox write-allow rule target
                *(str(path) for path in policy.additional_write_roots),
            ]
        write_rules = "\n".join(
            f'  (subpath "{_sbpl_escape(path)}")' for path in dict.fromkeys(write_subpaths)
        )
        network_rule = "(allow network*)" if policy.allow_network else "(deny network*)"
        profile = (
            "(version 1)\n"
            "(deny default)\n"
            "(allow process*)\n"
            "(allow signal (target same-sandbox))\n"
            "(allow sysctl-read)\n"
            "(allow mach-lookup)\n"
            "(allow file-read*)\n"
            f"(allow file-write*\n{write_rules})\n"
            f"{network_rule}\n"
        )
        return [sandbox_exec, "-p", profile, *argv], env, run_cwd


def _landlock_kernel_available() -> bool:
    """True when the running Linux kernel exposes Landlock (>= 5.13)."""

    if not sys.platform.startswith("linux"):
        return False
    try:
        release = Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").strip()
    except OSError:
        return False
    match = re.match(r"(\d+)\.(\d+)", release)
    if not match:
        return False
    major, minor = (int(part) for part in match.groups())
    return (major, minor) >= (5, 13)


@dataclass(frozen=True)
class LandlockBackend:
    """Linux kernel-native sandbox backend using the Landlock LSM.

    Unlike ``bwrap`` this needs no setuid helper or user namespaces — the
    ruleset is applied by the process itself before exec. Read/execute of
    the whole tree stays allowed; writes are confined to the workspace plus
    the runner's temp dirs (``workspace-write``) or to ``/dev/null`` only
    (``read-only``). Network is outside Landlock's vocabulary, matching the
    dsh sandbox seam (soft network hints still apply via the policy).
    """

    executable: str = sys.executable

    @staticmethod
    def available() -> bool:
        return _landlock_kernel_available()

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        # Reads are intentionally unconfined and network is outside
        # Landlock's vocabulary, so only the write confinement of the tier
        # is actually enforced — reporting "full" would mislead operators
        # into believing the process is fully confined (it can still read
        # any file and exfiltrate over a bare socket). Same criterion as
        # SeatbeltBackend, which reports "partial" for the same reason.
        return "partial"

    def transform(
        self,
        argv: list[str],
        env: dict[str, str],
        cwd: Path,
        policy: SandboxPolicy,
    ) -> tuple[list[str], dict[str, str], Path]:
        workspace = policy.workspace.expanduser().resolve()
        run_cwd = cwd.expanduser().resolve()
        try:
            run_cwd.relative_to(workspace)
        except ValueError as exc:
            raise SandboxViolation(f"cwd {run_cwd} escapes workspace {workspace}") from exc
        if not _landlock_kernel_available():
            raise SandboxViolation(
                "landlock sandbox requested but the kernel does not expose Landlock (>= 5.13)"
            )

        write_paths: list[str] = [str(path) for path in policy.additional_write_roots]
        if policy.mode != "read-only":
            write_paths.append(str(workspace))
            for key in (
                "HOME",
                "TMPDIR",
                "TMP",
                "TEMP",
                "XDG_CACHE_HOME",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
            ):
                value = env.get(key)
                if value and value not in write_paths:
                    write_paths.append(value)

        wrapped_env = dict(env)
        wrapped_env["ECHO_LANDLOCK_SPEC"] = json.dumps({"write_paths": write_paths})
        wrapped: list[str] = [self.executable, "-c", LANDLOCK_WRAPPER, "--", *argv]
        return wrapped, wrapped_env, run_cwd


def _sbpl_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class SandboxViolation(Exception):
    """Raised when a request would escape the policy.

    Distinct from a non-zero exit code — the command did not even run.
    Caller should surface this as ``status=rejected`` so the planner
    distinguishes "not allowed" from "ran and failed".
    """


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for path in paths:
        key = str(path)
        if key not in seen:
            seen.add(key)
            out.append(path)
    return out
