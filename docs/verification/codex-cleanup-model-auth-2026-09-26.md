# Codex cleanup and model selection verification

Date: 2026-09-26

## Model selection

The model profile mutation used an alternate loopback hostname in development,
while profile reads used the page origin. A browser session restored using an
HttpOnly cookie could read the profile but its write to the other hostname had
no session cookie and returned `401 missing Authorization: Bearer <token>`.

Reads and writes now use the configured backend origin consistently. The same
fix covers upstream update check/approval requests which shared the helper.
Coder API errors retain their HTTP status; model controls display an Echo
sign-in hint for a 401 instead of the raw authentication diagnostic.

Verified in the existing browser session: selected deepseek-chat, then restored
the original 极速 model. Both profile PUT requests returned 200 and the menu
updated without an error. Restored the pre-check OpenCode engine selection;
no model message was submitted during this check.

## Cleanup

On this Windows installation, the scratch subtree resolves into the packaged
Codex LocalCache while the state root itself still resolves to normal AppData.
The old root-relative equality check rejected that legitimate partial redirect
after the assistant had already produced its reply.

Provisioning now captures each task/scratch tree's logical path, canonical path,
kind and filesystem identity. Cleanup requires that exact allocation and the
existing marker to remain valid. Reparse-point directories are rejected. The
strict root-relative check remains for cleanup callers without an allocation.

Tests cover partial namespace redirection, changed target/identity, invalid
markers, outside paths and idempotent cleanup. A smoke test against the actual
local state root provisioned a unique test context and confirmed:

- Partial namespace redirection occurred.
- Scratch and task trees were removed successfully; repeated cleanup succeeded.
- Persistent thread state was retained.

Existing user scratch directories and recorded error messages were not deleted.
The original Kane conversation was not available in this browser context, so a
new live Codex reply was not rerun; cleanup was verified directly on this host.

## Checks

- Frontend targeted tests: 42 passed.
- Backend security, execution backend and role context: 70 passed, 3 POSIX-only checks skipped on Windows.
- TypeScript type check, Ruff and scoped diff whitespace check passed.
- Backend restarted on port 8310; health check passed. Frontend on 3310 picked up changes through Vite.
