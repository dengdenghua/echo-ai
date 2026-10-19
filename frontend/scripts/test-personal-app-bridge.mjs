// Real Chromium coverage for the generated SDK, opaque iframe and host bridge.
// Backend persistence/ownership is exercised separately in test_personal_app_data.py.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const entry = fileURLToPath(
  new URL("../src/core/apps/personal-app-bridge.ts", import.meta.url),
);
const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "PersonalAppBridge",
  platform: "browser",
  plugins: [
    {
      name: "isolated-host-api",
      setup(builder) {
        builder.onResolve({ filter: /^@\/core\/api\/request$/ }, () => ({
          path: "host",
          namespace: "test-host",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test-host" }, () => ({
          contents: `
      const documents = new Map();
      export const untypedApi = {
        get: async path => structuredClone(documents.get(path.split('/').at(-1)) || {value: null, revision: 0, deleted: true}),
        put: async (path, options) => {
          const key = path.split('/').at(-1), body = options.body;
          if ((documents.get(key)?.revision || 0) !== body.expected_revision) throw Object.assign(new Error('conflict'), {status:409});
          const result = {value:body.delete?null:body.value, revision:body.expected_revision+1, deleted:body.delete};
          documents.set(key, result); return structuredClone(result);
        }
      };
    `,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setContent(
    "<h1>Personal app bridge browser check</h1><main id='app'></main>",
  );
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const html = `<h2>Counter</h2><output id="value">loading</output><button id="save">Save</button><button id="task">Prepare AI task</button><output id="task-status"></output><script>
    let documentState;
    (async()=>{documentState=await echo.storage.get('state');document.querySelector('#value').textContent=String(documentState.value??0);})();
    document.querySelector('#save').onclick=async()=>{try{documentState=await echo.storage.set('state',(documentState.value??0)+1,documentState.revision);document.querySelector('#value').textContent=String(documentState.value);}catch(error){document.querySelector('#value').textContent=String(error.code);}};
    document.querySelector('#task').onclick=async()=>{const task=await echo.tasks.request({kind:'ai',prompt:'Explain the counter'});const result=await echo.tasks.wait(task.taskId);document.querySelector('#task-status').textContent=result.status+': '+result.text;};
  </script>`;
  const mount = async () =>
    page.evaluate(
      ({ content, channel }) => {
        window.cleanupApp?.();
        document.querySelector("iframe")?.remove();
        const frame = document.createElement("iframe");
        frame.setAttribute(
          "sandbox",
          "allow-scripts allow-forms allow-downloads",
        );
        document.querySelector("#app").append(frame);
        window.cleanupApp = window.PersonalAppBridge.attachPersonalAppBridge({
          frame,
          channel,
          deploymentId: "snapshot",
          permissions: ["app.storage", "task.request"],
          requestTask: async () => ({
            taskId: "counter-task",
            status: "running",
            terminal: false,
            text: "",
            route: "/workspace/realtime/counter-task",
          }),
          getTask: (taskId) => {
            if (taskId !== "counter-task") throw new Error("Unknown task");
            window.taskPolls = (window.taskPolls ?? 0) + 1;
            return {
              taskId,
              terminal: window.taskPolls > 1,
              status: window.taskPolls > 1 ? "completed" : "running",
              text: window.taskPolls > 1 ? "The counter is saved." : "",
            };
          },
        });
        frame.addEventListener("load", () =>
          frame.contentWindow.postMessage(
            { type: "echo.app.ready", channel },
            "*",
          ),
        );
        frame.srcdoc = window.PersonalAppBridge.personalAppDocument(
          content,
          channel,
        );
      },
      { content: html, channel: randomUUID() },
    );

  await mount();
  const app = page.frameLocator("iframe");
  await app.locator("#value").waitFor();
  await page.waitForFunction(
    () => document.querySelector("iframe").contentWindow !== null,
  );
  await app.getByText("Save", { exact: true }).waitFor();
  await app.locator("#value").filter({ hasText: "0" }).waitFor();
  await app.getByText("Save", { exact: true }).click();
  await app.locator("#value").filter({ hasText: "1" }).waitFor();
  await mount();
  await app.locator("#value").filter({ hasText: "1" }).waitFor();
  const frame = page.frames().find((candidate) => candidate.parentFrame());
  assert(frame);
  assert.equal(
    await frame.evaluate(() => {
      try {
        return !!parent.document;
      } catch {
        return false;
      }
    }),
    false,
  );
  assert.equal(
    await frame.evaluate(async () => {
      try {
        await fetch("https://example.invalid/private");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  await app.getByText("Prepare AI task", { exact: true }).click();
  await app
    .locator("#task-status")
    .filter({ hasText: "completed: The counter is saved." })
    .waitFor();
  assert.deepEqual(pageErrors, []);
  console.log(
    "PASS: SDK startup handshake, save/reopen, opaque-origin isolation, blocked direct network, task polling and final answer round trip",
  );
} finally {
  await browser.close();
}
