"""Pre-authorized write directories — consent once for a place, not per file.

The real blocker for unattended project execution is not notification latency:
it is that every ``write_text_file`` is in ``DANGEROUS_TOOLS``, so a phase that
produces twenty documents asks twenty times. Routing those questions to email
does not fix it — it just moves twenty questions into a mailbox. What removes the
stall is the user saying, once and explicitly, "documents under *this* directory
are what I asked you to produce; write them".

So this is consent scoped to a **place**, granted ahead of time, and it lowers
the assessed risk of a write confined to that place from ``high``
(``filesystem_write``) to ``low``. It does not bypass the approval gate, does not
touch ``WriteScope``, and grants nothing outside the named directories.

What it deliberately does **not** cover, because each would turn "write my
documents" into something the user did not agree to:

* **Anything outside the declared directories**, after resolving symlinks. A
  symlink inside the directory pointing out of it is an escape, not a write.
* **Executable and script targets.** A pre-authorized ``.sh`` / ``.ps1`` /
  ``.py`` write is a way to get code execution approved as "a document".
* **Dotfiles and configuration.** ``.env``, ``.git/*``, CI configuration and
  shell profiles change behaviour rather than recording work.
* **Non-write tools.** Shell execution, deletion and VCS mutation are unaffected
  whatever directory they name.
* **Deletion or truncation of existing files.** The grant covers producing
  deliverables, not destroying earlier ones.

The credential denylist in the executor (``check_file_write``) and ``WriteScope``
both still apply — this layer only relaxes *how often the user is asked* about
writes those layers already permit.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from runtime.safety.approval.approval_gate import ApprovalRisk

_logger = logging.getLogger(__name__)

# Writing any of these is a code-execution or behaviour change, not a document.
_EXECUTABLE_SUFFIXES = frozenset(
    {
        ".sh",
        ".bash",
        ".zsh",
        ".fish",
        ".ps1",
        ".psm1",
        ".bat",
        ".cmd",
        ".com",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".py",
        ".pyw",
        ".rb",
        ".pl",
        ".php",
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        ".jar",
        ".scpt",
        ".applescript",
        ".vbs",
        ".wsf",
        ".reg",
        ".desktop",
        ".service",
    }
)

# Directory names that carry configuration or version-control state.
_FORBIDDEN_PATH_PARTS = frozenset(
    {
        ".git",
        ".github",
        ".gitlab",
        ".hg",
        ".svn",
        ".ssh",
        ".gnupg",
        ".aws",
        ".config",
        ".claude",
        "node_modules",
        "__pycache__",
    }
)

# Write tools this grant may cover. Enumerated rather than derived from a
# prefix: ``delete_`` and ``exec_`` also start with letters, and a new
# ``write_``-prefixed tool must be reviewed before it inherits this consent.
_COVERED_TOOLS = frozenset({"write_text_file", "append_text_file"})


@dataclass(frozen=True, slots=True)
class PreauthorizedWriteGrant:
    """Directories whose document writes the user approved ahead of time."""

    directories: tuple[Path, ...]
    granted_by: str = ""

    @classmethod
    def of(cls, directories: object, *, granted_by: str = "") -> PreauthorizedWriteGrant:
        """Build a grant from user-declared paths, dropping anything unusable.

        Relative entries are dropped rather than resolved against the current
        directory: ``Path.resolve()`` would silently prepend the process CWD,
        which is the privilege-escalation shape ADR-002 already pinned a test
        against for ``extra_workspaces``.
        """

        if not isinstance(directories, (list, tuple, set, frozenset)):
            return cls(())
        resolved: list[Path] = []
        for entry in directories:
            text = str(entry or "").strip()
            if not text:
                continue
            candidate = Path(text)
            if not candidate.is_absolute():
                _logger.debug("dropping relative pre-authorized directory %r", text)
                continue
            try:
                resolved.append(candidate.resolve())
            except OSError:
                _logger.debug("dropping unresolvable directory %r", text, exc_info=True)
        return cls(tuple(resolved), granted_by=str(granted_by or ""))

    def covers(self, target: str | Path) -> bool:
        """Whether ``target`` lands inside a declared directory.

        Resolves the target first, so a symlink planted inside a granted
        directory cannot redirect a write outside it.
        """

        if not self.directories:
            return False
        try:
            resolved = Path(target).resolve()
        except OSError:
            return False
        for directory in self.directories:
            try:
                resolved.relative_to(directory)
            except ValueError:
                continue
            return True
        return False


@dataclass(frozen=True, slots=True)
class WriteRelaxation:
    """Whether one write may proceed on pre-authorized consent."""

    relaxed: bool
    reason: str

    @property
    def still_needs_approval(self) -> bool:
        return not self.relaxed


def relax_document_write(
    *,
    tool_name: str,
    target: str | Path | None,
    risk: ApprovalRisk,
    grant: PreauthorizedWriteGrant | None,
    injection_tainted: bool = False,
) -> WriteRelaxation:
    """Decide whether a write inside a granted directory can skip asking.

    Every rejection path leaves the existing approval requirement untouched, so
    a missing grant, an unreadable path or an unrecognised tool simply behaves
    the way it does today.
    """

    if grant is None or not grant.directories:
        return WriteRelaxation(False, "no_preauthorized_directories")
    if injection_tainted or "prompt_injection_taint" in risk.categories:
        # Untrusted content steering a write is exactly when the user should be
        # asked, regardless of where the write lands.
        return WriteRelaxation(False, "injection_tainted")
    if tool_name not in _COVERED_TOOLS:
        return WriteRelaxation(False, f"tool_not_covered:{tool_name}")
    if risk.level == "critical":
        # A destructive-command classification outranks any directory consent.
        return WriteRelaxation(False, "critical_risk")
    if target is None:
        return WriteRelaxation(False, "no_write_target")

    path = Path(str(target))
    if path.suffix.lower() in _EXECUTABLE_SUFFIXES:
        return WriteRelaxation(False, f"executable_target:{path.suffix.lower()}")
    if path.name.startswith("."):
        return WriteRelaxation(False, "dotfile_target")
    if any(part in _FORBIDDEN_PATH_PARTS for part in path.parts):
        return WriteRelaxation(False, "configuration_or_vcs_path")
    if not grant.covers(path):
        return WriteRelaxation(False, "outside_preauthorized_directories")
    return WriteRelaxation(True, "preauthorized_document_write")


def relaxed_risk(risk: ApprovalRisk) -> ApprovalRisk:
    """The risk a pre-authorized write carries once consent already exists.

    Dropped to ``low`` so ``requires_approval`` is False, while the original
    categories are preserved for the audit trail: the journal must still show
    this was a filesystem write, and that it proceeded on a standing grant
    rather than on a fresh decision.
    """

    return ApprovalRisk(
        level="low",
        categories=(*risk.categories, "preauthorized_directory"),
        reason=(f"{risk.reason}; pre-authorized document directory").lstrip("; "),
    )
