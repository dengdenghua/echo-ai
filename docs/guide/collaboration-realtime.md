# Shared collaboration delivery

The default `collaboration_realtime.backend: local` supports one backend
process. For multiple backend workers, install the `collaboration-redis`
extra and configure every worker with the same Redis service, namespace and
shared source data home:

```yaml
collaboration_realtime:
  backend: redis
  redis_url: redis://127.0.0.1:6379/0
  namespace: production_a
  connect_timeout_seconds: 2
  require_distributed: true
```

Use a different namespace for each environment or independent installation.
Redis database numbers do not isolate Pub/Sub channels. Keep the URL in
deployment configuration; use Redis authentication, network isolation and
`rediss://` for a remote encrypted service. Workers sharing this namespace
are trusted backend peers; this channel is not a public client API.
Create the application in each worker after process creation. Preloading a
constructed transport before a process fork is rejected explicitly.

A configured Redis backend must subscribe successfully during application
startup. It never silently falls back to local mode. `require_distributed`
also rejects a local configuration; worker count is not automatically detected.
Shutdown closes the publisher and joins the subscription and delivery threads
within bounded waits.

Room messages, receipts, task events and existing thread update broadcasts
travel to sockets on other workers. The receiving worker re-reads the
canonical room membership before delivery, schedules operations on each
socket's owning event loop, and closes removed members' sockets. Tenant and
recipient filters remain enforced. Governance and floor updates are rebuilt
from current source state. A deletion notification only closes sockets after
the source room is absent. Receiving an event never runs tasks, spends a
grant, invokes a digital twin, or republishes the same event.

