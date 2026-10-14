import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./diff-viewer";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

describe("real diff viewer", () => {
  it("renders deletions and insertions without editable merge controls in history", async () => {
    const view = render(<DiffViewer oldValue={"<h1>Current</h1>\n"} newValue={"<h1>Previous</h1>\n"} readOnly />);
    await waitFor(() => expect(view.container.querySelector(".cm-deletedChunk")).toHaveTextContent("Current"));
    expect(view.container.querySelector(".cm-content")).toHaveTextContent("Previous");
    expect(view.container.querySelector(".cm-content")).toHaveAttribute("contenteditable", "false");
    expect(view.container.querySelector(".cm-mergeControls")).toBeNull();
    view.rerender(<DiffViewer oldValue={"<h1>Latest</h1>\n"} newValue={"<h1>Previous</h1>\n"} readOnly />);
    await waitFor(() => expect(view.container.querySelector(".cm-deletedChunk")).toHaveTextContent("Latest"));
  });
});
