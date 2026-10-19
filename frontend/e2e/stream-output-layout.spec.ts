import { expect, test } from "@playwright/test";

interface LayoutTestWindow extends Window {
  ready: boolean;
  renderPartial: (value: string) => void;
}

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
