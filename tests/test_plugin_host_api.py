from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.platform.plugins.cloud_catalog import CloudCatalog
from runtime.platform.plugins.host_api import HOST_API_VERSION


@pytest.mark.parametrize(
    "requirement,accepted", [(">=0.2,<0.3", True), (">=0.3", False), ("invalid", False)]
)
def test_workbench_uses_the_host_contract_instead_of_runtime_version(
    tmp_path: Path, requirement, accepted
):
    catalog = CloudCatalog("plugins", use_remote=False, use_cache=False)
    catalog._store = {"items": []}
    manifest = SimpleNamespace(
        id="external-test",
        version="1.0.0",
        runtime_plugin=None,
        permissions=[],
        host_api=requirement,
        dependencies=[],
    )
    if accepted:
        catalog._validate_workbench_compatibility(manifest, install_root=tmp_path)
        assert HOST_API_VERSION == "0.2.0"
    else:
        with pytest.raises(ValueError, match="host_api"):
            catalog._validate_workbench_compatibility(manifest, install_root=tmp_path)
