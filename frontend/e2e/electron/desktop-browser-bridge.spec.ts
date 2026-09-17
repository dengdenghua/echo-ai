import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("desktop HTTP bridge controls only its selected webview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "echo-browser-bridge-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      req.url === "/target"
        ? `<title>Bridge fixture</title><input id="name"><button id="save" onclick="document.querySelector('#result').textContent='Saved: '+document.querySelector('#name').value">Save</button><p id="result">Waiting</p>`
        : "<title>Test shell</title><main>Isolated bridge fixture</main>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
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
    let discovery: { port: number; token: string };
    await expect
      .poll(async () => {
        try {
          discovery = JSON.parse(
            await readFile(path.join(root, "bridge.json"), "utf8"),
          );
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    const request = (action: string, body = {}, auth = true) =>
      fetch(`http://127.0.0.1:${discovery.port}/${action}`, {
        method: "POST",
        headers: auth ? { Authorization: `Bearer ${discovery.token}` } : {},
        body: JSON.stringify(body),
      });
    expect((await request("status", {}, false)).status).toBe(401);
    const crossOrigin = await fetch(
      `http://127.0.0.1:${discovery!.port}/status`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${discovery!.token}`, Origin: base },
        body: "{}",
      },
    );
    expect(crossOrigin.status).toBe(403);
    expect((await request("click", { selector: "#save" })).status).toBe(503);
    const id = await win.evaluate(async (url) => {
      const webview = document.createElement("webview") as HTMLElement & {
        getWebContentsId(): number;
      };
      webview.style.cssText = "width:800px;height:600px";
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
      window.echo?.bridge.setActiveTab(id);
      return id;
    }, `${base}/target`);
    await expect
      .poll(
        async () =>
          (await (await request("status")).json()).activeWebContentsId,
      )
      .toBe(id);
    expect(
      (await request("click", { webContentsId: id, selector: "#save" })).status,
    ).toBe(400);
    expect((await request("executeJS", { code: "1+1" })).status).toBe(404);
    expect(
      (
        await (
          await request("type", {
            selector: "#name",
            text: "Echo",
            clear: true,
          })
        ).json()
      ).ok,
    ).toBe(true);
    expect(
      (await (await request("click", { selector: "#save" })).json()).ok,
    ).toBe(true);
    expect((await (await request("extract")).json()).text).toContain(
      "Saved: Echo",
    );
    expect(
      (await (await request("state")).json()).items.some(
        (item: { selector: string }) => item.selector === "#name",
      ),
    ).toBe(true);
    const repoRoot = path.resolve("..");
    const python =
      process.platform === "win32"
        ? ".venv/Scripts/python.exe"
        : ".venv/bin/python";
    // Exercise the actual backend discovery/auth adapter, not just raw HTTP.
    const receipt = await promisify(execFile)(
      path.join(repoRoot, python),
      [
        "-c",
        `
from runtime.execution.suckers.browser_backends import ElectronBackend
from runtime.execution.suckers.browser_act_skills import _h_current_url, _h_execute_js
b = ElectronBackend()
assert b.available()
assert b.navigate(b.extract().data['url']).ok
assert b.wait('#name').ok
assert b.scroll(delta_y=10).ok
assert b.type('#name', 'Echo Python', clear=True).ok
assert b.click('#save').ok
r = b.extract()
assert r.ok and 'Saved: Echo Python' in r.data['text']
assert _h_current_url()['url'].endswith('/target')
assert _h_execute_js('document.title')['result'] == 'Bridge fixture'
print('python_bridge_verified')
`,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, ECHO_DATA_DIR: root },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(receipt.stdout.trim()).toBe("python_bridge_verified");
    // The renderer cannot select itself as a control target.
    const shellId = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id,
    );
    await win.evaluate((id) => {
      window.echo?.bridge.setActiveTab(id);
    }, shellId);
    await expect
      .poll(
        async () =>
          (await (await request("status")).json()).activeWebContentsId,
      )
      .toBe(null);
    expect((await request("click", { selector: "#save" })).status).toBe(503);
  } finally {
    await app.close();
    await expect(
      readFile(path.join(root, "bridge.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
