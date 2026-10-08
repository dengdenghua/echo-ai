"""Supply-contract primitives for the Echo kernel.

Public surface is :mod:`runtime.platform.provisioning.bundle`; this package
exists so the module path is short and stable for the CLI and for packaging
scripts that need to read ``runtime/bundle.json``.
"""

from runtime.platform.provisioning.bundle import (
    BUNDLE_FILENAME,
    SCHEMA,
    STAMP_FILENAME,
    BundleError,
    BundleManifest,
    BundleManifestError,
    ProvisionReport,
    ProvisionStep,
    Resource,
    ResourceRoot,
    Stamp,
    ensure_provisioned,
    load_manifest,
    parse_stamp,
    path_digest,
    plan_provision,
    platform_tag,
    sync_manifest,
    verify_manifest,
    write_stamp,
)

__all__ = [
    "BUNDLE_FILENAME",
    "SCHEMA",
    "STAMP_FILENAME",
    "BundleError",
    "BundleManifest",
    "BundleManifestError",
    "ProvisionReport",
    "ProvisionStep",
    "Resource",
    "ResourceRoot",
    "Stamp",
    "ensure_provisioned",
    "load_manifest",
    "parse_stamp",
    "path_digest",
    "plan_provision",
    "platform_tag",
    "sync_manifest",
    "verify_manifest",
    "write_stamp",
]
