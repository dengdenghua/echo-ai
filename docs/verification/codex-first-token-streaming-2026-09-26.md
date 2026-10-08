# Codex first-token optimization

## Changes

- The scoped Responses proxy now consumes the selected router's `call_stream` and forwards text immediately over SSE. Previously it waited for `call()` to return the whole answer before serializing SSE.
- Response/message IDs and sequence numbers remain stable. Final text is reconciled against emitted text; validated tools and final usage are delivered once. Providers implementing only `call()` retain a buffered compatibility path.
- The synchronous provider iterator runs in one worker with the trusted session context and a bounded queue. Closing the proxy stops queue delivery and closes the iterator when its outstanding provider read returns; provider network timeouts still bound blocked synchronous reads.
- Transport retries reuse the same cached response and do not invoke the model again. A failure after text is sent emits a sanitized `response.failed`, without falsely emitting completion or another HTTP response. Output and cache limits remain enforced.
- Sidecar directory provisioning validates each directory component once per preparation pass instead of repeatedly walking common ancestors. There is no cross-turn security cache or change to per-turn credentials/permissions.
- Startup logs now separate preparation, process/client startup, config validation, thread restoration and turn submission. Proxy logs record first-text latency without prompt or credential content.

## Validation

`pytest tests/test_codex_responses_proxy.py tests/test_shared_execution_models.py tests/runtime/execution/codex_backend/test_security.py tests/test_codex_execution_backend.py tests/test_codex_role_context.py -q`

Result: **103 passed, 3 POSIX-only tests skipped on Windows**. Ruff and scoped diff checks passed.

The deterministic streaming regression holds the upstream generator after its first text. The HTTP client receives that text before the generator is released. Tests also cover transport disconnect/replay, usage accounting, unadvertised tools, stream failures, output limits and shutdown.

The locally installed real Codex App Server was tested against the controlled model router with both 1 and 128 advertised tools. In each case it emitted `item/agentMessage/delta` while the router was still waiting for the test to release the remaining text. The tool loop and compaction completed. No external model request was needed for these tests.

An alternating local preparation benchmark ran 12 preparations per implementation, excluding the first two from the median: old repeated directory walk **32.01 ms**, new batched walk **26.02 ms**. This is a small local initialization improvement, not an end-to-end TTFT claim.

The previously observed live request took 8.84 seconds to first text. No comparable live upstream rerun was performed, so a new end-to-end latency is not claimed. Process startup and upstream first-token latency remain; the proxy no longer adds the entire answer-generation time before displaying text.

Backend restarted on port 8310 after the current user turns had ended; health check passed. No frontend restart is required for this backend change.
