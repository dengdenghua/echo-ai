# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


repo_root = Path(SPECPATH).parents[1]
entry = repo_root / "packaging" / "windows" / "echo_backend_entry.py"

remote_plugin_prefixes = (
    "runtime.platform.plugins.bundled.narrative_studio",
    "runtime.platform.plugins.bundled.paper_trading",
)
hiddenimports = [
    module
    for module in collect_submodules("runtime")
    if not module.startswith(remote_plugin_prefixes)
] + [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "multipart",
    "python_multipart",
]

datas = [
    item
    for item in collect_data_files("runtime", include_py_files=False)
    if not any(
        prefix in item[0].replace("\\", "/")
        for prefix in (
            "runtime/platform/plugins/bundled/narrative_studio",
            "runtime/platform/plugins/bundled/paper_trading",
        )
    )
]
reflex_rules = repo_root / "data" / "reflex_rules.yaml"
if reflex_rules.exists():
    datas.append((str(reflex_rules), "data"))

# Connector marketplace fork.
#
# ConnectorRegistry resolves its marketplace root as
# ``Path(connector_registry.__file__).resolve().parents[3] / "extensions" /
# "workbuddy-connectors"``.  In the frozen one-file build ``parents[3]`` is the
# per-launch ``_MEIxxxxx`` extraction directory, so the fork MUST be bundled as
# data — otherwise the registry loads zero connectors and the desktop settings
# page has no OpenCode model provider to configure.
#
# ``connectors/<id>/vendor/`` holds ~100 MB of CLI distribution tarballs
# (dingtalk/tmeet/emr-query/cloudbase).  They are only needed when *installing*
# those CLI connectors, which the desktop cannot do offline anyway; drop them
# and the whole fork costs ~1.4 MB.  Delete the ``vendor`` guard below to ship
# the full offline-capable fork instead.
connector_root = repo_root / "extensions" / "workbuddy-connectors"
if connector_root.exists():
    for path in sorted(connector_root.rglob("*")):
        if path.is_dir():
            continue
        parts = path.relative_to(connector_root).parts
        if "vendor" in parts:
            continue
        dest = "/".join(("extensions", "workbuddy-connectors") + parts[:-1])
        datas.append((str(path), dest))

a = Analysis(
    [str(entry)],
    pathex=[str(repo_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "tests",
        "frontend",
        "torch",
        "torchvision",
        "torchaudio",
        "transformers",
        "diffusers",
        "accelerate",
        "scipy",
        "sklearn",
        "scikit-learn",
        "pandas",
        "onnxruntime",
        "onnx",
        "tensorboard",
        "tensorflow",
        "keras",
        "matplotlib",
        "seaborn",
        "statsmodels",
        "sympy",
        "nltk",
        "spacy",
        "gensim",
        "xgboost",
        "lightgbm",
        "catboost",
        # Windows Graphics Capture imports cv2. Keep it available for the
        # optional desktop extra; excluding it makes GPU previews fail frozen.
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="echo-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
