import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BrowserExtensionAction } from "../../src/types/electron";

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

async function writeExtension(dir: string, files: Record<string, string | Buffer>) {
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files))
    await writeFile(path.join(dir, name), body);
}

test("desktop extensions get toolbar buttons, popups and context menus", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-actions-"));
  const popupDir = path.join(root, "toolbar-probe");
  const clickDir = path.join(root, "click-probe");
  await writeExtension(popupDir, {
    "manifest.json": JSON.stringify({
      manifest_version: 3,
      name: "Toolbar Probe",
      version: "1.0.0",
      action: {
        default_title: "Probe",
        default_popup: "popup.html",
        default_icon: { 16: "icon.png" },
      },
      background: { service_worker: "sw.js" },
      permissions: ["contextMenus"],
    }),
    "icon.png": PNG,
    "sw.js": `
      chrome.action.setBadgeText({ text: "5" });
      chrome.action.setBadgeBackgroundColor({ color: [200, 0, 0, 255] });
      chrome.contextMenus.removeAll(() =>
        chrome.contextMenus.create({ id: "probe", title: "Probe %s", contexts: ["selection"] }),
      );
      chrome.contextMenus.onClicked.addListener((info, tab) => {
        chrome.action.setBadgeText({ text: "hit", tabId: tab.id });
        chrome.action.setTitle({ title: "clicked " + info.selectionText + " in " + tab.url });
      });`,
    "popup.html":
      '<!doctype html><body style="margin:8px;width:240px;height:80px">popup<script src="popup.js"></script></body>',
    "popup.js": `
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        document.title = JSON.stringify(tabs.map((t) => ({ id: t.id, url: t.url, active: t.active })));
      });`,
  });
  await writeExtension(clickDir, {
    "manifest.json": JSON.stringify({
      manifest_version: 3,
      name: "Click Probe",
      version: "1.0.0",
      action: { default_title: "Click" },
      background: { service_worker: "sw.js" },
    }),
    "sw.js": `
      chrome.action.onClicked.addListener(async (tab) => {
        const win = await chrome.windows.getCurrent();
        chrome.action.setBadgeText({ text: "ok", tabId: tab.id });
        chrome.action.setTitle({ title: "window " + win.id, tabId: tab.id });
      });`,
  });
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<title>Page</title><p>extension actions fixture</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const app = await electron.launch({
    args: [
      path.resolve("electron/main.cjs"),
      "--hidden",
      `--user-data-dir=${root}/profile`,
    ],
    env: {
      ...process.env,
      ELECTRON_START_URL: base,
      ECHO_DATA_DIR: root,
      ECHO_PET_DISABLED: "1",
    },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    // Stand in for the folder picker: one folder per call.
    await app.evaluate(({ dialog }, dirs) => {
      const queue = [...dirs];
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [queue.shift()!],
      })) as unknown as typeof dialog.showOpenDialog;
    }, [popupDir, clickDir]);
    const install = () =>
      win.evaluate(() => window.echo!.extensions.installFromFolder());
    const probeId = (await install()).extension!.id;
    const clickId = (await install()).extension!.id;

    // A browser tab, made the active one as the browser page does.
    const tabId = await win.evaluate(async (url) => {
      const webview = document.createElement("webview") as HTMLElement & {
        getWebContentsId(): number;
      };
      webview.style.cssText = "width:800px;height:600px";
      webview.setAttribute("partition", "persist:echo-browser");
      const ready = new Promise<number>((resolve) =>
        webview.addEventListener(
          "dom-ready",
          () => resolve(webview.getWebContentsId()),
          { once: true },
        ),
      );
      webview.setAttribute("src", url);
      document.body.append(webview);
      const id = await ready;
      window.echo!.bridge.setActiveTab(id);
      return id;
    }, `${base}/page`);

    const actions = (tab: number | null = tabId) =>
      win.evaluate(
        async (tab) => (await window.echo!.extensions.actions(tab)).actions,
        tab,
      );
    const action = async (id: string, tab: number | null = tabId) =>
      (await actions(tab)).find((a: BrowserExtensionAction) => a.id === id);

    // The service worker's badge reaches the toolbar.
    await expect.poll(async () => (await action(probeId))?.badgeText).toBe("5");
    expect(await action(probeId)).toMatchObject({
      name: "Toolbar Probe",
      title: "Probe",
      hasAction: true,
      hasPopup: true,
      pinned: true,
      enabled: true,
      badgeColor: "rgba(200, 0, 0, 1)",
      icon: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(await action(clickId)).toMatchObject({ hasPopup: false, badgeText: "" });

    // The popup opens under its button and sees the active tab.
    const anchor = { left: 700, top: 10, right: 732, bottom: 42 };
    expect(
      await win.evaluate(
        ({ id, tab, anchor }) => window.echo!.extensions.clickAction(id, tab, anchor),
        { id: probeId, tab: tabId, anchor },
      ),
    ).toMatchObject({ ok: true, opened: "popup" });
    const popupTitle = () =>
      app.evaluate(({ BrowserWindow }) => {
        const popup = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("/popup.html"),
        );
        return popup ? popup.webContents.getTitle() : null;
      });
    await expect
      .poll(async () => {
        const title = await popupTitle();
        return title?.startsWith("[") ? JSON.parse(title) : title;
      })
      .toEqual([{ id: tabId, url: `${base}/page`, active: true }]);
    const popupGeometry = () =>
      app.evaluate(({ BrowserWindow }) => {
        const popup = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("/popup.html"),
        )!;
        const main = BrowserWindow.getAllWindows().find(
          (w) => w !== popup && !w.getParentWindow(),
        )!;
        return {
          visible: popup.isVisible(),
          popup: popup.getBounds(),
          content: main.getContentBounds(),
          zoom: main.webContents.getZoomFactor(),
        };
      });
    // Shown once it has its size: the page's 240px body plus margins.
    await expect
      .poll(async () => {
        const { visible, popup } = await popupGeometry();
        return visible && popup.width >= 256 && popup.height >= 96;
      })
      .toBe(true);
    const geometry = await popupGeometry();
    expect(geometry.popup.x + geometry.popup.width).toBe(
      geometry.content.x + Math.round(anchor.right * geometry.zoom),
    );
    // Clicking the button again closes it.
    expect(
      await win.evaluate(
        ({ id, tab, anchor }) => window.echo!.extensions.clickAction(id, tab, anchor),
        { id: probeId, tab: tabId, anchor },
      ),
    ).toMatchObject({ ok: true, closed: true });
    await expect.poll(popupTitle).toBeNull();

    // The extension's context-menu item shows for a selection and reports
    // the click with the tab.
    const menuLabels = await app.evaluate(({ Menu, webContents }, id) => {
      const g = globalThis as unknown as {
        __menu?: Electron.MenuItemConstructorOptions[];
      };
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
        g.__menu = template;
        return { popup() {} };
      }) as unknown as typeof Menu.buildFromTemplate;
      webContents.fromId(id)!.emit(
        "context-menu",
        { preventDefault() {} },
        {
          x: 1,
          y: 1,
          selectionText: "hello",
          isEditable: false,
          linkURL: "",
          mediaType: "none",
          srcURL: "",
          pageURL: webContents.fromId(id)!.getURL(),
        },
      );
      const item = g.__menu!.find((entry) => entry.label === "Probe hello");
      (item?.click as (() => void) | undefined)?.();
      return g.__menu!.map((entry) => entry.label ?? entry.type);
    }, tabId);
    expect(menuLabels).toContain("Probe hello");
    await expect.poll(async () => (await action(probeId))?.badgeText).toBe("hit");
    expect((await action(probeId))?.title).toBe(`clicked hello in ${base}/page`);
    // Per-tab: other tabs keep the extension-wide badge.
    expect((await action(probeId, 999_999))?.badgeText).toBe("5");

    // No popup: the click goes to the extension, with the tab.
    expect(
      await win.evaluate(
        ({ id, tab, anchor }) => window.echo!.extensions.clickAction(id, tab, anchor),
        { id: clickId, tab: tabId, anchor },
      ),
    ).toMatchObject({ ok: true, dispatched: true });
    await expect.poll(async () => (await action(clickId))?.badgeText).toBe("ok");
    expect((await action(clickId))?.title).toBe("window 1");

    // Pinning, and removal clears the toolbar and the menu.
    await win.evaluate((id) => window.echo!.extensions.setPinned(id, false), clickId);
    expect((await action(clickId))?.pinned).toBe(false);
    await win.evaluate((id) => window.echo!.extensions.remove(id), probeId);
    expect(await action(probeId)).toBeUndefined();
    const afterRemoval = await app.evaluate(({ webContents }, id) => {
      const g = globalThis as unknown as {
        __menu?: Electron.MenuItemConstructorOptions[];
      };
      webContents.fromId(id)!.emit(
        "context-menu",
        { preventDefault() {} },
        { x: 1, y: 1, selectionText: "hello", isEditable: false, linkURL: "", mediaType: "none", srcURL: "" },
      );
      return g.__menu!.map((entry) => entry.label ?? entry.type);
    }, tabId);
    expect(afterRemoval).not.toContain("Probe hello");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
