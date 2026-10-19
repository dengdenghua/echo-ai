import { expect, test } from "@playwright/test";

interface LayoutTestWindow extends Window {
  ready: boolean;
  renderPartial: (value: string) => void;
}

test("failed messages scroll into history after a successful retry", async ({
  page,
}, testInfo) => {
  await page.route("**/retry-layout-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body><main id="root"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      await import('/e2e/fixtures/retry-layout.tsx');
    </script></body></html>`,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/retry-layout-test");
  await page.waitForFunction(() => (window as LayoutTestWindow).ready);
  await expect(page.getByTestId("retry-pending-message")).toHaveCount(2);
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() =>
      (
        window as unknown as { renderRetry: (stage: number) => void }
      ).renderRetry(1),
    );
    await expect(page.getByTestId("retry-pending-message")).toHaveCount(1);
    expect(
      await page
        .locator("[data-qa-message]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-qa-message")),
        ),
    ).toEqual(["request", "answer", "failed", "retry", "result"]);
    const failure = page.locator('[data-qa-message="failed"]');
    const top = (await failure.boundingBox())!.y;
    await page.evaluate(() =>
      (
        window as unknown as { renderRetry: (stage: number) => void }
      ).renderRetry(2),
    );
    await expect
      .poll(
        async () =>
          (await page.locator('[data-qa-message="result"]').innerText()).match(
            /重试成功/g,
          )?.length,
      )
      .toBe(35);
    expect((await failure.boundingBox())!.y).toBeCloseTo(top, 0);
    await page.locator("#scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect((await failure.boundingBox())!.y).toBeLessThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("retry-history-" + width + ".png"),
    });
    await page.locator("#scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(failure).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("retry-layout-" + width + ".png"),
    });
  }
  expect(errors).toEqual([]);
});

test("streamed tool details decode line breaks and fit desktop and narrow windows", async ({
  page,
}, testInfo) => {
  await page.route("**/stream-output-layout-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:760px;margin:24px auto;padding:0 16px"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {ProcessStepDetail,readableToolOutput}=await import('/src/components/workspace/messages/process-step-detail.tsx');
      await import('/src/styles/globals.css');
      const root=createRoot(document.getElementById('root'));
      window.renderPartial=value=>root.render(React.createElement(ProcessStepDetail,{text:readableToolOutput(value)}));
      window.ready=true;
    </script></body></html>`,
    }),
  );
  await page.goto("/stream-output-layout-test");
  await page.waitForFunction(() => (window as LayoutTestWindow).ready);
  const code = [
    "import json",
    "print('session open')",
    "result = validate_native_model()",
    "# " + "长路径与输出说明".repeat(90),
    "print('validation finished')",
  ].join("\n");
  const argument = JSON.stringify({
    path: "run_native_validation.py",
    content: code,
  });
  for (const partial of [
    argument.slice(0, 100),
    argument.slice(0, -2),
    argument,
  ]) {
    await page.evaluate(
      (value) => (window as LayoutTestWindow).renderPartial(value),
      partial,
    );
    await expect(page.getByTestId("process-step-detail")).toContainText(
      "import json",
    );
  }
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 850 });
    const detail = page.getByTestId("process-step-detail");
    await expect(detail).toHaveText(code);
    expect(
      await detail.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`stream-output-${width}.png`),
      fullPage: true,
    });
  }
});
