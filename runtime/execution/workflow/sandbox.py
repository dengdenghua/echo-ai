"""Launch the orchestration interpreter without host projects or credentials.

Linux uses a private filesystem, PID/user/network namespaces and a read-only
stdlib/code image. Unsupported local desktops retain the restricted DSL;
shared/production or explicitly strict execution never silently falls back.
Agent/tool requests still cross the existing authorized host dispatcher.
"""

from __future__ import annotations

import os
import shutil
import sys
import sysconfig
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path


class WorkflowSandboxUnavailable(RuntimeError):
    pass


@dataclass
class WorkerLaunch:
    argv: list[str]
    env: dict[str, str]
    cwd: str
    isolated: bool
    directory: tempfile.TemporaryDirectory[str]

    def close(self) -> None:
        self.directory.cleanup()


def isolation_required() -> bool:
    deployment = os.getenv("ECHO_DEPLOYMENT_MODE", "local").strip().lower()
    mode = os.getenv("ECHO_PROCESS_SANDBOX", "auto").strip().lower()
    return deployment in {"production", "shared", "server", "commercial"} or mode not in {
        "",
        "auto",
        "soft",
        "direct",
        "off",
    }


def _worker_image(destination: Path) -> None:
    # Snapshot only these stdlib-only modules. No whole checkout, configuration,
    # installed plugins, sitecustomize, user site-packages or credentials.
    with zipfile.ZipFile(destination, "w") as image:
        image.writestr("echo_workflow/__init__.py", "")
        for name in ("worker", "protocol", "realm", "types"):
            image.write(Path(__file__).with_name(f"{name}.py"), f"echo_workflow/{name}.py")
        image.writestr(
            "__main__.py",
            "import sys\n"
            "if sys.platform == 'linux':\n"
            "    import resource\n"
            "    for kind, cap in [(resource.RLIMIT_CORE, 0), "
            "(resource.RLIMIT_AS, 268435456), (resource.RLIMIT_NOFILE, 64), "
            "(resource.RLIMIT_FSIZE, 8388608)]:\n"
            "        soft, hard = resource.getrlimit(kind)\n"
            "        limit = cap if hard == resource.RLIM_INFINITY else min(cap, hard)\n"
            "        resource.setrlimit(kind, (limit, limit))\n"
            "from echo_workflow.worker import main\n"
            "raise SystemExit(main())\n",
        )


def bubblewrap_argv(executable: str, image: Path) -> list[str]:
    """No project/home mount; only Python and system runtime libraries are visible."""
    stdlib = Path(sysconfig.get_path("stdlib")).resolve()
    python_home = "/runtime"
    python_lib = f"{python_home}/lib/python{sys.version_info.major}.{sys.version_info.minor}"
    argv = [
        executable,
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--cap-drop",
        "ALL",
        "--clearenv",
        "--setenv",
        "HOME",
        "/home/worker",
        "--setenv",
        "TMPDIR",
        "/tmp",
        "--setenv",
        "LANG",
        "C.UTF-8",
        "--setenv",
        "PYTHONHOME",
        python_home,
        "--tmpfs",
        "/tmp",
        "--dir",
        "/home/worker",
        "--dir",
        "/work",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
    ]
    # Dynamic linker/native extension dependencies. Do not bind /usr, /etc,
    # /run, /sys, host /tmp or the server's virtualenv/site-packages.
    multiarch = str(sysconfig.get_config_var("MULTIARCH") or "")
    library_dirs = [Path(p) for p in ("/lib", "/lib64", "/usr/lib", "/usr/lib64")]
    if multiarch and any((base / multiarch).is_dir() for base in library_dirs):
        # Debian/Ubuntu: bind native libraries only, not /usr/lib/python3's
        # global dist-packages or unrelated application directories.
        library_dirs = [base / multiarch for base in library_dirs if (base / multiarch).is_dir()]
        for base in (Path("/lib64"), Path("/usr/lib64")):
            if base.is_dir():
                library_dirs.append(base)
    for directory in library_dirs:
        if directory.is_dir():
            argv += ["--ro-bind", str(directory), str(directory)]
    argv += [
        "--ro-bind",
        str(Path(sys.executable).resolve()),
        f"{python_home}/bin/python",
        "--ro-bind",
        str(stdlib),
        python_lib,
    ]
    # A custom CPython may link libpython from its prefix rather than /usr/lib.
    library_root = Path(sysconfig.get_config_var("LIBDIR") or stdlib.parent)
    for library in sorted(library_root.glob("libpython*.so*")):
        if library.is_file():
            argv += ["--ro-bind", str(library.resolve()), f"{python_home}/lib/{library.name}"]
    argv += ["--setenv", "LD_LIBRARY_PATH", f"{python_home}/lib"]
    # -S disables site loading; masks also prevent explicit reads/imports from
    # site-packages if an interpreter-level escape is discovered in future.
    python_roots = [(stdlib, python_lib)]
    for library in library_dirs:
        python_roots.extend((directory, str(directory)) for directory in library.glob("python*"))
    for source, base in python_roots:
        for leaf in ("site-packages", "dist-packages"):
            if (source / leaf).is_dir():
                argv += ["--tmpfs", f"{base}/{leaf}"]
    argv += [
        "--ro-bind",
        str(image),
        "/worker.pyz",
        "--chdir",
        "/work",
        "--",
        f"{python_home}/bin/python",
        "-S",
        "-P",
        "-B",
        "-X",
        "utf8",
        "/worker.pyz",
    ]
    return argv


def prepare_worker_launch(env: dict[str, str]) -> WorkerLaunch:
    required = isolation_required()
    mode = os.getenv("ECHO_PROCESS_SANDBOX", "auto").strip().lower()
    sandbox = shutil.which("bwrap") if sys.platform == "linux" else None
    if not required and mode in {"soft", "direct", "off"}:
        sandbox = None
    if required and sandbox is None:
        raise WorkflowSandboxUnavailable(
            "workflow requires Linux bubblewrap isolation in shared/production or strict mode; "
            "install bubblewrap and enable unprivileged user namespaces on the execution host"
        )
    directory = tempfile.TemporaryDirectory(prefix="echo-workflow-")
    try:
        image = Path(directory.name) / "worker.pyz"
        _worker_image(image)
        argv = (
            bubblewrap_argv(sandbox, image)
            if sandbox
            else [
                sys.executable,
                "-I",
                "-S",
                "-B",
                "-X",
                "utf8",
                str(image),
            ]
        )
        # bwrap resets the child's environment itself. The local compatibility
        # launch also avoids inheriting import hooks or user-home discovery.
        clean_env = {
            key: value
            for key, value in env.items()
            if key.upper()
            not in {
                "PYTHONPATH",
                "PYTHONHOME",
                "VIRTUAL_ENV",
                "HOME",
                "USERPROFILE",
            }
        }
        clean_env.update(HOME=directory.name, USERPROFILE=directory.name)
        return WorkerLaunch(argv, clean_env, directory.name, bool(sandbox), directory)
    except BaseException:
        directory.cleanup()
        raise
