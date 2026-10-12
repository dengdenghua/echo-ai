# Deep Android workflow

The plugin has two local MCP servers: `rea` is upstream REA 6.4.0; `rea-deep`
adds a durable Android workspace. It does not patch the upstream npm runtime.
The added workflow supports macOS/Linux and needs Python 3.9+, Apktool, JADX
CLI and ripgrep. Signature verification additionally uses Android SDK
build-tools `apksigner`. A missing engine is recorded as a coverage gap.

## Prepare once and reuse

Select the package from the current human request. Call
`prepare_android_workspace` with its absolute `path` and a new absolute
`workspace`. APK, XAPK and APKM are supported; containers retain every supplied
APK split. APKs do not need an emulator for static analysis.

Preparation returns `job_id` immediately. Check `android_workspace_status`
between useful independent work, with reasonable spacing when a phase is
unchanged. It reports extraction, signatures, decoding, Java and indexing
separately. `completed` means those requested stages ended, not that every
feature has been understood. `partial` or `failed` requires reading the reported
stage/log and preserving that gap. No query should treat partial Java as exact
original source. JSX/JavaScript in assets is still static packaged evidence.

Repeated prepare requests for a matching workspace reuse its inputs and phases.
Use `retry_failed: true` after resolving a reported blocker. Interrupted phases
can resume. Use `reindex: true` only after intentional source/resource edits;
the input package hash and preparation options must still match. Different
package hashes/options need a different output directory. Never delete a user
analysis directory to bypass an identity mismatch.

Workers continue after a prepare tool returns and are bound to their workspace,
PID/session and UUID. `cancel_android_workspace` stops only that owned worker
and its engines. A transient CLI query cancellation does not cancel a previously
queued workspace job. All analysis outputs stay outside the plugin cache.

## Persistent files

- `workspace.json`: original source hash, preparation options and all APK/split
  identities; `inputs/` keeps their unmodified bytes.
- `raw/`: complete archive members, including DEX, assets, resources and .so.
- `decoded/`: Apktool resources/manifest plus Smali; all supplied language and
  density splits are decoded. SDK/version fields may be in `apktool.yml`.
- `java/`: JADX source output with inlining reduced; source-level names may be
  aliases/obfuscated and failure markers are retained.
- `native/`: ELF symbol metadata and printable strings with binary byte offsets.
  JNI registrations, stripped symbols and indirect/native calls can be absent.
- `index.sqlite`, `summary.json`: resources across qualifiers, compiled method
  definitions, exact invoke operands, per-file SHA-256 and coverage counts.
- `state.json`, `logs/`, `jobs/`: durable progress, engine exit codes and errors.
- `evidence/`, `findings/`: immutable query evidence plus versioned conclusions.

## Trace a question, not a keyword catalogue

Turn the user's actual questions into a short finding checklist. A broad request
such as “how does this app work?” typically needs UI/navigation, conversation
state and transport, role/memory boundaries, local tools/background tasks,
results and native/runtime gaps. Tailor that to the requested scope.

1. Use `summarize_android_workspace` for artifact identity and coverage. Inspect
   component, exported entry-point, split and signature errors before attributing
   the sample. A successful signature check proves integrity under that signing
   identity, not an independent download from the vendor store.
2. Use `search_android_workspace` in a focused `scope` (`java`, `smali`,
   `resources`, `assets`, `native`, `all`). Literal search is default. Regex uses
   ripgrep syntax. Exact DEX method descriptors appear in Smali. Resource IDs,
   UI labels and protocol strings are useful seeds even when class names are
   obfuscated. Search hits are not runtime observations or semantic xrefs.
3. Use `query_android_resources` to follow resource names/IDs across qualifiers.
   It has no 2000-string inventory cutoff; page with `has_more`/`next_offset`.
   Pin subsequent pages with the returned `index_id`. Public resource entries
   preserve type/ID attributes. Missing language splits stay unknown.
