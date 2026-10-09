# Personal conversation list removal

The user chose removal from their own list while retaining shared groups and
project data. Sidebar, drawer and recent-chat removal now use a personal
visibility preference, not the permanent thread DELETE endpoint.

Preferences are persisted separately from conversation state in SQLite, keyed
by authenticated tenant, actor and thread. The endpoint checks current read
access; the request cannot choose another actor. Hidden threads are filtered
before list pagination. Direct access and shared group membership remain intact.
Permanent deletion guards remain in place.

The UI labels the action “从我的列表移除”, offers an immediate undo, and exposes an
“已移除” list with restore buttons. A failed preference write leaves the list and
current route unchanged. Restoring does not change conversation timestamps or
project metadata.

Validation:

- 30 backend tests passed: persistence, idempotence, actor/tenant isolation,
  reader access, pagination, invalid input, retained thread snapshots and group
  events, plus existing thread and linked-room ACL tests.
- 21 frontend tests passed: personal removal/undo/restore, failed requests,
  drawer recovery entry and existing deletion/error regressions.
- TypeScript and scoped Ruff checks passed.
- Restarted the local backend after the active turn had completed; health passed.
- Browser verified removal, restoration, re-removal and persistence across reload.
  The two screenshot targets (“实跑验证3·任务规则评审” and
  “实跑验证2·数据质量报告”) are now absent from the user's normal sidebar and present
  in their removed list. No shared conversation or project was deleted.
