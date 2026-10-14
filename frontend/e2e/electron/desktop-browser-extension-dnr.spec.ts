import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

async function launch(root: string) {
  return electron.launch({
    args: [
      path.resolve("electron/main.cjs"),
      "--hidden",
      `--user-data-dir=${root}/profile`,
    ],
    env: {
      ...process.env,
      ELECTRON_START_URL: "about:blank",
      ECHO_DATA_DIR: root,
      ECHO_PET_DISABLED: "1",
    },
  });
}

async function mainWindow(app: ElectronApplication) {
  let main: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of app.windows()) {
        try {
          if (await page.evaluate(() => Boolean(window.echo?.extensions))) {
            main = page;
            return true;
          }
        } catch {
          // A bootstrap view may be navigating while the desktop is loading.
        }
      }
      return false;
    })
    .toBe(true);
  return main!;
}

async function install(app: ElectronApplication, folder: string) {
  const win = await mainWindow(app);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, folder);
  return win.evaluate(() => window.echo!.extensions.installFromFolder());
}

async function navigate(
  app: ElectronApplication,
  url: string,
  partition = "persist:echo-browser",
) {
  return app.evaluate(
    async ({ session, WebContentsView }, { url, partition }) => {
      const view = new WebContentsView({
        webPreferences: {
          session: session.fromPartition(partition),
          sandbox: true,
          contextIsolation: true,
        },
      });
      try {
        await view.webContents.loadURL(url);
        return { ok: true, url: view.webContents.getURL() };
      } catch (error) {
        return { ok: false, error: String(error) };
      } finally {
        view.webContents.close();
      }
    },
    { url, partition },
  );
}

