import pytest

from runtime.sensing.server.mount_backend import default_registry
from runtime.workspace.execution_directory import execution_directory
from runtime.workspace.model import Workspace


def workspace(kind, target, **options):
    return Workspace(
        id="shared", name="Shared", mount_type=kind, mount_target=target, mount_options=options
    )


def test_system_mount_uses_path_on_executing_runtime(tmp_path):
    result = execution_directory(workspace("local", str(tmp_path)))
    assert result["ready"]
    assert result["filesystem_path"] == str(tmp_path.resolve())
    assert result["runtime"] == "current_backend"
    assert result["requires_runtime_online"]


def test_storage_url_alone_is_not_an_execution_directory(tmp_path):
    ws = workspace("webdav", "https://files.example/team")
    assert execution_directory(ws)["status"] == "mount_required"
    ws.mount_options["filesystem_path"] = str(tmp_path)
    assert execution_directory(ws)["ready"]


def test_missing_mount_is_not_created(tmp_path):
    path = tmp_path / "offline"
    result = execution_directory(workspace("local", str(path)))
    assert result["status"] == "unavailable"
    assert result["filesystem_path"] is None
    assert not path.exists()


@pytest.mark.parametrize("value", ["relative/path", "https://files.example/project"])
def test_rejects_relative_or_url_process_directory(value):
    assert not execution_directory(workspace("local", value))["ready"]


def test_nfs_registry_uses_keyword_mount_point(tmp_path):
    backend = default_registry.get_backend(
        "test", "nfs", "nfs://server/share", {"mount_point": str(tmp_path)}
    )
    assert backend.mount_point == tmp_path.resolve()
    assert execution_directory(workspace("nfs", "nfs://server/share", mount_point=str(tmp_path)))[
        "ready"
    ]
    with pytest.raises(ValueError, match="mount_point"):
        default_registry.get_backend("test", "nfs", "nfs://server/share", {})


def test_registry_consumes_connection_targets_without_network(tmp_path):
    dav = default_registry.get_backend(
        "dav", "webdav", "https://files.example/dav/team", {"filesystem_path": str(tmp_path)}
    )
    assert dav.base_url == "https://files.example/dav/team"
    smb = default_registry.get_backend("smb", "smb", "smb://server/team/project", {})
    assert (smb.host, smb.share, smb.root_path) == ("server", "team", "project")
    sftp = default_registry.get_backend(
        "ssh", "sftp", "sftp://server:2222/team", {"username": "alice", "port": "2222"}
    )
    assert (sftp.host, sftp.user, sftp.port, sftp.root_path) == ("server", "alice", 2222, "/team")
    s3 = default_registry.get_backend("s3", "s3", "https://objects.example/bucket/project", {})
    assert (s3.endpoint_url, s3.bucket, s3.root_path) == (
        "https://objects.example",
        "bucket",
        "project",
    )


def test_registry_rejects_credentials_in_connection_url():
    with pytest.raises(ValueError, match="credentials"):
        default_registry.get_backend("dav", "webdav", "https://user:password@files.example/dav", {})
