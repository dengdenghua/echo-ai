# Standing authorization

An authenticated project owner can authorize unattended progress from the
project page. Select unfinished phases with finite positive AI budgets, enter
a total project cost ceiling, and review the server's phase list before
confirming. The review expires after five minutes. Changed phase content,
ownership or tenant scope requires another review.

The ceiling includes all reported project spend, including earlier manual
runs. Phase budgets continue to apply. An already admitted call may settle
above the most recently reported ceiling; no further call is admitted after
exhaustion or a missing cost receipt. Direct planning and QA model calls record
their costs as well as task execution. A default zero is treated as missing
unless the router explicitly reports USD.

Confirmation records a durable grant. While the app's backend is running,
its standing service checks runnable grants every 30 seconds and submits work
through the same bounded, persisted project worker queue used by explicit
background runs. Closing the project page does not remove a grant. Another
worker cannot concurrently execute the same project lease.

Standing authorization does not approve initiation, authorize a new phase,
accept delivery, run human-assigned work, or automatically recover ambiguous
crash claims. These remain owner decisions. Workers recheck the current
registered identity, managed workspace, grant generation, phase fingerprint
and reported budget at execution boundaries. Project state does not silently
inherit administrator approval.

Revoke authorization to stop admission of new work. In-flight calls may settle,
and interrupted task outputs are retained for QA without consuming their retry
allowance. The execution cancel button also pauses that grant's worker;
restarting requires a new explicit grant. Replaying a consumed confirmation
returns its original receipt and cannot undo revocation.

The authenticated HTTP contract is:

- `GET /api/projects/{id}/standing-authorization`: the current reviewed grant.
- `POST /api/projects/{id}/standing-authorization/review`: phase IDs and a finite positive ceiling.
- `POST /api/projects/{id}/standing-authorization/confirm`: the server review ID and the JSON boolean `confirmed: true`.
- `DELETE /api/projects/{id}/standing-authorization`: owner revocation.

Each decision is a sealed project event. The confirmation source label alone
does not confer production execution authority: the service requires the
matching owner-bound server review. This records an explicit authenticated
owner decision; it does not claim to verify the physical person operating an
API client. Notifications to external messaging services are a separate route.
