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

The `/api/team-tasks` HTTP routes, collaboration session lists, and task creation
now use this authority. Production composition supplies the same store to every
consumer and restores actual Room projections before importing legacy tasks.
The retired JSON/cache helpers are removed. Events are emitted after committing
the authoritative row; event delivery failure cannot undo a committed task.
Database failures return 503, and stale operator revisions return 409 without
writing or retrying. Task responses expose `revision`; PATCH accepts optional
`expected_revision` for older clients, and the task panel sends its displayed
revision and refreshes after a conflict.

Schema version 3 supports an explicit Room/session transfer used by the authorized
collaboration Room linker. It compares the old ownership binding and updates the
Room, messages, task bindings, metadata and task revisions in one transaction.
Task IDs, extra fields and history are preserved. Running tasks become cancelled
and their claims request cancellation; old results remain fenced and capacity
remains occupied until acknowledgement, owner death or expiry. A retry does not
restart work. Generic Room writes still cannot move an owned task or bypass the
versioned project APIs, and a failed transfer rolls back the entire transaction.

Collaboration schema version 4 adds a separate per-Room message cursor and a
transcript import ledger. Session message sequences remain unchanged. Existing
receipts associated with an unambiguous message ID acquire that Room cursor;
reapplying the schema step preserves assigned cursors and database identity.

The `CollaborationStore.import_legacy_room` migration entry point reads the
entire legacy SQLite transcript rather than a bounded history page. It retains
message IDs, client IDs, sender attribution, source timestamps and seal
provenance. Exact matching canonical rows are adopted; original legacy ordering
precedes canonical-only messages. Receipts keep their strongest delivery status
and use the imported message's Room cursor. Invalid seals, ambiguous identities,
conflicting content or receipts without a message reject the import.

The source database first commits a per-Room write fence tied to the destination
database identity. SQLite triggers block older processes from changing that
Room's messages or receipts. The destination then commits all messages,
receipts, cursor assignments and its success ledger in one transaction. These
are two separate transactions: a destination failure leaves the source intact
and fenced so the same destination can retry after the fault is repaired. A
successful ledger prevents subsequent legacy reads or reimport. Other legacy
Rooms remain writable until separately migrated.

Production Room startup and linked-session access now adopt each actual Room
before exposing its transcript. HTTP reads, WebSocket appends, linked-session
messages and receipts use the canonical database after adoption. A failed import
or canonical write produces a retryable error rather than an empty success or
a legacy acknowledgement. Explicit standalone hosts may still select a single
legacy store. Session and Room composition share the same legacy source.

Room responses retain `session_seq` for session actions and expose `seq` as the
Room cursor. `cursor_epoch` includes the database identity, Room binding and
import provenance. A missing or foreign epoch resets a positive reconnect
cursor to the recent history window; a matching cursor pages forward without
skipping intervening messages. The frontend loads that window on admission,
catches up on reconnect and ignores obsolete responses after Room/account
changes. Epoch changes preserve the local outbox while clearing old server
messages and receipts. Client retry IDs are scoped to the participant.

Cursor allocation retains a durable high-water mark, including after message
deletion and restart. Moving a Room allocates fresh destination Session
sequences while preserving Room cursors, message IDs, comments, reactions and
pins; the changed binding changes its epoch. Receipts derive their cursor from
the actual message, never the client's claimed sequence. Database guards also
reject older canonical writers that replace an adopted message ID, duplicate
it, move a message to another Room or write a receipt for the wrong cursor.
