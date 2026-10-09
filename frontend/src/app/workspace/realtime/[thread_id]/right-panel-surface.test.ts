import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const realtimeDir = join(process.cwd(), "src/app/workspace/realtime/[thread_id]");
const readSource = (file: string) =>
  readFileSync(join(realtimeDir, file), "utf8").replace(/\r\n/g, "\n");

const pageSource = readSource("page.tsx");
// Right-panel openers/closers live in use-right-panel-navigation.ts and the
// workbench surface in realtime-secondary-panel.tsx since the page split.
const navigationSource = readSource("use-right-panel-navigation.ts");
const secondaryPanelSource = readSource("realtime-secondary-panel.tsx");
// The page plus the modules it was split into, for contracts about the
// realtime surface as a whole.
const surfaceSource = [
  "page.tsx",
  "realtime-chat-header.tsx",
  "realtime-chat-input.tsx",
  "realtime-composer-area.tsx",
  "realtime-secondary-panel.tsx",
  "realtime-stream-context.ts",
  "use-collaboration-roster.ts",
  "use-right-panel-navigation.ts",
]
  .map(readSource)
  .join("\n");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("realtime unified right panel contract", () => {
  it("routes utility views and the workbench through one secondary surface", () => {
    const layout = sourceBetween(pageSource, "<ChatPageLayout", "</ChatBox>");

    expect(layout.match(/secondaryPanel=\{/g)).toHaveLength(1);
    expect(layout).not.toContain("sidebar={");
    expect(layout).not.toContain("showSidebar=");
    expect(layout).not.toContain("sidebarWidth=");
    expect(layout).toContain('secondaryPanelWidth="min(500px, 38vw)"');
    expect(layout).toContain("onSecondaryClose={closeUnifiedRightPanel}");

    const teachRepeatIndex = layout.indexOf("showTeachRepeatPanel ?");
    const automationIndex = layout.indexOf(
      "isEchoAssistant && showAutomationPanel ?",
    );
    const researchIndex = layout.indexOf("showResearchHistory ?");
    const planIndex = layout.indexOf("showAgentPlan ?");
    const workbenchIndex = layout.indexOf("showAgentWorkbench ?");
    expect(teachRepeatIndex).toBeLessThan(automationIndex);
    expect(automationIndex).toBeLessThan(researchIndex);
    expect(researchIndex).toBeLessThan(planIndex);
    expect(planIndex).toBeLessThan(workbenchIndex);
  });

  it("dismisses only the temporary utility so the prior workbench can return", () => {
    const activePanel = sourceBetween(
      navigationSource,
      "const hasResearchPanel",
      "const openAgentPanel = useCallback",
    );
    expect(activePanel).toContain("showTeachRepeatPanel");
    expect(activePanel).toContain("isEchoAssistant && showAutomationPanel");

    const closeHandler = sourceBetween(
      navigationSource,
      "const closeUnifiedRightPanel = useCallback",
      "const closeRightPanel = closeUnifiedRightPanel",
    );
    expect(closeHandler).toContain("setShowTeachRepeatPanel(false)");
    expect(closeHandler).toContain("setShowAutomationPanel(false)");
    expect(closeHandler).toContain("setShowResearchHistory(false)");
    expect(closeHandler).toContain("setShowResearch(false)");
    expect(closeHandler).toContain("setShowAgentPlan(false)");
    expect(closeHandler).toContain("closeAgentWorkbenchPanel()");

    const planOpener = sourceBetween(
      navigationSource,
      "const openAgentPlanPanel = useCallback",
      "const openPreviewPanel = useCallback",
    );
    expect(planOpener).not.toContain("setAgentWorkbenchManuallyOpened");
    expect(planOpener).not.toContain("setAgentWorkbenchDismissed");
    expect(planOpener).not.toContain("setAgentWorkbenchTab(");
  });

  it("closes special utilities before every explicit surface switch", () => {
    const openerBoundaries = [
      ["openAgentPanel", "openArtifactsPanel"],
      ["openArtifactsPanel", "openWorkbenchArtifact"],
      ["openWorkbenchArtifact", "openFinalArtifactPanel"],
      ["openAgentPlanPanel", "openPreviewPanel"],
      ["openPreviewPanel", "openResearchPanel"],
      ["openResearchPanel", "openResearchHistoryPanel"],
      ["openResearchHistoryPanel", "closeAgentWorkbenchPanel"],
    ] as const;

    for (const [opener, next] of openerBoundaries) {
      expect(
        sourceBetween(
          navigationSource,
          `const ${opener} = useCallback`,
          `const ${next} = useCallback`,
        ),
        opener,
      ).toContain("closeSpecialUtilityPanels();");
    }

    expect(navigationSource).toContain(
      "const closeRightPanel = closeUnifiedRightPanel;",
    );
    expect(surfaceSource).toContain("onClick={toggleAutomationPanel}");
    expect(surfaceSource).toContain("openTeachRepeatPanel();");
  });

  it("keeps members in the compact header control without duplicating avatars beside the composer", () => {
    expect(surfaceSource).toContain("<TaskCollaboratorControl");
    expect(surfaceSource).not.toContain("<ConversationRosterStrip");

    const workbench = sourceBetween(
      secondaryPanelSource,
      "<AgentWorkbenchPanel",
      "onClose={closeAgentWorkbenchPanel}",
    );
    expect(workbench).toContain("showMachineScopeRail={false}");
    expect(workbench).toContain("focusedAgentId={focusedWorkbenchAgentId}");
  });

  it("keeps a group role switch in the same conversation viewpoint", () => {
    const roleSwitch = sourceBetween(
      pageSource,
      'useEvent(\n    "agent:changed"',
      "const streamOptions = useMemo",
    );
    expect(roleSwitch).toContain("isGroupConversation");
    expect(roleSwitch).toContain("groupPerspectiveAgentIds.has(name)");
    expect(roleSwitch).toContain("setGroupPerspectiveAgentId(name)");
    expect(roleSwitch).toContain("return;");
    expect(surfaceSource).toContain("const mainPerspectiveAgentId");
    expect(surfaceSource).toContain("agent_name: mainPerspectiveAgentId");
  });
});