async function ruleApi(
  app: ElectronApplication,
  id: string,
  method: string,
  args: unknown[] = [],
) {
  return app.evaluate(
    async ({ session, WebContentsView }, { id, method, args }) => {
      const view = new WebContentsView({
        webPreferences: {
          session: session.fromPartition("persist:echo-browser"),
          sandbox: true,
          contextIsolation: true,
        },
      });
      try {
        await view.webContents.loadURL(
          `chrome-extension://${id}/manifest.json`,
        );
        return await view.webContents.executeJavaScript(
          `chrome.declarativeNetRequest[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
        );
      } finally {
        view.webContents.close();
      }
    },
    { id, method, args },
  );
}

test("native DNR preserves rules, permissions and user choices across restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-extension-dnr-"));
  const folder = path.join(root, "extension");
  await mkdir(folder);
  const seen: { url: string; marker?: string }[] = [];
  const server = createServer((request, response) => {
    seen.push({
      url: request.url!,
      marker: request.headers["x-echo-probe"] as string | undefined,
    });
    response.end("<title>network probe</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const deniedServer = createServer((_request, response) =>
    response.end("<title>outside host permission</title>"),
  );
  await new Promise<void>((resolve) =>
    deniedServer.listen(0, "127.0.0.2", resolve),
  );
  const denied = `http://127.0.0.2:${(deniedServer.address() as { port: number }).port}`;
  await writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "DNR lifecycle probe",
      version: "1.0.0",
      action: {},
      background: { service_worker: "worker.js" },
      permissions: ["declarativeNetRequestWithHostAccess"],
      host_permissions: ["http://127.0.0.1/*"],
      declarative_net_request: {
        rule_resources: [
          { id: "main", enabled: true, path: "main.json" },
          { id: "optional", enabled: false, path: "optional.json" },
        ],
      },
    }),
  );
  await writeFile(
    path.join(folder, "worker.js"),
    `chrome.declarativeNetRequest.getEnabledRulesets().then(ids => chrome.action.setBadgeText({ text: ids.join(',') || 'off' }));`,
  );
  await writeFile(
    path.join(folder, "main.json"),
    JSON.stringify([
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: "/blocked", resourceTypes: ["main_frame"] },
      },
      {
        id: 2,
        priority: 1,
        action: { type: "redirect", redirect: { url: base + "/target" } },
        condition: { urlFilter: "/redirect", resourceTypes: ["main_frame"] },
      },
      {
        id: 3,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "x-echo-probe", operation: "set", value: "native" },
          ],
        },
        condition: { urlFilter: "/header", resourceTypes: ["main_frame"] },
      },
    ]),
  );
  await writeFile(
    path.join(folder, "optional.json"),
    JSON.stringify([
      {
        id: 1,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: "/optional", resourceTypes: ["main_frame"] },
      },
    ]),
  );
  let app = await launch(root);
  try {
    const installed = await install(app, folder);
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const id = installed.extension!.id;
    const win = await mainWindow(app);
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0];
      main.webContents.setBackgroundThrottling(false);
      main.show();
    });
    await expect
      .poll(() =>
        win.evaluate(
          async (id) =>
            (await window.echo!.extensions.actions(null)).actions.find(
              (row) => row.id === id,
            )?.badgeText,
          id,
        ),
      )
      .toBe("main");
    expect(await ruleApi(app, id, "getEnabledRulesets")).toEqual(["main"]);
    expect((await navigate(app, base + "/blocked")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    expect(seen.some((row) => row.url === "/blocked")).toBe(false);
    expect(await navigate(app, base + "/redirect")).toMatchObject({
      ok: true,
      url: base + "/target",
    });
    expect(seen.some((row) => row.url === "/redirect")).toBe(false);
    expect(await navigate(app, base + "/header")).toMatchObject({ ok: true });
    expect(seen.find((row) => row.url === "/header")?.marker).toBe("native");
    expect(await navigate(app, denied + "/blocked")).toMatchObject({
      ok: true,
    });
    expect(
      await navigate(app, base + "/blocked", "echo-private"),
    ).toMatchObject({ ok: true });
    expect(await navigate(app, base + "/optional")).toMatchObject({ ok: true });

    await ruleApi(app, id, "updateDynamicRules", [
      {
        addRules: [
          {
            id: 7,
            action: { type: "block" },
            condition: { urlFilter: "/dynamic", resourceTypes: ["main_frame"] },
          },
        ],
      },
    ]);
    await ruleApi(app, id, "updateSessionRules", [
      {
        addRules: [
          {
            id: 7,
            action: { type: "block" },
            condition: { urlFilter: "/session", resourceTypes: ["main_frame"] },
          },
        ],
      },
    ]);
    expect((await navigate(app, base + "/dynamic")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    expect((await navigate(app, base + "/session")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    await ruleApi(app, id, "updateEnabledRulesets", [
      { disableRulesetIds: ["main"], enableRulesetIds: ["optional"] },
    ]);
    expect(await navigate(app, base + "/blocked")).toMatchObject({ ok: true });
    expect((await navigate(app, base + "/optional")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );

    await app.close();
    app = await launch(root);
    await app.firstWindow();
    await expect
      .poll(() => ruleApi(app, id, "getEnabledRulesets"))
      .toEqual(["optional"]);
    expect(await navigate(app, base + "/blocked")).toMatchObject({ ok: true });
    expect((await navigate(app, base + "/optional")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    expect((await navigate(app, base + "/dynamic")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    expect(await navigate(app, base + "/session")).toMatchObject({ ok: true });
    const restarted = await mainWindow(app);
    expect(
      await restarted.evaluate(
        (id) => window.echo!.extensions.setEnabled(id, false),
        id,
      ),
    ).toMatchObject({ ok: true });
    expect(await navigate(app, base + "/optional")).toMatchObject({ ok: true });
    expect(
      await restarted.evaluate(
        (id) => window.echo!.extensions.setEnabled(id, true),
        id,
      ),
    ).toMatchObject({ ok: true });
    expect(await ruleApi(app, id, "getEnabledRulesets")).toEqual(["optional"]);
    expect((await navigate(app, base + "/optional")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    await ruleApi(app, id, "updateEnabledRulesets", [
      { disableRulesetIds: ["optional"] },
    ]);
    expect(await ruleApi(app, id, "getEnabledRulesets")).toEqual([]);
    await app.close();
    app = await launch(root);
    await app.firstWindow();
    await expect.poll(() => ruleApi(app, id, "getEnabledRulesets")).toEqual([]);
    expect(await navigate(app, base + "/blocked")).toMatchObject({ ok: true });
    expect(await navigate(app, base + "/optional")).toMatchObject({ ok: true });
    const finalWindow = await mainWindow(app);
    await finalWindow.evaluate((id) => window.echo!.extensions.remove(id), id);
    expect(await navigate(app, base + "/dynamic")).toMatchObject({ ok: true });
    const reinstalled = await install(app, folder);
    expect(reinstalled.ok, JSON.stringify(reinstalled)).toBe(true);
    expect(reinstalled.extension!.id).toBe(id);
    expect(await ruleApi(app, id, "getEnabledRulesets")).toEqual(["main"]);
    expect(await ruleApi(app, id, "getDynamicRules")).toEqual([]);
    expect(await ruleApi(app, id, "getSessionRules")).toEqual([]);
    expect((await navigate(app, base + "/blocked")).error).toContain(
      "ERR_BLOCKED_BY_CLIENT",
    );
    expect(await navigate(app, base + "/dynamic")).toMatchObject({ ok: true });
  } finally {
    await app.close();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => deniedServer.close(() => resolve())),
    ]);
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid static rules cannot leave an extension loaded", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "echo-extension-dnr-invalid-"),
  );
  const folder = path.join(root, "extension");
  await mkdir(folder);
  await writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Invalid DNR probe",
      version: "1.0.0",
      permissions: ["declarativeNetRequest"],
      declarative_net_request: {
        rule_resources: [{ id: "invalid", enabled: true, path: "rules.json" }],
      },
    }),
  );
  await writeFile(path.join(folder, "rules.json"), "not JSON");
  const app = await launch(root);
  try {
    const result = await install(app, folder);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(
      await app.evaluate(({ session }) =>
        session
          .fromPartition("persist:echo-browser")
          .extensions.getAllExtensions()
          .map((extension) => extension.name),
      ),
    ).not.toContain("Invalid DNR probe");
    // A failed compiler initialization must not poison a corrected retry.
    await writeFile(path.join(folder, "rules.json"), "[]");
    expect(await install(app, folder)).toMatchObject({ ok: true });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("dynamic-only reinstall clears stale rules before the first request", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "echo-extension-dnr-dynamic-"),
  );
  const folder = path.join(root, "extension");
  await mkdir(folder);
  await writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Dynamic-only DNR probe",
      version: "1.0.0",
      permissions: ["declarativeNetRequest"],
    }),
  );
  const server = createServer((_request, response) => response.end("dynamic"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/dynamic`;
  let app = await launch(root);
  try {
    const installed = await install(app, folder);
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const id = installed.extension!.id;
    await ruleApi(app, id, "updateDynamicRules", [
      {
        addRules: [
          {
            id: 1,
            action: { type: "block" },
            condition: { urlFilter: "/dynamic", resourceTypes: ["main_frame"] },
          },
        ],
      },
    ]);
    expect((await navigate(app, url)).error).toContain("ERR_BLOCKED_BY_CLIENT");
    await app.close();
    app = await launch(root);
    const win = await mainWindow(app);
    // The static-less extension must initialize on startup too.
    expect((await navigate(app, url)).error).toContain("ERR_BLOCKED_BY_CLIENT");
    await win.evaluate((id) => window.echo!.extensions.remove(id), id);
    expect(await install(app, folder)).toMatchObject({ ok: true });
    // No DNR API call may be necessary to clear the native leftover rules.
    expect(await navigate(app, url)).toMatchObject({ ok: true });
    expect(await ruleApi(app, id, "getDynamicRules")).toEqual([]);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
