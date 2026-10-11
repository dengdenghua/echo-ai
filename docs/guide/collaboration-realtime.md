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
survives. Project HTTP execution status has its existing polling contract;
this change does not add a project status subscription API.

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
