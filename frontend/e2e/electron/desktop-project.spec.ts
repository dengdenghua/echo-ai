import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

test("desktop initiation approval persists while execution stays gated", async ({}, info) => {
  const profile = await mkdtemp(path.join(tmpdir(), "echo-project-approval-"));
  const app = await electron.launch({
    args: [
      path.join(repo, "frontend/electron/main.cjs"),
      "--smoke-test-backend",
      `--user-data-dir=${profile}`,
    ],
    cwd: repo,
    env: {
      ...process.env,
      ECHO_PET_DISABLED: "1",
      ECHO_DESKTOP_BACKEND_ROOT: repo,
      ECHO_BACKEND_URL: "http://127.0.0.1:18001",
    },
  });
  try {
    const win = await app.firstWindow();
    win.on("pageerror", (error) =>
      console.log("renderer error:", error.message),
    );
    await win.waitForFunction(
      () => !!sessionStorage.getItem("echo_auth_token"),
      undefined,
      { timeout: 60_000 },
    );
    const identity = await win.evaluate(async () => {
      const response = await fetch("/api/auth/local/whoami", {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("echo_auth_token")}`,
        },
      });
      if (!response.ok) throw new Error(`whoami: ${response.status}`);
      const body = await response.json();
      return {
        actor: body.actor_id,
        tenant: body.metadata.tenant_id || `legacy:${body.actor_id}`,
      };
    });
    expect(typeof identity.actor).toBe("string");
    const data = await app.evaluate(
      ({ app }) => `${app.getPath("userData")}/data`,
    );
    await promisify(execFile)(
      path.join(
        repo,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      ),
      [
        path.join(here, "fixtures/seed-project.py"),
        data,
        identity.actor,
        identity.tenant,
      ],
      { cwd: repo, env: { ...process.env, PYTHONPATH: repo }, timeout: 15_000 },
    );
    const seeded = await win.evaluate(async () => {
      const response = await fetch("/api/projects/P-desktop-closure", {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("echo_auth_token")}`,
        },
      });
      return { status: response.status, body: await response.json() };
    });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    expect(seeded.body.governance.blocked_reason).toBe("initiation");
    await win.goto(
      "echo-app://app/workspace/projects?project=P-desktop-closure",
    );
    const workbench = win.frameLocator('iframe[title="项目管理"]');
    const region = workbench.getByRole("region", { name: "项目审批" });
    await win.screenshot({ path: info.outputPath("project-before.png") });
    try {
      await expect(region.getByText("待立项批准", { exact: true })).toBeVisible(
        { timeout: 15_000 },
      );
    } catch (error) {
      console.log(
        "project loaded document",
        (await win.locator("body").innerText()).slice(0, 2000),
      );
      await win.screenshot({ path: info.outputPath("project-failed.png") });
      throw error;
    }
    await expect(
      workbench.getByRole("button", { name: "Run", exact: true }),
    ).toBeDisabled();
    await region
      .getByRole("textbox", { name: "AI 预算上限（美元，可选）" })
      .fill("5");
    await region.getByRole("button", { name: "批准立项", exact: true }).click();
    const dialog = workbench.getByRole("dialog");
    await expect(dialog).toContainText("批准本身不会执行任务");
    await dialog.getByRole("button", { name: "批准立项", exact: true }).click();
    await expect(
      region.getByText("本阶段待授权", { exact: true }),
    ).toBeVisible();
    await expect(
      workbench.getByRole("button", { name: "Run", exact: true }),
    ).toBeDisabled();
    const persisted = await win.evaluate(async () => {
      const response = await fetch("/api/projects/P-desktop-closure", {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("echo_auth_token")}`,
        },
      });
      if (!response.ok) throw new Error(`project: ${response.status}`);
      return response.json();
    });
    expect(persisted.governance.initiation.state).toBe("approved");
    expect(persisted.governance.initiation.approved_by).toBe(identity.actor);
    expect(persisted.governance.blocked_reason).toBe("phase_authorization");
    expect(persisted.governance.phase.ai_budget_usd).toBe(5);
    expect(persisted.project.started_at).toBe("");
    expect(persisted.tasks).toEqual({ "M-desktop-closure": [] });
    await win.reload();
    await expect(
      region.getByText("本阶段待授权", { exact: true }),
    ).toBeVisible();
    await win.screenshot({ path: info.outputPath("project-approved.png") });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
