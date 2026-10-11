import { describe, expect, it } from "vitest";
import { membershipPermissions, organizationActor } from "./permissions";
import { departmentPath } from "@/components/organizations/department-panel";
import type { ChannelMember } from "./api";
describe("organization membership authority", () => {
  const members: ChannelMember[] = [
    { member_id: "owner", role: "owner" },
    { member_id: "admin", role: "admin" },
    { member_id: "reader", role: "viewer" },
  ];
  it("does not turn platform admins or guests into organization admins", () => {
    expect(membershipPermissions(members, "platform-admin").manage).toBe(false);
    expect(membershipPermissions(members, "reader").manage).toBe(false);
    expect(
      organizationActor(
        { user_id: "owner", username: "Owner", is_guest: true },
        true,
      ),
    ).toBe("");
    expect(
      organizationActor(
        { user_id: "__anonymous__", username: "anonymous" },
        true,
      ),
    ).toBe("");
    expect(
      organizationActor(
        { user_id: "u", actor_id: "owner", username: "Owner" },
        true,
      ),
    ).toBe("owner");
  });
  it("requires the owner for owner edits and protects the last owner", () => {
    expect(membershipPermissions(members, "admin").canEdit(members[0]!)).toBe(
      false,
    );
    expect(
      membershipPermissions(members, "admin").canSave(members[2]!, "owner"),
    ).toBe(false);
    const owner = membershipPermissions(members, "owner");
    expect(owner.lastOwner(members[0]!)).toBe(true);
    expect(owner.canSave(members[0]!, "member")).toBe(false);
    expect(owner.canSave(members[0]!, "owner")).toBe(true);
    expect(
      membershipPermissions(
        [...members, { member_id: "second", role: "owner" }],
        "owner",
      ).canSave(members[0]!, "member"),
    ).toBe(true);
  });
  it("a removed organization member cannot manage retained channel ownership", () => {
    expect(membershipPermissions(members, "owner", false).manage).toBe(false);
  });
  it("shows ancestry and terminates on malformed department cycles", () => {
    const root = { id: "r", name: "Root", parent_id: null };
    const child = { id: "c", name: "Child", parent_id: "r" };
    expect(departmentPath(child, [root, child])).toBe("Root / Child");
    expect(departmentPath(child, [{ ...root, parent_id: "c" }, child])).toBe(
      "Root / Child",
    );
  });
});
