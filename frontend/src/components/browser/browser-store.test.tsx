import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/harness";

import {
  BrowserStoreProvider,
  browserReducer,
  persistableState,
  useBrowserStore,
  type BrowserAction,
  type BrowserState,
  type BrowserTab,
} from "./browser-store";

function StoreHarness() {
  const { state, activeTab, openTab, closeTab, restoreClosedTab } =
    useBrowserStore();
  return (
    <div>
      <div data-testid="open-count">{state.tabs.length}</div>
      <div data-testid="closed-count">{state.closedTabs.length}</div>
      <div data-testid="active-url">{activeTab?.url}</div>
      <div data-testid="active-loading">{String(activeTab?.isLoading)}</div>
      <button onClick={() => openTab("https://example.com/path")}>open</button>
      <button onClick={() => activeTab && closeTab(activeTab.id)}>close</button>
      <button onClick={() => restoreClosedTab()}>restore</button>
      <button
        onClick={() =>
          openTab("https://example.com/task", {
            taskPreview: { threadId: "task-1", sessionId: "session-1" },
          })
        }
      >
        task
      </button>
      <div data-testid="task-session">{activeTab?.taskPreview?.sessionId}</div>
    </div>
  );
}

describe("browser tab recovery", () => {
  beforeEach(() => window.localStorage.clear());

  it("reuses a task session tab and preserves its identity after closing and restoring", () => {
    renderWithProviders(
      <BrowserStoreProvider>
        <StoreHarness />
      </BrowserStoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "task", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "open", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "task", exact: true }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("3");
    expect(screen.getByTestId("task-session")).toHaveTextContent("session-1");
    fireEvent.click(screen.getByRole("button", { name: "close", exact: true }));
    fireEvent.click(
      screen.getByRole("button", { name: "restore", exact: true }),
    );
    expect(screen.getByTestId("task-session")).toHaveTextContent("session-1");
  });

  it("keeps recently closed tabs and restores the latest one", () => {
    renderWithProviders(
      <BrowserStoreProvider>
        <StoreHarness />
      </BrowserStoreProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "https://example.com/path",
    );

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
    expect(screen.getByTestId("closed-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "restore" }));
    expect(screen.getByTestId("open-count")).toHaveTextContent("2");
    expect(screen.getByTestId("closed-count")).toHaveTextContent("0");
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "https://example.com/path",
    );
  });

  it("loads a previous unclean session without resuming a loading spinner", () => {
    window.localStorage.setItem(
      "echo:browser-state",
      JSON.stringify({
        tabs: [
          {
            id: "saved-tab",
            url: "https://example.com/saved",
            title: "Saved",
            isLoading: true,
            device: "desktop",
          },
        ],
        closedTabs: [],
        activeId: "saved-tab",
        copilotOpen: false,
        copilotWidth: 380,
        homeSeeded: true,
      }),
    );

    renderWithProviders(
      <BrowserStoreProvider>
        <StoreHarness />
      </BrowserStoreProvider>,
    );

    expect(screen.getByTestId("open-count")).toHaveTextContent("1");
    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "https://example.com/saved",
    );
    expect(screen.getByTestId("active-loading")).toHaveTextContent("false");
  });
});

describe("tab groups, split view and private tabs", () => {
  const tab = (id: string, extra: Partial<BrowserTab> = {}): BrowserTab => ({
    id,
    url: `https://${id}.test/`,
    title: id,
    isLoading: false,
    device: "desktop",
    ...extra,
  });
  const initial = (
    tabs: BrowserTab[],
    activeId = tabs[0]!.id,
  ): BrowserState => ({
    tabs,
    closedTabs: [],
    activeId,
    groups: [],
    split: null,
    copilotOpen: false,
    copilotWidth: 380,
    homeSeeded: true,
  });
  const run = (state: BrowserState, ...actions: BrowserAction[]) =>
    actions.reduce(browserReducer, state);
  const order = (state: BrowserState) =>
    state.tabs.map((t) => (t.groupId ? `${t.id}*` : t.id)).join(" ");

  it("groups tabs next to each other and drops empty groups", () => {
    let state = run(
      initial([tab("a"), tab("b"), tab("c")]),
      { type: "ADD_TO_GROUP", id: "a", newGroupId: "g" },
      { type: "ADD_TO_GROUP", id: "c", groupId: "g" },
    );
    expect(order(state)).toBe("a* c* b");
    expect(state.groups).toHaveLength(1);
    state = run(state, { type: "REMOVE_FROM_GROUP", id: "a" });
    expect(order(state)).toBe("c* a b");
    state = run(state, { type: "REMOVE_FROM_GROUP", id: "c" });
    expect(state.groups).toEqual([]);
  });

  it("collapsing moves focus out; activating a hidden tab expands it", () => {
    let state = run(
      initial([tab("a"), tab("b")]),
      { type: "ADD_TO_GROUP", id: "a", newGroupId: "g" },
      { type: "UPDATE_GROUP", groupId: "g", patch: { collapsed: true } },
    );
    expect(state.activeId).toBe("b");
    expect(state.groups[0]!.collapsed).toBe(true);
    state = run(state, { type: "ACTIVATE_TAB", id: "a" });
    expect(state.groups[0]!.collapsed).toBe(false);
  });

  it("closes a whole group into recently closed tabs", () => {
    const state = run(
      initial([tab("a"), tab("b"), tab("c")]),
      { type: "ADD_TO_GROUP", id: "a", newGroupId: "g" },
      { type: "ADD_TO_GROUP", id: "b", groupId: "g" },
      { type: "CLOSE_GROUP", groupId: "g" },
    );
    expect(order(state)).toBe("c");
    expect(state.activeId).toBe("c");
    expect(state.closedTabs.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(state.groups).toEqual([]);
  });

  it("ends the split when one of its tabs closes", () => {
    let state = run(initial([tab("a"), tab("b"), tab("c")], "c"), {
      type: "SET_SPLIT",
      split: { leftId: "a", rightId: "b", ratio: 0.5 },
    });
    expect(state.split).toEqual({ leftId: "a", rightId: "b", ratio: 0.5 });
    expect(state.activeId).toBe("a");
    state = run(state, { type: "CLOSE_TAB", id: "b" });
    expect(state.split).toBe(null);
  });

  it("never persists private tabs", () => {
    const state = run(
      initial([tab("a"), tab("p", { private: true })], "p"),
      { type: "CLOSE_TAB", id: "p" },
      { type: "OPEN_TAB", url: "https://q.test/", patch: { private: true } },
    );
    const saved = persistableState(state);
    expect(saved.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(saved.closedTabs).toEqual([]);
    expect(saved.activeId).toBe("a");
  });
});
