# Gateway authorization audit

The gateway distinguishes authenticated shared metadata, tenant-scoped data,
and host resources. Authentication alone does not authorize access to host
files, shared credentials, or process-wide configuration.

## Host resource boundaries

When `require_auth=True`, the following routes use roles from the registered
identity. Client-supplied role and tenant headers do not grant these roles.

| Surface | Required role | Reason |
| --- | --- | --- |
| `/api/verify/detect`, `/api/verify/run` | operator or admin | Reads a supplied host workspace and can execute its checks. |
| `/api/storage/*` | operator or admin | Proxies requests using the host storage token. |
| `/api/a2a/*` | operator or admin | Uses a shared agent registry, credential references, and task store. |
| Enterprise asset list and detail | operator or admin | Uses the host enterprise credential and configured tenant. |
| `PUT /api/mix-config` | operator or admin | Changes process-wide model configuration. |
| `POST /api/agent-market/from-subagent` | admin | Writes to the shared installed agent catalog. |

Enterprise installation retains its existing admin check. Agent promotion
reuses the existing market lifecycle dependency, including its explicitly
configured trusted local desktop exception. `require_auth=False` preserves
development access. Merely running on a local machine does not bypass the
role requirements when authentication is enabled.

Model metadata and reading mix configuration remain available to authenticated
users. Journal reads pass the scope derived from the authenticated principal
directly to the index query and statistics operations.

## Static checks and regression coverage

`tools/lint/auth_actor_check.py` scans the gateway and UI router roots and
fails when a required root matches no routers. Its baseline remains empty.
An unused auth return requires a reviewed inline explanation: the helper
already enforces roles, the principal feeds a scoped store, or the endpoint
serves shared metadata or caller-supplied inputs. These annotations do not
replace runtime authorization checks.

`tests/test_host_resource_authz.py` covers anonymous callers, two ordinary
identities in different tenants, forged role/tenant headers, operator and
admin access, development access, and rejection before side effects. Upstream
HTTP, project checks, registry access, and agent promotion are mocked. This
is targeted regression coverage, not a claim that every gateway route has
been penetration tested.
