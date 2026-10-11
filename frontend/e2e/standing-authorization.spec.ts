import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import pathModule from "node:path";
import { expect, test } from "@playwright/test";

// Real SPA controls with deterministic HTTP transport. Actual background
// execution, tenant ACLs and host capabilities run in test_standing_service.
const packageRoot = pathModule.resolve(
  process.cwd(),
  "../extensions/workbench-apps/projects",
);
test.beforeAll(() => {
  test.setTimeout(180_000);
  execFileSync(
    process.execPath,
    ["scripts/build-local-workbench.mjs", "projects"],
    { cwd: process.cwd(), timeout: 150_000, stdio: "pipe" },
  );
});
for (const width of [1280, 390]) {
  test(`standing authorization reviews scope before granting at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      document.cookie = "locale=en-US; path=/";
    });
    let active = false;
    const decisions: string[] = [];
    const project = {
      id: "P",
      name: "Reviewed project",
      goal: "A bounded deliverable",
      status: "running",
      owner: "Owner",
      owner_id: "owner",
      tenant_id: "a",
      created_at: "2026-10-11T00:00:00Z",
      started_at: "",
      finished_at: "",
    };
    const phases = [
      {
        id: "M",
        name: "Reviewed phase",
        status: "pending",
        spec: { ai_budget_usd: 5 },
      },
    ];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const assets = "/api/workbench-packages/projects/assets/";
      if (path.startsWith(assets)) {
        const target = pathModule.resolve(
          packageRoot,
          path.slice(assets.length),
        );
        if (!target.startsWith(packageRoot + pathModule.sep))
          throw new Error("fixture asset escaped package root");
        return route.fulfill({ path: target });
      }
      let data: unknown = {};
      if (path === "/api/workbench-packages/projects/manifest") {
        data = {
          ...JSON.parse(
            await readFile(pathModule.join(packageRoot, "app.json"), "utf8"),
          ),
          entry_url: assets + "dist/index.html",
        };
      } else if (path === "/api/agent-market/cloud/installed") {
        data = {
          plugins: ["projects"],
          plugin_states: {
            projects: {
              installed: true,
              enabled: true,
              lifecycle_state: "ready",
            },
          },
        };
      } else if (path === "/api/auth/status")
        data = {
          enabled: true,
          jwt_available: true,
          allow_registration: false,
          exempt_paths: [],
        };
      else if (path === "/api/auth/me")
        data = {
          user_id: "owner",
          actor_id: "owner",
          username: "Owner",
          roles: ["admin"],
        };
      else if (path === "/api/projects") data = { projects: [project] };
      else if (path === "/api/projects/portfolio") data = { portfolio: [] };
      else if (path === "/api/projects/P")
        data = {
          project,
          milestones: phases,
          tasks: {},
          pm: null,
          retro: null,
          available_actions: [],
          action_specs: [],
        };
      else if (path.endsWith("/standing-authorization/review")) {
        decisions.push("review");
        expect(request.postDataJSON()).toEqual({
          phase_ids: ["M"],
          limit_usd: 3,
        });
        data = {
          review_id: "review",
          project_id: "P",
          owner_id: "owner",
          tenant_id: "a",
          phases: [
            {
              id: "M",
              name: "Reviewed phase",
              fingerprint: "fingerprint",
              ai_budget_usd: 5,
            },
          ],
          limit_usd: 3,
          expires_at: 9999999999,
          budget_basis: "cumulative_project_spend",
        };
      } else if (path.endsWith("/standing-authorization/confirm")) {
        decisions.push("confirm");
        expect(request.postDataJSON()).toEqual({
          review_id: "review",
          confirmed: true,
        });
        active = true;
        data = { grant_id: "grant", replayed: false };
      } else if (path.endsWith("/standing-authorization")) {
        if (request.method() === "DELETE") {
          decisions.push("revoke");
          active = false;
          data = { revocation_id: "revoke" };
        } else
          data = {
            grant: active
              ? {
                  grant_id: "grant",
                  project_id: "P",
                  owner_id: "owner",
                  tenant_id: "a",
                  granted_by: "owner",
                  review_id: "review",
                  phase_ids: ["M"],
                  phase_fingerprints: ["fingerprint"],
                  limit_usd: 3,
                  budget_basis: "cumulative_project_spend",
                }
              : null,
          };
      } else if (path === "/api/agents") data = { agents: [] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto("/#/workspace/projects");
    const frame = page.frameLocator('iframe[title="项目管理"]');
    const panel = frame.getByRole("region", { name: "Unattended progress" });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await panel.getByRole("checkbox", { name: "Reviewed phase" }).check();
    await panel
      .getByRole("textbox", { name: "Total project AI ceiling (USD)" })
      .fill("3");
    await panel.getByRole("button", { name: "Review authorization" }).click();
    const dialog = frame.getByRole("dialog", { name: "Authorize progress" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Reviewed phase ($5)");
    await expect(dialog).toContainText(
      "includes previous reported project spending",
    );
    expect(decisions).toEqual(["review"]);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    expect(decisions).toEqual(["review"]);
    await panel.getByRole("button", { name: "Review authorization" }).click();
    await dialog
      .getByRole("button", { name: "Authorize progress", exact: true })
      .click();
    await expect(panel).toContainText("Authorization recorded · $3");
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({
      path: testInfo.outputPath(`standing-panel-${width}.png`),
    });
    await panel.getByRole("button", { name: "Revoke authorization" }).click();
    const revoke = frame.getByRole("dialog", {
      name: "Stop unattended progress?",
    });
    await expect(revoke).toBeVisible();
    await revoke
      .getByRole("button", { name: "Revoke authorization", exact: true })
      .click();
    await expect(panel).toContainText("No standing authorization");
    expect(decisions).toEqual(["review", "review", "confirm", "revoke"]);
    expect(errors).toEqual([]);
  });
}
