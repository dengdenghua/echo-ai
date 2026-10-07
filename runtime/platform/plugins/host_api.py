"""Version of the plugin/workbench contract, independent of runtime releases.

The 0.2 contract covers signed package requirements, permission disclosures,
and isolated workbench assets. Change this version only when that contract
changes; a runtime patch release must not invalidate installed packages.
"""

HOST_API_VERSION = "0.2.0"
