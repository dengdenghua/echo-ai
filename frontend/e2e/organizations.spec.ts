import { expect, test } from "@playwright/test";

// Real SPA, router and forms; deterministic API transport. Backend ACL/store
// behavior is covered separately by test_org_router/test_organization.
for (const width of [1280, 390]) {
  test(`organization management confirms authority changes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(`Organization page error: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error(`Organization console: ${message.text()}`);
    });
    const members = [
      {
        member_id: "owner",
        kind: "human",
        role: "owner",
        display_name: "Owner",
      },
      { member_id: "eve", kind: "agent", role: "member", display_name: "Eve" },
    ];
    const updates: unknown[] = [];
    const deletions: string[] = [];
    await page.addInitScript(() => {
      document.cookie = "locale=en-US; path=/";
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      // Vite module URLs such as /src/core/api/request.ts also match the glob.
      // Only backend paths belong to this transport fixture.
      if (!path.startsWith("/api/")) return route.continue();
      let data: unknown = {};
      if (path === "/api/auth/status")
        data = {
          enabled: true,
          jwt_available: true,
          allow_registration: false,
          exempt_paths: [],
        };
      else if (path === "/api/auth/me")
        data = {
          user_id: "owner",
          username: "Owner",
          actor_id: "owner",
          roles: ["admin"],
        };
      else if (path === "/api/orgs")
        data = {
          organizations: [{ id: "o", name: "Echo company", owner_id: "owner" }],
        };
      else if (path === "/api/orgs/o/members") {
        if (request.method() === "POST") {
          const body = request.postDataJSON() as {
            member_id: string;
            role: string;
          };
          updates.push(body);
          const member = members.find(
            (entry) => entry.member_id === body.member_id,
          );
          if (member) member.role = body.role;
          data = member;
        } else data = { members };
      } else if (path === "/api/orgs/o/departments")
        data = {
          departments: [{ id: "d", name: "Engineering", parent_id: null }],
        };
      else if (path === "/api/orgs/o/channels")
        data = {
          channels: [
            { id: "c", name: "Build", kind: "channel", department_id: "d" },
          ],
        };
      else if (path === "/api/channels/c/members")
        data = {
          members: [
            { member_id: "owner", role: "viewer" },
            { member_id: "eve", role: "owner" },
          ],
        };
      else if (path.startsWith("/api/orgs/") && request.method() === "DELETE") {
        deletions.push(path);
        data = { deleted: "d" };
      } else if (path === "/api/agents") data = { agents: [] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto("/#/workspace/organizations");
    await expect(
      page.getByRole("heading", { name: "Organizations", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Role: eve", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove: owner" }),
    ).toBeDisabled();
    await page.getByLabel("Role: eve", { exact: true }).selectOption("admin");
    const confirmation = page.getByRole("dialog", {
      name: "Change membership?",
    });
    await expect(confirmation).toBeVisible();
    expect(updates).toHaveLength(0);
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(updates).toHaveLength(0);
    await page.getByLabel("Role: eve", { exact: true }).selectOption("admin");
    await confirmation
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.getByLabel("Role: eve", { exact: true })).toHaveValue(
      "admin",
    );
    expect(updates).toEqual([
      { member_id: "eve", kind: "agent", role: "admin", display_name: "Eve" },
    ]);
    await page
      .getByRole("button", { name: "Delete: Engineering", exact: true })
      .click();
    const deletion = page.getByRole("dialog", { name: "Delete department?" });
    await expect(deletion).toContainText(
      "Child departments and their channels are retained",
    );
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(deletions).toHaveLength(0);
    await page.getByRole("button", { name: /Build.*Engineering/ }).click();
    const channel = page.getByRole("region", { name: "Channel access: Build" });
    // An org owner is only a channel viewer here; no automatic channel admin.
    await expect(
      channel.getByLabel("Role: owner", { exact: true }),
    ).toBeDisabled();
    await expect(
      channel.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    // Flexible rows must wrap rather than squeeze text inputs into tiny boxes.
    const memberFields = page.getByRole("region", {
      name: "Members",
      exact: true,
    });
    expect(
      (
        await memberFields
          .getByLabel("Member ID", { exact: true })
          .boundingBox()
      )?.width,
    ).toBeGreaterThanOrEqual(140);
    expect(
      (
        await memberFields
          .getByLabel("Display name", { exact: true })
          .boundingBox()
      )?.width,
    ).toBeGreaterThanOrEqual(140);
    await page.screenshot({
      path: testInfo.outputPath(`organizations-${width}.png`),
      fullPage: true,
    });
  });
}
