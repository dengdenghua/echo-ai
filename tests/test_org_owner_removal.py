import pytest

from runtime.workspace.org_store import LastOwnerError, OrgStore


def test_org_removal_cannot_orphan_channel_and_rolls_back_membership(tmp_path):
    store = OrgStore(tmp_path / "orgs.sqlite3")
    org = store.create_organization(name="Org", owner_id="admin")
    store.add_org_member(org.id, "departing", kind="human", role="member")
    channel = store.create_channel(org_id=org.id, name="Channel")
    store.add_channel_member(channel.id, "departing", role="owner")
    with pytest.raises(LastOwnerError, match="transfer channel ownership"):
        store.remove_org_member(org.id, "departing")
    assert store.get_org_member_role(org.id, "departing") == "member"
    assert store.get_channel_member_role(channel.id, "departing") == "owner"
    store.add_channel_member(channel.id, "admin", role="owner")
    assert store.remove_org_member(org.id, "departing")
    assert store.get_org_member_role(org.id, "departing") is None
    assert store.get_channel_member_role(channel.id, "departing") is None
    assert store.get_channel_member_role(channel.id, "admin") == "owner"
