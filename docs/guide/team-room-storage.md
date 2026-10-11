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
needed; these are separate from heartbeats. Timestamps disappear on worker
restart. Presence is currently local to the socket-owning worker; shared
multiworker presence and pub/sub are separate pending work.
