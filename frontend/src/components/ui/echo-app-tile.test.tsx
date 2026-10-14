import { render } from "@testing-library/react";
import { FolderIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EchoAppTile } from "./echo-app-tile";

describe("<EchoAppTile />", () => {
  it("draws a graphite tile with a line icon and no per-app colour", () => {
    const { container } = render(
      <EchoAppTile icon={FolderIcon} className="size-12 rounded-2xl" />,
    );
    const tile = container.querySelector("[data-slot='echo-app-tile']");
    expect(tile).toHaveAttribute("data-echo-theme", "graphite");
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveClass("bg-card", "text-foreground", "size-12");
    expect(tile?.className).not.toMatch(/gradient|from-|to-/);
    expect(tile?.querySelector("svg")).toHaveAttribute("stroke-width", "1.5");
  });

  it("lights the core accent only when active", () => {
    const { container, rerender } = render(<EchoAppTile icon={FolderIcon} />);
    const tile = () => container.querySelector("[data-slot='echo-app-tile']");
    expect(tile()).not.toHaveAttribute("data-active");
    rerender(<EchoAppTile icon={FolderIcon} active />);
    expect(tile()).toHaveAttribute("data-active", "");
  });
});
