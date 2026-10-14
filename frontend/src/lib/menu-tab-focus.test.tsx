import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { moveTabFocusWithin } from "./menu-tab-focus";

function Panel() {
  return (
    <div role="menu" onKeyDown={moveTabFocusWithin}>
      <button type="button">System</button>
      <button type="button" disabled>
        Disabled
      </button>
      <div role="menuitem" tabIndex={-1}>
        Row
      </div>
      <input aria-label="Search" />
      <button type="button">Add custom model</button>
    </div>
  );
}

describe("moveTabFocusWithin", () => {
  it("cycles Tab and Shift+Tab through the panel's own controls", () => {
    render(<Panel />);
    const system = screen.getByRole("button", { name: "System" });
    const search = screen.getByRole("textbox", { name: "Search" });
    const add = screen.getByRole("button", { name: "Add custom model" });
    system.focus();

    fireEvent.keyDown(system, { key: "Tab" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "Tab" });
    expect(add).toHaveFocus();
    fireEvent.keyDown(add, { key: "Tab" });
    expect(system).toHaveFocus();
    fireEvent.keyDown(system, { key: "Tab", shiftKey: true });
    expect(add).toHaveFocus();
  });

  it("leaves other keys to the menu", () => {
    render(<Panel />);
    const system = screen.getByRole("button", { name: "System" });
    system.focus();
    const event = fireEvent.keyDown(system, { key: "ArrowDown" });
    expect(event).toBe(true);
    expect(system).toHaveFocus();
  });
});
