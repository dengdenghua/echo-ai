# AI / OS runtime security contract

Contract **echo-runtime-safety 1.1.0** is a shared behavior requirement, independent
of either product's package version. The checked-in definition is
[security/runtime-contract.json](../security/runtime-contract.json).
It maps 29 common cases onto existing negative tests in each product. Runtime
source files may differ; matching source hashes are never a passing criterion.

## Local verification

Use the repository's existing locked environment; this tool does not install
packages or start servers. From either checkout:

~~~powershell
.\.venv\Scripts\python.exe -B tools/security_contract.py --repo . --output artifacts/runtime-security-contract.json
~~~

Verify both checkouts explicitly, from either checkout:

~~~powershell
.\.venv\Scripts\python.exe -B tools/security_contract.py --ai-repo E:\AGENT\echo-ai --os-repo E:\AGENT\echo-os --output E:\AGENT\analysis\runtime-security-contract.json
~~~

Each checkout uses its own .venv by default. If necessary, supply --ai-python
and --os-python, or --python for single-checkout verification. Missing dual-mode
interpreters fail without falling back to a sibling's dependencies.

A successful gate requires the reviewed definition/version, imports from the
requested source root, every required case collected with its minimum parameter
coverage, and every collected test passing in setup, call and teardown.
Missing tests, skipped cases, xfail/xpass, teardown failures, worker timeouts,
different contracts and two copies of the same product fail with exit status 1.
The structured JSON records interpreter, package version, Git HEAD, actual
source paths/hashes, per-test phases and common-case results. Source hashes are
audit snapshots, including local changes, rather than equality assertions.

The five underlying test files are test_runtime_diagnostics_auth.py,
test_logging_redaction_fields.py, test_peer_execution_boundary.py and
test_image_generation_command.py and test_sandbox_platform_contract.py. The entire files run, so product-specific
telemetry, template/path and other regression checks remain active. Gate
integrity tests are in tests/test_security_contract_gate.py, including an
isolated subprocess that deliberately disables diagnostic authentication and
must report three real negative-test failures. That experiment never edits
production files.

## What 1.1.0 guarantees

- With authentication enabled, detailed diagnostics require an operator;
  anonymous health remains minimal. Local authentication-off behavior stays
  compatible.
- Configured JSON and ordinary text formatters redact recognized credentials in
  messages, rendered extras/context and tracebacks. Existing Redactor patterns
  define recognition; explicitly constructed redact=False formatters retain
  their documented opt-out. The contract does not certify arbitrary unknown
  secrets or third-party logging handlers.
- Image command templates use literal argv values with shell=False. Quoted
  placeholders remain supported; dangerous cmd metacharacters are rejected
  before Windows batch wrappers can execute.
- Shared pairing credentials alone deny peer execution by default. The active
  source connection, directed tool grants, live lease ownership and registered
  target executor/receipt path are enforced. The explicit legacy
  ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS=1 override remains a documented
  exception requiring grants.
- Sandboxed Python output uses UTF-8 with a byte budget; direct Python stdout
  honors explicit PYTHONIOENCODING and the listed -X utf8/-Xutf8 forms, including
  -E/-I combinations. Native codec selection ignores Python-specific encoding
  environment settings; callers may explicitly choose a known stream codec.
  The direct backend probe launches an
  available executable. Additional write roots reject recognized platform
  system directories; the generated read-only Seatbelt profile keeps private
  roots exact. Without a hard backend, auto fallback requires a broker's
  explicit approval and rejects effects when approval is missing or denied.
  The listed macOS system paths cannot gain additional write authority.

Version 1.1.0 preserves all 18 cases from 1.0.0 and adds 11 sandbox cases
(15 parameter variants). Earlier 1.0.0 reports remain historical evidence.
Encoding cases cover the listed environment/command-line paths; they do not
certify arbitrary native-tool encodings or every Python command-line override.
Seatbelt profile generation is checked on this host; this is not proof of
macOS kernel enforcement or exhaustive protection of every system directory.
The auto-fallback consent cases exercise stream_run with a workspace sandbox.
Legacy callers that explicitly construct SandboxRunner without a backend still
select DirectBackend; this contract does not claim that API automatically
performs backend selection or requires an approval broker.

## Product boundaries

AI has no implemented per-device credential issuance/pairing flow. Its shared
token mode denies directed peers by default; the tests set per-device mode in
memory to test dispatch enforcement. This must not be reported as an end-to-end
per-device enrollment capability. AI's receipt telemetry is an additional test.

OS's production appliance wrapper installs managed per-device hello
authentication. These common tests use in-memory devices; they do not test
real enrollment, physical devices or mobile transport end to end.

The contract covers these five security boundaries only. Other runtime
features, public APIs, UI behavior and AI-specific shared-file coordination are
outside its compatibility claim. Passing is not a full repository test result.

## Version and review policy

The gate pins the canonical SHA-256 of the complete definition for each
supported version. Editing the definition under the same version fails. Any
definition or case-mapping update therefore requires a new version and a
reviewed digest update in both checkouts' tools/security_contract.py, followed by
single-checkout CI and explicit dual verification. Keep previously supported
versions in the gate when needed, but dual verification requires both checkouts
to advertise the same contract.

Use a major version for incompatible or weaker requirements, a minor version
for added requirements, and a patch version for corrected descriptions/mappings
that preserve the requirements. Runtime fixes implementing the existing
requirements need no contract version bump. Add regression assertions to the
existing cases or a new reviewed case instead of weakening an assertion.

The independent runtime-security-contract.yml workflow runs the gate-integrity
tests and actual behavior gate on Linux and Windows for pushes and pull
requests; it uploads the JSON even on failure. It requires neither the sibling
repository nor a uniquely chosen runtime maintainer. The workflow becomes
active when committed and pushed; making its two job statuses required in
branch protection is a repository-owner setting, not changed by this tool.

Local baselines and result JSON are evidence, not automatic authorization to
replace either runtime source tree. The contract cannot prevent a coordinated
edit that weakens both tests and the gate; those changes still require code
review. No runtime migration or unique-maintainer decision is made here.
