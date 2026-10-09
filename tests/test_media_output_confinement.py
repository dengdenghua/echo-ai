"""generate_image / generate_speech output paths are confined like write tools.

Before the fix ``output_path`` was written verbatim, so a model could drop
provider bytes on ``~/.bashrc`` or anywhere else on disk. The destination is
now validated through ``path_guard.check_path`` against the injected
``sandbox_dir`` plus the credential-file write denylist, and the copy helpers
never follow symlinks.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

import pytest

import runtime.execution.suckers.kimi_compat_skills as kcs


class _Resp:
    def __init__(self, *, json: Any = None, content: bytes = b"") -> None:
        self._json = json
        self.content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        return self._json


class _Client:
    def __init__(self, resp: _Resp) -> None:
        self._resp = resp
        self.calls = 0

    def __enter__(self) -> _Client:
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def post(self, *_a: Any, **_k: Any) -> _Resp:
        self.calls += 1
        return self._resp


@pytest.fixture
def media_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_MEDIA_API_KEY", "test-key")
    from runtime.execution.suckers import media_gateway

    monkeypatch.setattr(media_gateway, "selected", lambda: False)


def _image_client(monkeypatch: pytest.MonkeyPatch) -> _Client:
    client = _Client(_Resp(json={"data": [{"b64_json": base64.b64encode(b"PNG").decode()}]}))
    monkeypatch.setattr(kcs, "_client", lambda **_k: client)
    return client


def test_generate_image_rejects_output_path_outside_sandbox(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, media_key: None
) -> None:
    client = _image_client(monkeypatch)
    sandbox = tmp_path / "ws"
    sandbox.mkdir()
    escape = tmp_path / "outside.png"
    out = kcs._generate_image("a cat", output_path=str(escape), sandbox_dir=str(sandbox))
    assert out["ok"] is False
    assert "path_blocked" in out["error"]
    assert not escape.exists()
    assert client.calls == 0, "must fail before spending a provider call"


def test_generate_image_writes_inside_sandbox(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, media_key: None
) -> None:
    _image_client(monkeypatch)
    sandbox = tmp_path / "ws"
    sandbox.mkdir()
    out = kcs._generate_image("a cat", output_path="img/cat.png", sandbox_dir=str(sandbox))
    assert out["ok"] is True
    assert (sandbox / "img" / "cat.png").read_bytes() == b"PNG"


@pytest.mark.parametrize("name", [".bashrc", ".env", "id_rsa"])
def test_generate_speech_rejects_credential_file_targets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, media_key: None, name: str
) -> None:
    client = _Client(_Resp(content=b"AUDIO"))
    monkeypatch.setattr(kcs, "_client", lambda **_k: client)
    target = tmp_path / name
    # Even without a bound sandbox the credential-file denylist applies.
    out = kcs._generate_speech("hi", output_path=str(target))
    assert out["ok"] is False
    assert "path_blocked" in out["error"]
    assert not target.exists()
    assert client.calls == 0


def test_generate_speech_format_cannot_traverse(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, media_key: None
) -> None:
    import runtime.platform.process.paths as pp

    data = tmp_path / "data"
    monkeypatch.setattr(pp, "app_paths", lambda: type("P", (), {"data_dir": data})())
    client = _Client(_Resp(content=b"AUDIO"))
    monkeypatch.setattr(kcs, "_client", lambda **_k: client)
    out = kcs._generate_speech("hi", format="../../../../evil")
    assert out["ok"] is True
    written = Path(out["path"]).resolve()
    written.relative_to((data / "generated_media" / "speech").resolve())


def test_media_skills_declare_write_affinity() -> None:
    from runtime.execution.suckers.registry import SkillRegistry

    registry = SkillRegistry()
    kcs.register_kimi_compat_skills(registry)
    assert "write" in registry.get("generate_image").affinity
    assert "write" in registry.get("generate_speech").affinity


def test_crop_assets_output_dir_confined(tmp_path: Path) -> None:
    pytest.importorskip("PIL")
    from PIL import Image

    sandbox = tmp_path / "ws"
    sandbox.mkdir()
    img_path = sandbox / "img.png"
    Image.new("RGBA", (4, 4), (0, 0, 0, 255)).save(img_path)
    out = kcs._crop_and_replicate_assets_in_image(
        str(img_path),
        boxes=[{"x": 0, "y": 0, "width": 2, "height": 2}],
        output_dir=str(tmp_path / "outside"),
        sandbox_dir=str(sandbox),
    )
    assert "path_blocked" in out["error"]
    assert not (tmp_path / "outside").exists()


def _symlink_or_skip(link: Path, target: Path) -> None:
    try:
        os.symlink(target, link, target_is_directory=target.is_dir())
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available on this host")


def test_deploy_website_does_not_follow_symlinks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import runtime.platform.process.paths as pp

    monkeypatch.setattr(pp, "app_paths", lambda: type("P", (), {"data_dir": tmp_path / "d"})())
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET", encoding="utf-8")
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("<h1>hi</h1>", encoding="utf-8")
    _symlink_or_skip(site / "leak.txt", secret)

    result = kcs._deploy_website(local_dir=str(site))
    assert result["ok"] is True
    dest = Path(result["deployment"]["path"])
    assert (dest / "index.html").is_file()
    assert not (dest / "leak.txt").exists()
    assert result["skipped_symlinks"] == ["leak.txt"]