4. Read the surrounding implementation using `read_android_evidence`. Each span
   carries its file hash and line numbers. Java warnings or an important missing
   Java body are reasons to read Smali or request focused upstream JADX
   decompilation, not reasons to invent the missing behavior.
5. Batch `inspect_android_methods` with exact symbols such as
   `Lpkg/Handler;->send(Ljava/lang/String;)V`. Bodies are compiled Smali. Pick
   the full parameter/return descriptor to distinguish overloads. Page long
   methods using their returned file/line range; do not stop at a clipped body.
6. Use `trace_android_callgraph` from that symbol. Start with outgoing or incoming
   depth 1–2, choosing the direction that answers the hypothesis; expand only
   a relevant branch. Results retain opcode, caller/callee, file/hash and
   instruction line. Virtual/interface calls name the declared operand, not
   necessarily the runtime implementation. Reflection, invoke-custom, dynamic
   DEX and JNI can create gaps. Cross-check a branch's actual method body and
   state/request fields rather than relying on graph reachability alone.
7. Follow UI → event/state handler → serializer/transport or local command →
   response/state update → visible result until the question is answered or
   the artifact boundary is reached. A method that just calls `toString` or
   enumerates a property does not establish the feature's behavior. Calls to a
   remote API identify a client/server boundary; they do not recover server
   prompts, model weights, scheduling or encryption guarantees.

Use upstream `inspect_android_class`/`inspect_android_method` for a focused Java
view when appropriate, choosing its returned overload index. Use
`trace_android_references` for additional JADX relationships. Deep Smali file
names/descriptors and JADX aliases may differ; preserve the identity used in
each record. Open one explicit `raw/.../lib/...so` with the native provider when
native bodies are required, and close that provider when done.

## Findings and reports

`record_android_finding` records `id`, `claim`, `scope`, `evidence_type`
(`static_observation`, `inference`, `unknown`), `status` (`answered`, `partial`,
`unresolved`), `evidence_ids` and `limitations`. An answered conclusion needs
evidence from the current index. A negative keyword search stays bounded to its
retained files/scope and cannot prove that the entire product lacks a feature.
Runtime findings, if requested and available through separate supported tools,
need their actual screenshot/log/capture provenance; do not label a static
observation as runtime.

`export_android_report` writes a new report from that ledger and explicit stage
coverage. If no findings are recorded it says so instead of promoting an
inventory into conclusions. Reindexing invalidates earlier finding generations;
old files/revisions remain retained and stale findings are excluded. Before
finishing, revisit the user's questions and identify any genuinely unresolved
scope. Do not claim “complete reverse engineering” based on file counts.

`compare_android_workspaces` retains the full permission/method inventory delta
and bounded examples. Obfuscation, build changes and missing splits/stages can
create apparent changes; follow changed method bodies before claiming changed
behavior. Complete comparison JSON is saved in the new workspace.

## CLI fallback in the current chat

New MCP tools may need a new chat or app restart. Continue useful work through
the wrapper; do not add a duplicate global MCP entry or reinstall before every
target. The CLI accepts a JSON object with the same fields as the MCP tool:

```sh
node <plugin-root>/scripts/rea.mjs deep prepare '{"path":"/absolute/app.xapk","workspace":"/absolute/new-workspace"}'
node <plugin-root>/scripts/rea.mjs deep status '{"workspace":"/absolute/new-workspace"}'
node <plugin-root>/scripts/rea.mjs deep search '{"workspace":"/absolute/new-workspace","query":"buildChatSendRequest","scope":"java"}'
node <plugin-root>/scripts/rea.mjs deep trace '{"workspace":"/absolute/new-workspace","symbol":"Lpkg/Handler;->send(Ljava/lang/String;)V","direction":"outgoing","depth":2}'
```

Actions: `prepare`, `status`, `cancel`, `overview`, `search`, `read`, `resources`,
`methods`, `trace`, `finding`, `report`, `compare`. JSON can also be passed on
stdin to avoid shell escaping for longer claims. Never interpolate untrusted
package content into a shell command. Existing upstream CLI commands are
unchanged. `deep-help` explains the entrypoint.
