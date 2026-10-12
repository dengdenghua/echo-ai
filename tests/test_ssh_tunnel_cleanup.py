"""Close actual owned process pipes, including a child that has already exited."""

import os
import subprocess
import sys

import pytest

from runtime.sensing.gateway.remote_transport import RemoteBackend, SshTunnel, SshTunnelForwarder


@pytest.mark.parametrize("already_exited", [False, True])
def test_close_reaps_owned_child_and_closes_stderr(already_exited):
    backend = RemoteBackend(
        id="private",
        name="Private",
        url="http://127.0.0.1:8000",
        ssh=SshTunnel(host="bastion.example.com"),
    )
    forwarder = SshTunnelForwarder(backend)
    code = "pass" if already_exited else "import time; time.sleep(30)"
    process = subprocess.Popen(
        [sys.executable, "-c", code],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=0x08000000 if os.name == "nt" else 0,
    )
    forwarder._process = process
    forwarder._local_port = 43123
    try:
        if already_exited:
            process.wait(timeout=5)
        forwarder.close()
        assert process.poll() is not None
        assert process.stderr.closed
        assert forwarder._process is None and forwarder._local_port is None
        forwarder.close()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        process.stderr.close()
