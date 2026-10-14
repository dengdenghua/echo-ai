import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageContextMenu, MessageMoreActions } from "./message-action-menu";

describe("message action menus", () => {
  it("opens on right click and runs the chosen action", () => {
    const copy = vi.fn();
    render(
      <MessageContextMenu
        actions={[{ id: "copy", label: "Copy", icon: null, onSelect: copy }]}
      >
        <div>Answer text</div>
      </MessageContextMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Answer text"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("preserves native context menus for links", () => {
    render(
      <MessageContextMenu
        actions={[{ id: "copy", label: "Copy", icon: null, onSelect: vi.fn() }]}
      >
        <div>
          <a href="https://example.com">Source</a>
        </div>
      </MessageContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("Source"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("provides a keyboard-accessible more menu", () => {
    const edit = vi.fn();
    render(
      <MessageMoreActions
        label="More"
        actions={[{ id: "edit", label: "Edit", icon: null, onSelect: edit }]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
