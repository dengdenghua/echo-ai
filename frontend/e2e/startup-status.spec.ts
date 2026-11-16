import { expect, test } from "@playwright/test";

test("slow local startup stays neutral; confirmed child exit can be restarted", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("startup fixture:", error.message);
  });
  await page.route("**/startup-status-test", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      await import('/e2e/fixtures/login-service-status.jsx');
    </script></body></html>`,
    }),
  );
  await page.goto("/startup-status-test");
  await expect(page.getByRole("status")).toContainText("正在启动 ECHO AI", {
    timeout: 60000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("startup-wait-desktop.png") });
  await page.setViewportSize({ width: 430, height: 430 });
  await page.screenshot({ path: info.outputPath("startup-wait-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate("window.setBackendState('failed')");
  await expect(page.getByRole("alert")).toContainText("未能继续运行");
  await page.getByRole("button", { name: "重新启动服务" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("正在启动 ECHO AI");
  expect(errors).toEqual([]);
});
