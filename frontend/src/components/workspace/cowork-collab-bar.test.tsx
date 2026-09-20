import { renderWithProviders } from "@/test/harness";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  CoworkSearchMenu,
  SearchHitList,
} from "./cowork-collab-bar";
import type {
  CoworkSearchHit,
} from "@/core/cowork/types";

const t = {
  coworkCollab: {
    searchPlaceholder: "search",
    noResults: "No matches",
    online: "online",
    members: "Members",
    unread: (n: number) => `${n} unread`,
    kindBlackboard: "Blackboard",
    kindTask: "Task",
    kindEvent: "Event",
    kindRoomMessage: "Room message",
    kindRoomTask: "Room task",
    linkedRoom: "Linked room",
  },
} as unknown as Parameters<typeof SearchHitList>[0]["t"];

describe("SearchHitList", () => {
  const hit = (over: Partial<CoworkSearchHit>): CoworkSearchHit => ({
    kind: "blackboard",
    title: "decision",
    snippet: "ship the report",
    score: 1,
    actor: "alice",
    ts: null,
    ref: {},
    ...over,
  });

  it("shows an empty state when there are no hits", () => {
    render(<SearchHitList hits={[]} t={t} />);
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByTestId("cowork-search-results")).toBeNull();
  });

  it("renders a row per hit with its kind label", () => {
    render(
      <SearchHitList
        hits={[
          hit({ title: "decision" }),
          hit({ kind: "task", title: "scan rivals" }),
        ]}
        t={t}
      />,
    );
    expect(screen.getByTestId("cowork-search-results")).toBeTruthy();
    expect(screen.getByText("decision")).toBeTruthy();
    expect(screen.getByText("scan rivals")).toBeTruthy();
    expect(screen.getByText("Blackboard")).toBeTruthy();
    expect(screen.getByText("Task")).toBeTruthy();
  });

  it("labels linked room transcript hits distinctly", () => {
    render(
      <SearchHitList
        hits={[
          hit({ kind: "room_message", title: "Planner", snippet: "room note" }),
        ]}
        t={t}
      />,
    );
    expect(screen.getByText("Room message")).toBeTruthy();
    expect(screen.getByText("Planner")).toBeTruthy();
  });

  it("labels linked room task hits distinctly", () => {
    render(
      <SearchHitList
        hits={[hit({ kind: "room_task", title: "Draft launch plan" })]}
        t={t}
      />,
    );
    expect(screen.getByText("Room task")).toBeTruthy();
    expect(screen.getByText("Draft launch plan")).toBeTruthy();
  });
});


vi.mock("@/core/cowork/hooks", () => ({
  useCollabSession: () => ({data: {presence: [{member_id: "a", online: true}], room_messages: []}}),
  useCoworkSearch: () => ({data: {hits: []}}),
  useCoworkGroup: () => ({data: {state: {mode: "cluster", roster: [{member_id: "a"}, {member_id: "b"}], takeover_ids: []}}}),
  useMarkCoworkRead: () => ({mutate: vi.fn()}),
}));

it("retains workbench search without duplicate mode or member controls", () => {
  renderWithProviders(<CoworkSearchMenu threadId="thread-group" />, {locale: "zh-CN"});
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByTestId("cowork-search-trigger"), {button: 0, ctrlKey: false, pointerType: "mouse"});
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.queryByTestId("cowork-presence")).not.toBeInTheDocument();
  expect(screen.queryByTestId("cowork-mode-selector-trigger")).not.toBeInTheDocument();
  expect(screen.queryByText(/在线/)).not.toBeInTheDocument();
});
