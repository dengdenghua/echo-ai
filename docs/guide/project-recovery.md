# Project crash recovery

Starting another backend does not mean an existing project executor has died.
Each new task and phase-decomposition claim stores the claiming process's
creation identity and the effective engine claim timeout. Windows and Linux
inspect a local PID together with its creation stamp, so PID reuse cannot make
an old execution generation appear alive. HTTP background jobs also record
their worker process identity.

At startup, a confirmed dead local executor is fenced immediately. An expired
claim is also fenced even if its process remains alive but stopped renewing.
Live claims remain held. Legacy claims, foreign process namespaces and failed
or unsupported native inspections are unknown and remain held until their
stored lease expires. Version 3 adopts existing claims without rewriting their
task outputs or inventing a process identity; their default lease is one hour.

Abandoned tasks and decompositions become blocked. The sealed audit records the
interruption. The sweep does not execute tools, spend model budget, reset retry
counts, approve a phase or accept a delivery. Stored artifacts remain available
for an owner to inspect. A fenced old worker cannot renew its generation or
publish a late output or decomposition.

Use the explicit project recovery control after reviewing the interrupted
work. Recovery resets the selected work according to its existing output and
attempt policy; execution is a separate owner request. An interrupted side
effect may already have happened, so crash recovery does not silently replay it.
Cooperative pause retains completed output for QA and is distinct from an
ambiguous process crash.

A background job whose process is confirmed dead is shown as interrupted even
while its short HTTP lease is still settling. Job takeover remains subject to
the existing durable lease contract; the default HTTP lease expires after 15
seconds. Unknown processes are not reported dead just to enable a takeover.

Restart markers are checked and written in the same source transaction. A new
claim blocks the marker, simultaneous startup workers record one marker, and
unrelated audit events do not erase its deduplication history.
