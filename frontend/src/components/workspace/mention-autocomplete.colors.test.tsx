import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MentionBadge, type MentionCategory } from "./mention-autocomplete";

// ECHO: mention kinds are told apart by icon and label, never by colour, and
// breach red / nano violet stay reserved for real states.
describe("mention kind icons", () => {
  it.each<MentionCategory>([
    "pack",
    "agent",
    "plugin",
    "skill",
    "file",
    "session",
  ])("draws the %s icon in the neutral muted ink", (type) => {
    const { container } = render(<MentionBadge type={type} reference="ref" />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("text-muted-foreground");
    expect(icon?.getAttribute("class")).not.toMatch(
      /chart-|text-(info|success|warning)/,
    );
  });
});
