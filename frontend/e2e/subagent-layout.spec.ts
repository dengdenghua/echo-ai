import { expect, test } from "@playwright/test";

for (const width of [320, 400, 640]) {
  test(`subagent sidebar fits ${width}px and keeps actions usable`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/subagent-layout-test", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const {renderPanel} = await import('/e2e/fixtures/subagent-layout.tsx');
        window.renderPanel = renderPanel;
        renderPanel(${width});
      </script></body></html>`,
      }),
    );
    await page.goto("/subagent-layout-test");
    const panel = page.getByTestId("panel");
    await expect(panel.getByText("验证结果", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(panel.locator("pre")).toContainText("report.ts");
    await panel.screenshot({ path: testInfo.outputPath("sidebar.png") });
    const bounds = (await panel.boundingBox())!;
    for (const control of await panel.locator("button,input").all()) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
    }
    for (const label of ["分享到群聊", "私聊", "返回总览"]) {
      const button = panel.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeLessThanOrEqual(36);
    }
    await expect(panel.getByRole("button", { name: "更多操作" })).toHaveCount(0);
    const input = panel.getByRole("textbox");
    expect((await input.boundingBox())!.width).toBeGreaterThan(180);
    await input.fill("继续检查共享文件");
    await panel.getByRole("button", { name: "私聊", exact: true }).click();
    await expect(input).toHaveValue("");
    await page.evaluate(
      (width) => (window as any).renderPanel(width, true),
      width,
    );
    await expect(panel.getByText("验证结果", { exact: true })).toHaveCount(0);
    await expect(panel.getByTestId("live-exec-stream")).toContainText(
      "已读取协作配置。",
    );
    await expect(
      panel.getByTestId("process-timeline-event-thinking"),
    ).toHaveCount(0);
    await expect
      .poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
    await panel.getByRole("button", { name: "返回总览", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-main-opened",
      "true",
    );
    expect(errors).toEqual([]);
  });
}
