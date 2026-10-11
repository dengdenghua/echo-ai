# Organizations and internal channels

Open **Organizations** from the account menu, or visit
`#/workspace/organizations`. An authenticated account can create an organization;
the server resolves its owner from the authenticated principal. Anonymous/local
account-free sessions can read the available organization surface but cannot
create a placeholder-owned organization from this page.

Owners and administrators can add people or agents by their registered ID,
choose a display name and role, and create departments and internal channels.
Submitting an existing member ID updates its membership and requires confirmation.
Only organization owners can grant or edit an owner role or delete the organization.
The last owner cannot be removed or demoted. The server remains authoritative
when a stale page receives a 403, 404 or 409; the page shows the failure and offers
refresh/retry rather than pretending the change succeeded.

Departments can be nested. Deleting a department deletes its directly attached
channels and their permissions. Its child departments and their channels are
retained; direct children move to the deleted department's parent or the
organization root in the same database transaction. The confirmation describes
this behavior before deletion. Deleting an organization removes its departments,
channels and memberships.

Choose an internal channel to inspect its members. Channel owners and
administrators who still belong to the organization can manage channel access.
Organization ownership does not automatically confer ownership of every channel.
The creator of a new channel becomes that channel's owner. A platform
administrator/operator has organization read access but must have actual
organization/channel membership to write. No global role is converted to a
membership role by the frontend.

Account changes discard pending confirmations and form drafts. Read requests
carry cancellation signals, and query caches are scoped to the current actor
and selected organization/channel. A late response from a former account cannot
replace the current account's page.

## Related surfaces

`/api/orgs` and `runtime.workspace.OrgStore` own enterprise membership,
departments and internal channel ACL. `/api/organizations/topologies` owns agent
evolution topologies; it is a separate feature. `/workspace/channels` opens the
assistant's external message-connector panel (Slack, WeChat and other adapters).
Internal channel ACL management does not create or configure those external
connections, and it does not claim to provide a new channel chat transport.

See [the collaboration concepts](../CONCEPTS.md#collaboration-and-membership)
for the relationship between organizations, rooms, groups and workspaces.
