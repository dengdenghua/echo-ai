"""The auth lint must scan current routers and fail on missing scan roots."""

import pytest

from tools.lint import auth_actor_check as checker


@pytest.fixture
def routers(tmp_path, monkeypatch):
    monkeypatch.setattr(checker, "REPO_ROOT", tmp_path)
    paths = []
    for directory in ("runtime/sensing/gateway", "runtime/platform/ui"):
        path = tmp_path / directory / "example_router.py"
        path.parent.mkdir(parents=True)
        path.write_text("def endpoint(request):\n    _auth(request)\n", encoding="utf-8")
        paths.append(path)
    return paths


def test_scans_both_current_router_directories(routers):
    assert {path for path, *_ in checker.scan_repo()} == set(routers)


def test_strict_mode_reports_unbound_actor_calls(routers, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["auth_actor_check", "--strict"])
    assert checker.main() == 1
    output = capsys.readouterr().out
    assert "runtime/sensing/gateway/example_router.py" in output
    assert "runtime/platform/ui/example_router.py" in output


def test_bound_and_explicit_actor_agnostic_calls_pass(routers, monkeypatch):
    routers[0].write_text("def endpoint(request):\n    actor = _auth(request)\n", encoding="utf-8")
    routers[1].write_text(
        "def endpoint(request):\n    _auth(request)  # AUTH-OK: actor-agnostic\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("sys.argv", ["auth_actor_check", "--strict"])
    assert checker.main() == 0


def test_multiline_opt_out_stays_attached_to_its_call(routers):
    routers[0].write_text(
        "def endpoint(request):\n"
        "    _auth(\n"
        "        request\n"
        "    )  # AUTH-OK: actor-agnostic\n"
        "    _auth(request)\n"
        "    # AUTH-OK: actor-agnostic\n",
        encoding="utf-8",
    )
    hits = checker.scan_file(routers[0])
    assert len(hits) == 1
    assert hits[0][0] == 5


@pytest.mark.parametrize("missing_index", [0, 1])
def test_a_missing_required_scan_cannot_pass(routers, monkeypatch, capsys, missing_index):
    routers[missing_index].unlink()
    monkeypatch.setattr("sys.argv", ["auth_actor_check", "--strict"])
    assert checker.main() == 1
    assert "Required router scan matched no files" in capsys.readouterr().out
