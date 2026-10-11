# Team Room storage

Room configuration and membership are authoritative in SQLite. The configured
legacy path determines the database filename: `team_rooms.json` uses
`team_rooms.json.db`, and a custom `rooms.json` uses `rooms.json.db` in the same
directory. Message history and invitation reservations use their existing stores.

On first startup, the store imports the legacy JSON under its file transaction
lock and a SQLite write transaction. Plaintext legacy invitation fields are
scrubbed from the source and never imported. Room IDs, owners, resolved tenant
scopes, thread bindings, join policies, permissions and speaking delegations are
preserved. An unknown owner retains the existing isolated `legacy:<owner>` scope
when authentication is enabled. The imported tenant is fixed; a later change in
identity metadata does not reassign ownership.

Rows and the completed-import marker commit together. An interrupted import can
be retried. Invalid entries or duplicate IDs fail strict reads instead of silently
committing a partial import. Tolerant startup may expose an empty in-memory view
for a malformed source, but it does not record a completed import; subsequent
strict runtime reads refuse the source until repaired. A newer SQLite schema is
refused without changing its data. Missing tables are treated as corruption;
they are not recreated over an existing schema. A missing import marker on a
populated authority also fails instead of overwriting it from the old backup.
WAL and schema initialization are serialized only on first creation. Normal
reads and heartbeats do not take this bootstrap file lock or reset journal mode.

After import, JSON is a sanitized backup, not an authority or an output file.
Editing it does not change rooms, and deleted rooms are not reimported. Back up
the database using SQLite's backup API or stop all writers before copying its
database and WAL files. Do not restore only the JSON file over a populated store.
Stop all workers running the JSON-writing version before upgrading. Workers
running the old and new versions cannot share this room state during a rolling
upgrade: subsequent old-version JSON writes are not imported into SQLite.

Each room mutation compares the writer's baseline with the latest rows inside
`BEGIN IMMEDIATE`, then writes only inserted, changed or deleted room rows.
Disjoint worker changes merge. A conflicting change returns
`409 TEAM_ROOM_STATE_CONFLICT`; refresh and retry. A failed transaction rolls back
the whole delta. A linked room still requires an explicit unlink before deletion.

WebSocket `ping` and `presence:ping` update worker-local `last_seen_at` values and
broadcast presence without changing durable room rows or `updated_at`.
`last_seen_at` is excluded from all stored participant payloads and optimistic
comparisons. Refreshing durable membership overlays the live timestamps while
retaining server-owned role, mute, removal and delegation decisions. Connection
and disconnection still commit membership/status and floor transitions when
needed; these are separate from heartbeats. Timestamps disappear when all workers
restart. For shared multiworker presence and socket delivery, configure the
explicit Redis backend described in [shared collaboration delivery](collaboration-realtime.md).
The default local backend serves one process.

`TeamTaskAuthority` owns team tasks directly in the existing
`collaboration_tasks` table. Collaboration schema version 2 adds a task revision
and an exact room/session/project-generation binding. The separate claim table
contains only execution tokens, native process identities, lease expiry and
cancellation requests; it does not contain another task payload. Generic task
projection writes and unversioned task deletes cannot replace these owned rows.

The authority API reads fresh rows and commits deltas under `BEGIN IMMEDIATE`.
Operator changes compare a revision. Worker changes require the current,
unexpired execution token and merge with the latest task. Shared concurrency
counts include cancelling workers until they acknowledge exit, die, or expire.
Cancellation and deletion prevent late output writes; an old run cannot release
a newer claim. Startup reconciliation preserves live and uninspectable owners,
and marks only expired or confirmed dead executions failed without rerunning.

Legacy task import validates the complete file and its room bindings, then
commits all rows and the import marker together. Matching old projections can
be adopted without truncating assignees or produced artifacts. Corrupt JSON,
duplicate IDs/keys, unknown formats, and conflicting canonical rows fail the
whole import. The source remains untouched and is never consulted again after
a successful import, including after canonical task deletion. Legacy running
records have no durable owner and become explicit failures requiring a retry.

This authority API is available for the gateway cutover. The existing
`/api/team-tasks` router still uses its legacy JSON/cache until that integration
is completed; adding the schema alone does not migrate or activate those routes.
