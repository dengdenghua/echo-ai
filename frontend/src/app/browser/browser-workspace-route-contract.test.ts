import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const routerSource = readSource("src/router.tsx");
const browserSource = readSource("src/app/browser/page.tsx");
const switchSource = readSource(
  "src/components/workspace/workspace-surface-switch.tsx",
);
const routingSource = readSource("src/core/workspace/sidebar-routing.ts");

describe("AI browser mode ownership", () => {
  it("keeps the complete browser at the top level and previews in workbench", () => {
    expect(routerSource).not.toContain("function LegacyBrowserRedirect()");
    expect(routerSource).toContain(
      '<Route path="/browser" element={<TopBrowserPage />} />',
    );
    expect(routerSource).toContain(
      'element={<Navigate to="/browser" replace />}',
    );
    expect(switchSource).toContain("to: BROWSER_WORKSPACE_ROUTE");
    expect(routingSource).toContain(
      'export const BROWSER_WORKSPACE_ROUTE = "/browser"',
    );
  });

  it("renders desktop browsing and retains thread-owned task previews", () => {
    expect(browserSource).toContain("function BrowserShell()");
    expect(browserSource).toContain("<BrowserShell />");
    expect(browserSource).toContain('WorkspaceSurfaceHeader active="browser"');
    expect(browserSource).toContain("<WebviewTab");
    expect(browserSource).toContain("tab.taskPreview ? (");
    expect(browserSource).toContain("threadId={tab.taskPreview.threadId}");
    expect(browserSource).toContain(
      "sharedSessionId={tab.taskPreview.sessionId}",
    );
  });
});
