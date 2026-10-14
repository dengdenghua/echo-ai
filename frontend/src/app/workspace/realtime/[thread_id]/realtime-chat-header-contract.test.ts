import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const realtimeDir = join(process.cwd(), "src/app/workspace/realtime/[thread_id]");
const readSource = (file: string) =>
  readFileSync(join(realtimeDir, file), "utf8");

const pageSource = readSource("page.tsx");
// The header JSX and its member control moved to realtime-chat-header.tsx.
const headerSource = readSource("realtime-chat-header.tsx");
// The page plus the modules it was split into, for contracts that only care
// that the realtime surface as a whole keeps a behaviour.
const surfaceSource = [
  "page.tsx",
  "realtime-chat-header.tsx",
  "realtime-chat-input.tsx",
  "use-collaboration-roster.ts",
  "use-embedded-design-chat.ts",
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

describe("realtime compact chat header contract", () => {
  it("uses one responsive shell for every non-Echo conversation", () => {
    expect(pageSource).toMatch(/header=\{\s*<RealtimeChatHeader\b/);
    const header = sourceBetween(headerSource, "return (", "{projectDetachDialog}");

    expect(header).toContain("!isEchoAssistant ? (");
    expect(header).toContain("<RealtimeGroupHeaderLayout");
    expect(header).not.toContain("isGroupConversation ? (");
    expect(header).toContain(
      'className="absolute left-3 top-1/2 -translate-y-1/2 md:hidden"',
    );
    expect(pageSource).toMatch(/embeddedDesignChat\s*\? "px-3"/);
    expect(header).toMatch(
      /members=\{\s*embeddedDesignChat \? null : headerMemberSurface\s*\}/,
    );
    expect(header).toContain(
      "workbench={embeddedDesignChat ? null : headerActions}",
    );
    expect(surfaceSource).toContain('getAttribute("data-echo-design-chat")');
    expect(surfaceSource).toContain(
      "!embeddedDesignChat && selectedCollaborators.length > 0",
    );
    expect(surfaceSource).toContain(
      "embeddedDesignChat ? null : automationTarget",
    );
    expect(pageSource).toContain(
      "allToolEvents={embeddedDesignChat ? [] : allToolEvents}",
    );
  });

  it("combines the two member domains without merging their counts", () => {
    const memberSurface = sourceBetween(
      headerSource,
      "const headerMemberSurface",
      "const headerActions",
    );

    expect(memberSurface).toContain("<RealtimeChatHeaderMemberSurface");
    expect(memberSurface).toContain("aiMembers={headerMemberControl}");
    expect(headerSource).toContain("humanInviteAction={headerHumanInvite}");
  });

  it("keeps linked rooms live and counts their actual online participants", () => {
    expect(pageSource).toContain("<CollaborationRealtimeBridge");
    expect(pageSource).toContain("roomId={collabSessionQuery.data?.room_id}");
    expect(headerSource).toContain("countOnlineRoomParticipants(");
  });

  it("uses the persisted header title for overflow sharing", () => {
    const sharing = sourceBetween(
      headerSource,
      "const headerShareTitle",
      "const headerWorkbench",
    );

    expect(sharing).toContain("headerThreadTitle");
    expect(sharing).toContain("title: headerShareTitle");
  });

  it("keeps REC independent and mounts the explicit share affordance", () => {
    const actions = sourceBetween(headerSource, "const headerActions", "return (");

    expect(actions).toContain(
      "recording={recorderPluginEnabled ? headerRecorder : null}",
    );
    expect(actions).toContain("share={");
    expect(actions).toContain("<ShareMenu");
    expect(actions).toContain("iconOnly");
    expect(actions).not.toContain("RealtimeChatHeaderOverflowMenu");
  });
});
