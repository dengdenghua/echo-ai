import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

type ShellEvent = { channel: string; payload: unknown };

test("desktop browser forwards shortcuts, menus, popups and imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-basics-"));
  // A fake Chrome profile so the import never reads the real one.
  const chromeProfile = path.join(
    root,
    "local",
    "Google",
    "Chrome",
    "User Data",
    "Default",
  );
  await mkdir(chromeProfile, { recursive: true });
  await writeFile(
    path.join(chromeProfile, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          children: [
            { type: "url", name: "Example", url: "https://example.com/" },
            { type: "url", name: "Script", url: "javascript:alert(1)" },
            {
              type: "folder",
              children: [
                { type: "url", name: "Nested", url: "https://nested.test/" },
              ],
            },
          ],
        },
      },
    }),
  );
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      req.url === "/page"
        ? `<title>Page</title><a id="pop" href="/popup" target="_blank">open</a><p id="text">Selected words</p>`
        : "<title>Test shell</title><main>Browser basics fixture</main>",
    );
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
      LOCALAPPDATA: path.join(root, "local"),
    },
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    const mount = (partition: string) =>
      win.evaluate(
        async ({ url, partition }) => {
          const w = window as unknown as { __events?: unknown[] };
          if (!w.__events) {
            w.__events = [];
            for (const channel of [
              "browser:keyboard-shortcut",
              "browser:open-tab",
              "browser:ask-selection",
            ] as const) {
              window.echo!.on(channel, (payload) =>
                w.__events!.push({ channel, payload }),
              );
            }
          }
          const webview = document.createElement("webview") as HTMLElement & {
            getWebContentsId(): number;
          };
          webview.style.cssText = "width:800px;height:600px";
          webview.setAttribute("partition", partition);
          // As in webview-tab.tsx: popups reach the main process, which
          // turns them into browser tabs.
          webview.setAttribute("allowpopups", "true");
          const ready = new Promise<number>((resolve) =>
            webview.addEventListener(
              "dom-ready",
              () => resolve(webview.getWebContentsId()),
              { once: true },
            ),
          );
          webview.setAttribute("src", url);
          document.body.append(webview);
          return ready;
        },
        { url: `${base}/page`, partition },
      );
    const events = () =>
      win.evaluate(
        () => (window as unknown as { __events: ShellEvent[] }).__events,
      );
    const id = await mount("persist:echo-browser");

    // Ctrl+F inside the page reaches the browser UI.
    await app.evaluate(({ webContents }, id) => {
      const page = webContents.fromId(id)!;
      page.focus();
      page.sendInputEvent({
        type: "keyDown",
        keyCode: "F",
        modifiers: ["control"],
      });
    }, id);
    await expect
      .poll(async () =>
        (await events()).find((e) => e.channel === "browser:keyboard-shortcut"),
      )
      .toMatchObject({ payload: { key: "f", control: true } });

    // target=_blank links open as browser tabs.
    await app.evaluate(
      ({ webContents }, id) =>
        webContents
          .fromId(id)!
          .executeJavaScript("document.querySelector('#pop').click()", true),
      id,
    );
    await expect
      .poll(async () =>
        (await events()).find((e) => e.channel === "browser:open-tab"),
      )
      .toMatchObject({ payload: { url: `${base}/popup` } });

    // The page context menu offers AI actions for the selection.
    const labels = await app.evaluate(({ Menu, webContents }, id) => {
      const g = globalThis as unknown as {
        __menu?: Electron.MenuItemConstructorOptions[];
      };
      Menu.buildFromTemplate = ((
        template: Electron.MenuItemConstructorOptions[],
      ) => {
        g.__menu = template;
        return { popup() {} };
      }) as unknown as typeof Menu.buildFromTemplate;
      webContents.fromId(id)!.emit(
        "context-menu",
        { preventDefault() {} },
        {
          x: 1,
          y: 1,
          selectionText: "Selected words",
          isEditable: false,
          linkURL: "",
          mediaType: "none",
          srcURL: "",
        },
      );
      const explain = g.__menu!.find((item) => item.label === "AI 解释");
      (explain!.click as () => void)();
      return g.__menu!.map((item) => item.label ?? item.type);
    }, id);
    expect(labels).toEqual(
      expect.arrayContaining(["AI 解释", "AI 翻译成中文", "问 AI…", "复制"]),
    );
    await expect
      .poll(async () =>
        (await events()).find((e) => e.channel === "browser:ask-selection"),
      )
      .toMatchObject({
        payload: { text: "Selected words", action: "explain" },
      });

    // Bookmark import flattens folders and keeps only web links.
    const imported = await win.evaluate(async () => ({
      chrome: await window.echo!.browser.importBookmarks("chrome"),
      edge: await window.echo!.browser.importBookmarks("edge"),
      print: typeof window.echo!.browser.print,
    }));
    expect(imported.chrome).toEqual({
      ok: true,
      entries: [
        { title: "Example", url: "https://example.com/" },
        { title: "Nested", url: "https://nested.test/" },
      ],
    });
    expect(imported.edge).toMatchObject({ ok: false, error: "not-found" });
    expect(imported.print).toBe("function");

    // Private tabs live in an in-memory session.
    const privateId = await mount("echo-private");
    const persistent = await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id)!.session.isPersistent(),
      privateId,
    );
    expect(persistent).toBe(false);

    // CPU usage is sampled, not derived from loadavg (always 0 on Windows).
    const usage = await win.evaluate(async () => {
      await window.echo!.desktop.getSystemInfo();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await window.echo!.desktop.getSystemInfo()).cpu.usage;
    });
    expect(usage).toBeGreaterThanOrEqual(0);
    expect(usage).toBeLessThanOrEqual(100);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop extensions run in browser tabs only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-ext-"));
  const extensionDir = path.join(root, "marker-extension");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    path.join(extensionDir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Marker",
      version: "1.0.0",
      content_scripts: [
        { matches: ["<all_urls>"], js: ["marker.js"], run_at: "document_end" },
      ],
    }),
  );
  await writeFile(
    path.join(extensionDir, "marker.js"),
    'document.documentElement.dataset.echoMarker = "on";',
  );
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<title>Page</title><p>extension fixture</p>");
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
    // Stand in for the folder picker.
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [dir],
      })) as unknown as typeof dialog.showOpenDialog;
    }, extensionDir);
    const installed = await win.evaluate(() =>
      window.echo!.extensions.installFromFolder(),
    );
    expect(installed).toMatchObject({
      ok: true,
      extension: { name: "Marker", enabled: true },
    });
    const marker = (partition: string) =>
      win.evaluate(
        async ({ url, partition }) => {
          const webview = document.createElement("webview") as HTMLElement & {
            executeJavaScript(code: string): Promise<unknown>;
          };
          webview.setAttribute("partition", partition);
          const ready = new Promise<void>((resolve) =>
            webview.addEventListener("did-finish-load", () => resolve(), {
              once: true,
            }),
          );
          webview.setAttribute("src", url);
          document.body.append(webview);
          await ready;
          await new Promise((resolve) => setTimeout(resolve, 300));
          const value = await webview.executeJavaScript(
            "document.documentElement.dataset.echoMarker || ''",
          );
          webview.remove();
          return value;
        },
        { url: `${base}/page`, partition },
      );
    expect(await marker("persist:echo-browser")).toBe("on");
    expect(await marker("echo-private")).toBe("");
    // Never in the app's own window.
    expect(
      await win.evaluate(
        () => document.documentElement.dataset.echoMarker ?? "",
      ),
    ).toBe("");
    const id = installed.extension!.id;
    expect(
      await win.evaluate(
        (id) => window.echo!.extensions.setEnabled(id, false),
        id,
      ),
    ).toMatchObject({ ok: true });
    expect(await marker("persist:echo-browser")).toBe("");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop restores a tab's back/forward history and reports pane clicks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-history-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<title>${req.url}</title><p>${req.url}</p>`);
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
    const restored = await win.evaluate(async (base) => {
      const entries = ["/a", "/b", "/c"].map((p) => ({
        url: base + p,
        title: p,
      }));
      // Non-web entries are dropped; the index follows the active entry.
      entries.splice(1, 0, { url: "file:///etc/passwd", title: "x" });
      const pointer: number[] = [];
      window.echo!.on("browser:webview-pointer", (id) =>
        pointer.push(Number(id)),
      );
      (window as unknown as { __pointer: number[] }).__pointer = pointer;
      const queued = await window.echo!.browser.queueNavigationRestore(
        `${base}/c`,
        entries,
        3,
      );
      const webview = document.createElement("webview") as HTMLElement & {
        getWebContentsId(): number;
        getURL(): string;
        canGoBack(): boolean;
        canGoForward(): boolean;
        goBack(): void;
      };
      const loaded = new Promise<void>((resolve) =>
        webview.addEventListener("did-finish-load", () => resolve(), {
          once: true,
        }),
      );
      webview.setAttribute("src", `${base}/c`);
      document.body.append(webview);
      await loaded;
      const before = {
        url: webview.getURL(),
        canGoBack: webview.canGoBack(),
      };
      const history = await window.echo!.browser.getNavigationHistory(
        webview.getWebContentsId(),
      );
      webview.goBack();
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {
        queued,
        before,
        history,
        afterBack: webview.getURL(),
        canGoForward: webview.canGoForward(),
        id: webview.getWebContentsId(),
      };
    }, base);
    expect(restored.queued).toEqual({ ok: true });
    expect(restored.before).toEqual({ url: `${base}/c`, canGoBack: true });
    expect(restored.history).toEqual({
      ok: true,
      entries: ["/a", "/b", "/c"].map((p) => ({ url: base + p, title: p })),
      index: 2,
    });
    expect(restored.afterBack).toBe(`${base}/b`);
    expect(restored.canGoForward).toBe(true);

    // A click inside the page is reported with its webContents id.
    await app.evaluate(({ webContents }, id) => {
      webContents.fromId(id)!.sendInputEvent({
        type: "mouseDown",
        x: 10,
        y: 10,
        button: "left",
        clickCount: 1,
      });
    }, restored.id);
    await expect
      .poll(() =>
        win.evaluate(
          () => (window as unknown as { __pointer: number[] }).__pointer,
        ),
      )
      .toContain(restored.id);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop offers to save a submitted login, never in private tabs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-login-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      req.method === "POST"
        ? "<title>Welcome</title><p>signed in</p>"
        : `<title>Login</title><form method="post" action="/session"><input name="user"><input type="password" name="pw"><button id="go">Sign in</button></form>`,
    );
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
    const available = await win.evaluate(
      async () => (await window.echo!.browser.listPasswords()).available,
    );
    test.skip(!available, "no OS encryption for the password vault here");
    const signIn = (partition: string) =>
      win.evaluate(
        async ({ url, partition }) => {
          const w = window as unknown as { __offers?: unknown[] };
          if (!w.__offers) {
            w.__offers = [];
            window.echo!.on("browser:password-offer", (offer) =>
              w.__offers!.push(offer),
            );
          }
          const webview = document.createElement("webview") as HTMLElement & {
            executeJavaScript(code: string, gesture?: boolean): Promise<void>;
          };
          webview.setAttribute("partition", partition);
          const ready = new Promise<void>((resolve) =>
            webview.addEventListener("dom-ready", () => resolve(), {
              once: true,
            }),
          );
          webview.setAttribute("src", url);
          document.body.append(webview);
          await ready;
          await webview.executeJavaScript(
            `document.querySelector('[name=user]').value = 'alice';
             document.querySelector('[name=pw]').value = 's3cret';
             document.querySelector('#go').click();`,
            true,
          );
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return w.__offers!.length;
        },
        { url: `${base}/login`, partition },
      );
    expect(await signIn("echo-private")).toBe(0);
    expect(await signIn("persist:echo-browser")).toBe(1);
    const offer = await win.evaluate(
      () =>
        (window as unknown as { __offers: Record<string, unknown>[] })
          .__offers[0]!,
    );
    expect(offer).toMatchObject({
      origin: base,
      username: "alice",
      update: false,
    });
    expect(JSON.stringify(offer)).not.toContain("s3cret");
    const saved = await win.evaluate(async (token) => {
      const result = await window.echo!.browser.resolvePasswordOffer(
        token,
        true,
      );
      const again = await window.echo!.browser.resolvePasswordOffer(
        token,
        true,
      );
      return { result, again };
    }, String(offer.token));
    expect(saved.result).toEqual({ ok: true, saved: true });
    expect(saved.again).toMatchObject({ ok: false });
    const listed = await win.evaluate(
      (origin) => window.echo!.browser.listPasswords(origin),
      base,
    );
    expect(listed.entries.map((entry) => entry.username)).toEqual(["alice"]);
    expect(JSON.stringify(listed)).not.toContain("s3cret");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
