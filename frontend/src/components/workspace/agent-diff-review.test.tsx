import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { AgentDiffPage, diffLineCounts } from "./agent-diff-review";
import type { DiffEntry } from "./agent-workbench-utils";

const patch =
  "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+next";
const entry: DiffEntry = {
  id: "one",
  path: "src/index.ts",
  title: "src/index.ts",
  text: patch,
  status: "done",
  created: false,
};
beforeEach(() => sessionStorage.clear());

describe("task diff review", () => {
  it("counts changed hunk lines without counting diff headers", () => {
    expect(diffLineCounts(patch)).toEqual({ added: 2, removed: 1 });
    expect(diffLineCounts("@@ -1 +1 @@\n--- comment\n+++ code")).toEqual({
      added: 1,
      removed: 1,
    });
    expect(diffLineCounts("+++ a/file\n--- b/file\n+not a patch")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("switches between real event scopes and filters by full file path", () => {
    renderWithProviders(
      <AgentDiffPage
        entries={[entry]}
        historyEntries={[
          entry,
          { ...entry, id: "two", path: "tests/index.ts" },
        ]}
      />,
    );
    expect(screen.queryByTitle("tests/index.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(screen.getByTitle("tests/index.ts")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search changed files" }),
      { target: { value: "tests/" } },
    );
    expect(screen.queryByTitle("src/index.ts")).not.toBeInTheDocument();
    expect(screen.getByTitle("tests/index.ts")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No matching files")).toBeInTheDocument();
  });

  it("retains viewed markers on reopening but invalidates them when a diff changes", () => {
    const view = renderWithProviders(
      <AgentDiffPage threadId="review-one" entries={[entry]} />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Viewed src/index.ts" }),
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    view.unmount();
    const next = renderWithProviders(
      <AgentDiffPage threadId="review-one" entries={[entry]} />,
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    next.rerender(
      <AgentDiffPage
        threadId="review-one"
        entries={[{ ...entry, text: `${patch}\n+changed again` }]}
      />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse src/index.ts" }),
    );
    expect(screen.queryByText("+changed again")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand src/index.ts" }),
    );
    expect(screen.getByText("+changed again")).toBeInTheDocument();
  });

  it("keeps the selected history scope when the responsive panel remounts", () => {
    const view = renderWithProviders(
      <AgentDiffPage
        threadId="responsive-review"
        entries={[]}
        historyEntries={[entry]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    view.unmount();
    renderWithProviders(
      <AgentDiffPage
        threadId="responsive-review"
        entries={[]}
        historyEntries={[entry]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Conversation" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("src/index.ts")).toBeInTheDocument();
  });

  it("keeps history available when the current turn has no modifications", () => {
    renderWithProviders(
      <AgentDiffPage entries={[]} historyEntries={[{ ...entry, text: "" }]} />,
    );
    expect(
      screen.getByText("No changes recorded in this scope"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    expect(
      screen.getByText("The tool did not provide a diff preview"),
    ).toBeInTheDocument();
  });
});
