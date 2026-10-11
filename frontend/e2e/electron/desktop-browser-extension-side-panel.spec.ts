import type { WebContentsView } from "electron";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("extension side panel occupies browser layout inside the main window", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(tmpdir(), "echo-side-panel-"));
  const folder = path.join(root, "extension");
  const repo = path.resolve("..");
  await mkdir(folder);
  await writeFile(
    path.join(folder, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Embedded panel probe",
      version: "1.0.0",
      action: {},
      permissions: ["sidePanel"],
      side_panel: { default_path: "panel.html" },
      background: { service_worker: "worker.js" },
    }),
  );
  await writeFile(
    path.join(folder, "worker.js"),
    `
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => chrome.action.setBadgeText({text:'ready'}));
    chrome.sidePanel.onOpened.addListener(() => chrome.action.setBadgeText({text:'opened'}));
    chrome.sidePanel.onClosed.addListener(() => chrome.action.setBadgeText({text:'closed'}));
  `,
  );
  await writeFile(
    path.join(folder, "panel.html"),
    "<!doctype html><title>Embedded extension</title><p>Native extension content</p>",
  );
  await writeFile(
    path.join(folder, "second.html"),
    "<!doctype html><title>Changed panel</title><p>Second panel</p>",
  );
  const app = await electron.launch({
    args: [
      path.resolve("electron/main.cjs"),
      "--smoke-test-backend",
      `--user-data-dir=${root}/profile`,
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
    await win.waitForFunction(
      () => !!sessionStorage.getItem("echo_auth_token"),
      undefined,
      { timeout: 60_000 },
    );
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0];
      main.webContents.setBackgroundThrottling(false);
      main.show();
    });
    await win.goto("echo-app://app/browser");
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    const installed = await win.evaluate(() =>
      window.echo!.extensions.installFromFolder(),
    );
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
    const id = installed.extension!.id;
    const badge = () =>
      win.evaluate(
        async (id) =>
          (await window.echo!.extensions.actions(null)).actions.find(
            (row) => row.id === id,
          )?.badgeText,
        id,
      );
    await expect.poll(badge).toBe("ready");
    await win.locator(`[data-extension-action="${id}"]`).click();
    const panel = win.locator(`[data-extension-side-panel="${id}"]`);
    await expect(panel).toBeVisible();
    await expect.poll(badge).toBe("opened");
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);

    const native = () =>
      app.evaluate(({ BrowserWindow }, id) => {
        const main = BrowserWindow.getAllWindows()[0];
        const view = main.contentView.children.find(
          (child) =>
            "webContents" in child &&
            (child as WebContentsView).webContents
              .getURL()
              .startsWith(`chrome-extension://${id}/`),
        ) as WebContentsView | undefined;
        return view
          ? {
              bounds: view.getBounds(),
              visible: view.getVisible(),
              zoom: main.webContents.getZoomFactor(),
            }
          : null;
      }, id);
    const checkBounds = async () => {
      const box = await panel
        .locator("[data-extension-side-panel-surface]")
        .boundingBox();
      const view = await native();
      expect(box).not.toBeNull();
      expect(view?.visible).toBe(true);
      for (const [actual, css] of [
        [view!.bounds.x, box!.x],
        [view!.bounds.y, box!.y],
        [view!.bounds.width, box!.width],
        [view!.bounds.height, box!.height],
      ])
        expect(
          Math.abs(actual - Math.round(css * view!.zoom)),
        ).toBeLessThanOrEqual(2);
    };
    await expect(checkBounds).toPass({ timeout: 5000 });
    const panelPage = app
      .windows()
      .find((page) => page.url().startsWith(`chrome-extension://${id}/`))!;
    await expect(panelPage.getByText("Native extension content")).toBeVisible();
    // Extension API calls cannot navigate the embedded surface off origin.
    await expect(
      panelPage.evaluate(
        "chrome.sidePanel.setOptions({ path: 'https://example.invalid/' })",
      ),
    ).rejects.toThrow("own extension");
    await app.evaluate(async ({ session, WebContentsView }, id) => {
      const caller = new WebContentsView({
        webPreferences: {
          session: session.fromPartition("persist:echo-browser"),
          sandbox: true,
          contextIsolation: true,
        },
      });
      try {
        await caller.webContents.loadURL(
          `chrome-extension://${id}/manifest.json`,
        );
        await caller.webContents.executeJavaScript(
          "chrome.sidePanel.setOptions({path:'second.html'})",
        );
      } finally {
        caller.webContents.close();
      }
    }, id);
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => window.echo!.extensions.sidePanelState()))
            ?.path,
      )
      .toBe("second.html");
    await expect(checkBounds).toPass({ timeout: 5000 });
    // The page gets the remaining space; the native panel does not cover it.
    const stage = await win
      .locator("[data-browser-pane]")
      .first()
      .boundingBox();
    const panelBox = await panel.boundingBox();
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(panelBox!.x + 1);
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0];
      main.setSize(1080, 740);
      main.webContents.setZoomFactor(1.25);
    });
    await expect(checkBounds).toPass({ timeout: 5000 });
    await panel.getByRole("button").click();
    await expect(panel).toHaveCount(0);
    await expect.poll(native).toBeNull();
    await expect.poll(badge).toBe("closed");
    await win.locator(`[data-extension-action="${id}"]`).click();
    await expect(panel).toBeVisible();
    await win.goto("echo-app://app/workspace/settings");
    await expect(win).toHaveURL(/workspace\/settings/);
    await expect.poll(async () => (await native())?.visible).toBe(false);
    await win.goto("echo-app://app/browser");
    await expect(panel).toBeVisible();
    await expect(checkBounds).toPass({ timeout: 5000 });
    await win.evaluate(
      (id) => window.echo!.extensions.setEnabled(id, false),
      id,
    );
    await expect(panel).toHaveCount(0);
    await expect.poll(native).toBeNull();
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
