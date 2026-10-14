"""Seed separate authenticated people in the disposable browser-test instance."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from runtime.platform.process.paths import app_paths  # noqa: E402
from runtime.safety.auth.identity import DurableIdentityStore, Identity  # noqa: E402

state = Path(os.environ["ECHO_HOME"]).resolve()
if not state.is_relative_to(ROOT / "test-results") or state == ROOT / "test-results":
    raise RuntimeError("collaboration fixtures require an isolated test-results subdirectory")
store = DurableIdentityStore(app_paths().identity_store_path)
for name in ("alice", "bob", "viewer", "outsider"):
    store.add(
        Identity(
            actor_id=f"local:{name}",
            roles=("user", "local"),
            metadata={
                "provider": "local",
                "username": name,
                "display_name": name,
                "tenant_id": "e2e-other" if name == "outsider" else "e2e-team",
            },
        )
    )
