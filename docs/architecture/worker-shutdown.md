# Worker shutdown and outbound delivery

`ParallelTaskRunner.shutdown()` cancels cooperative task tokens and pending futures, then waits at most five seconds by default for running handlers. A handler that ignores cancellation can continue in a daemon thread until process exit. This is a bound on waiting, not proof that an external operation has stopped.

`ChannelManager.stop_all()` first closes its outbound queue to new messages and drains submitted sends while channel transports remain available. Its default five-second grace period covers draining and stopping transports. Transport stops run concurrently so one stalled adapter cannot hold the host open indefinitely.

At the deadline, queued sends are cancelled and recorded as delivery failures. Running sends have an unknown outcome: the remote service may already have accepted the message. They are recorded distinctly and are not automatically retried, because retrying could deliver the same message twice. A late completion is observed by the future callback. A new send after shutdown is rejected explicitly.

These pools use `DaemonThreadPoolExecutor`. Its threads deliberately do not enter CPython's global executor shutdown registry; ordinary daemon flags alone would still let that registry join a stuck worker indefinitely. Owners must drain or cancel their work before exit. Tests include a child Python process with a permanently blocked worker, delivery before transport shutdown, cancellation of queued sends, and recording uncertain running sends.

This thread lifecycle is separate from subprocess Job Objects. Shell cancellation and process-tree cleanup retain their own rules in [windows-job-objects.md](windows-job-objects.md).
