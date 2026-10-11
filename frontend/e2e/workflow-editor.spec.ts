import { expect, test } from "./fixtures";

/**
 * E2E: Workflow Editor.
 *
 * Prerequisites: backend on :8000, frontend on :3000.
 */

test.describe("Legacy workflow route", () => {
  test("workflows route redirects to Hub skills", async ({
    authedPage: page,
  }) => {
    await page.goto("/#/workspace/workflows");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(
      /#\/workspace\/agents\?surface=chat&tab=skills/,
    );
    await expect(
      page.getByRole("tab", { name: /^(Skills|技能)$/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("searchbox").first()).toBeVisible();
  });
});
