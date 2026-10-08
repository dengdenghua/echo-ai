import { expect, test } from "@playwright/test";

// Real Chromium exercise of our sandbox, CSP and bridge. Receipts are mocked
// here; authenticated receipt storage is exercised separately in test_visuals.py.
test("isolated HTML renders, interacts, blocks host access and reports late errors", async ({
  page,
}, testInfo) => {
  const reports: { status: string; detail: string }[] = [];
  await page.route("**/api/visuals/example/receipt", async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/visual-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
    <!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {InlineVisual} = await import('/src/components/workspace/messages/inline-visual.tsx');
    window.renderVisual = (code, complete = true) => root.render(React.createElement(InlineVisual, {
      title: 'Interactive example', format: 'html', code, complete,
      receipt: complete ? {kind:'echo.visual.v1', visual_id:'example', receipt_token:'browser-test-token', thread_id:'task'} : null
    }));
    const root = createRoot(document.getElementById('root'));
    window.renderMermaid = async () => {
      await import('/src/styles/globals.css');
      const {MermaidBlock} = await import('/src/components/workspace/messages/mermaid-block.tsx');
      const {I18nProvider} = await import('/src/core/i18n/context.tsx');
      const {loadTranslations} = await import('/src/core/i18n/translations.ts');
      const translations = await loadTranslations('zh-CN');
      root.render(React.createElement(I18nProvider, {initialLocale:'zh-CN', initialTranslations:translations}, React.createElement(MermaidBlock, {code:'flowchart LR; A[需求] --> B[实现] --> C[验证]'})));
    };
    window.visualReady = true;
    </script></body></html>`,
    }),
  );
  await page.goto("/visual-test");
  await page.waitForFunction(() => (window as any).visualReady);
  const code = `<h2>参数变化</h2><label>数量 <input id="amount" type="range" min="1" max="10" value="2"></label><output id="result">4</output>
    <button id="crash">Trigger error</button><span id="isolation"></span>
    <script>
      const amount = document.getElementById('amount');
      amount.addEventListener('input', () => document.getElementById('result').textContent = String(Number(amount.value) * 2));
      document.getElementById('crash').addEventListener('click', () => { throw new Error('late test error'); });
      try { parent.document.body; } catch { document.getElementById('isolation').textContent = 'Host isolated'; }
    </script>`;
  await page.evaluate((source) => (window as any).renderVisual(source), code);
  const frame = page.frameLocator('iframe[title="Interactive example"]');
  await expect(frame.getByText("Host isolated")).toBeVisible();
  await expect(page.getByText("浏览器已渲染", { exact: true })).toBeVisible();
  await frame.getByLabel("数量").fill("7");
  await expect(frame.locator("output")).toHaveText("14");
  await expect
    .poll(() => reports.map((report) => report.status))
    .toContain("rendered");
  await frame.getByText("Trigger error").click();
  await expect(page.getByText("渲染出错", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      reports.some(
        (report) =>
          report.status === "error" &&
          report.detail.includes("late test error"),
      ),
    )
    .toBe(true);

  // Streaming code must remain inert, even when its script tag is complete.
  await page.evaluate(() =>
    (window as any).renderVisual(
      '<p id="state">Static</p><script>document.getElementById("state").textContent="Executed"</script>',
      false,
    ),
  );
  await expect(frame.getByText("Static", { exact: true })).toBeVisible();
  await expect(frame.getByText("Executed", { exact: true })).toHaveCount(0);
  let externalRequests = 0;
  await page.route("https://example.invalid/**", (route) => {
    externalRequests++;
    return route.abort();
  });
  await page.evaluate(() =>
    (window as any).renderVisual(
      '<p>Network boundary</p><script>fetch("https://example.invalid/blocked").catch(() => {})</script>',
    ),
  );
  await expect(page.getByText("渲染出错", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Blocked resource");
  expect(externalRequests).toBe(0);
  await page.evaluate(() =>
    (window as any).renderVisual(
      '<img src="https://example.invalid/image.png"><iframe src="https://example.invalid/frame"></iframe><p>Resource isolation</p>',
    ),
  );
  await expect(page.getByRole("alert")).toContainText("External resources");
  expect(externalRequests).toBe(0);

  await page.evaluate(() => (window as any).renderMermaid());
  const diagram = page.locator('svg[id^="mermaid-chat-"]');
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText("需求");
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeVisible();
  const originalWidth = (await diagram.boundingBox())!.width;
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  expect((await diagram.boundingBox())!.width).toBeGreaterThan(originalWidth);
  await page.getByRole("button", { name: "适应宽度" }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "浅色", exact: true }),
  ).toBeVisible();
  for (const format of ["SVG", "PNG"]) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `diagram.${format.toLowerCase()}`,
    );
    expect(await download.failure()).toBeNull();
    await download.saveAs(
      testInfo.outputPath(`diagram.${format.toLowerCase()}`),
    );
  }
});