This is a bounded, lossy wake-up channel, not a message authority. Redis
Pub/Sub offers [at-most-once delivery](https://redis.io/docs/latest/develop/pubsub/).
There are no Redis keys, streams or persisted presence snapshots. Messages,
receipts, tasks, grants and read cursors remain in their existing source
stores. Recover missed messages through the existing HTTP history/catch-up
endpoints after reconnecting; an unavailable publisher, oversized frame or
full delivery queue can lose a live update while committed source data
survives. Project updates have a separate authorized subscription described
below; existing HTTP catch-up and lease-expiry polling remain available.

Frames are capped at 256 KiB, each worker's delivery queue at 256 events and
its duplicate window at 4096 event IDs. Socket delivery waits at most two
seconds after canonical source refresh, which retains its store timeout.
Redis subscription disconnects reconnect; the
next presence access requests a new peer snapshot. A failed initial snapshot
request remains retryable. Snapshot waiting is bounded to 200 ms, and late
responses may still warm the cache. Missing a notification does not grant
access: every later socket send or incoming client frame checks source state.

Room and cowork heartbeats are transient process memory, shared through
Pub/Sub when configured. Their online window is 60 seconds with a monotonic
deadline; each cache holds at most 8192 origin/member entries. Replaying an
equal or older presence revision cannot renew its deadline or resurrect a
departed entry. Multiple workers' live connections for the same member count
as one visible member; departure keeps their floor while another observed
connection remains live. Presence is approximate under disconnects or missed
updates, not a distributed membership consensus protocol.

Cowork read cursors still persist monotonically in `presence.db`. Historical
`last_seen_at` columns are retained for database compatibility but ignored;
heartbeats perform no SQLite writes. A newly started process has no live
presence until a fresh heartbeat or a live peer's snapshot arrives. Restarting
all workers removes presence while preserving read cursors. Last-seen text
can remain in the bounded cache after its online deadline, but it does not
keep a member online.

`tests/test_shared_collaboration_pubsub.py` starts an isolated Redis server
with persistence disabled and serves two real spawned backend processes.
Set `ECHO_TEST_REDIS_EXECUTABLE` to a Redis server binary, or let the test find
`redis-server` on PATH. Windows can use `ECHO_TEST_REDIS_WSL_WRAPPER` pointing
to a Bash launcher which accepts a port and logfile and execs Redis. Set
`ECHO_REQUIRE_REDIS_TESTS=1` in acceptance runs to fail if the client or server
is missing. Ordinary environments without this optional extra skip the module;
the dedicated CI job requires the real service and uploads its test report.

## Project updates

`/api/projects/{project_id}/updates` is a read-only WebSocket subscription with
the same owner/tenant boundary as the HTTP execution-status endpoint. It uses
the shared session/Origin gate and browser bearer subprotocol. Credentials and
canonical project access are checked again before each update, and every
15 seconds while idle. The socket never accepts execution commands.

Successful project SQLite commits enqueue a non-blocking invalidation.
HTTP job admission/running/completion/cancel changes enqueue after their durable
task-state write. SQLite transaction contexts close their handles first; failed
commits, rollbacks and read-only transactions do not notify, and a
notification failure cannot reverse a committed write. A separate delivery
thread coalesces bursts for 50 ms and publishes `project:changed` through the
same configured Redis transport. Remote hints are never republished. A feed
allows at most 1024 active subscriptions and carries no project content.

The client receives `project:ready` or `project:update` with its project ID and
refreshes authorized HTTP reads. Heartbeats carry no execution state. The
project page reconnects with fresh credentials, ignores old sockets and
account changes, and keeps HTTP polling for dropped notifications and expired
worker leases. Delivery is an invalidation, not an ordered execution-event log;
it neither grants budget nor restarts a task.

`tests/test_project_shared_updates.py` uses two spawned HTTP/WS workers sharing
SQLite and a real Redis server. An owner cancellation on one worker wakes the
other worker's owner socket, followed by a canonical HTTP read of the terminal
state. Other actors in the same tenant and actors in another tenant cannot
subscribe. The dedicated acceptance workflow requires this real-service test.

## Workspace file updates

`/api/fs/workspaces/{workspace_id}/updates` is a read-only WebSocket using the
same session/Origin gate and current tenant/membership checks as workspace
reads. Access is rechecked before updates and every 15 seconds while idle;
revocation or a disabled `ui.remote_workspace` flag closes the subscription.
Frames contain only a type and workspace ID, never file paths, credentials or
contents. A viewer may subscribe and read, but cannot write through HTTP or
the socket. Administrative access retains the HTTP operator policy.

The application wires filesystem operations and workspace CRUD to the same
existing WorkspaceStore, LeaseStore and mount registry, keeping their current
database paths. A successful remote write enqueues `workspace:changed` through
the configured collaboration transport. Failed writes do not notify. Caller
`thread_id` values do not select a notification recipient. Production delivery
bypasses the old `file_written` blackboard list; standalone routers without
the optional live feed retain the compatibility helper and its old data.

The shared invalidation feed has at most 1024 subscriptions and 256 pending
workspace keys per worker. Repeated writes coalesce; excess live hints may be
dropped. It never performs network I/O in a source write callback, and remote
hints are not republished. The filesystem remains authoritative: the file
tree refreshes authorized HTTP reads on ready/update and reconnects with fresh
credentials. Loading again or manual refresh catches up after missed hints.

The actual FileTree subscribes using the authorized thread's stored
`workspace_id`, or a remote workspace path prefix. Late binding results,
disposed trees and old sockets cannot refresh a different tree. A workspace
selection event rebinds the subscription. Mount-relative paths resolve inside
the selected mount: `/file`, `./file` and `file` share a canonical lease key;
host drive/UNC paths, parent traversal and alternate streams are rejected.
Active legacy lease aliases remain honored until expiration and are not deleted.

`tests/test_workspace_shared_file_updates.py` serves two spawned workers with
a real Redis server and an actual local mount. An owner write on one worker
wakes the other worker's viewer, followed by an authorized file read. Another
tenant is refused even if an old membership row exists; revocation closes the
viewer before sending the next hint. The dedicated workflow requires this test.
