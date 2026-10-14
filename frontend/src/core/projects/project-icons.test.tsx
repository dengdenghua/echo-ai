import { render } from "@testing-library/react";
import { SquareKanbanIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { ProjectIcon, projectIconId } from "./project-icons";

describe("project icons", () => {
  it("keeps icon ids and maps emoji stored by older versions", () => {
    expect(projectIconId("plane")).toBe("plane");
    expect(projectIconId("📈")).toBe("trending-up");
    expect(projectIconId(" ✍️ ")).toBe("pen-line");
    expect(projectIconId("✈")).toBe("plane");
    expect(projectIconId("📁")).toBe("folder");
  });

  it("falls back to the folder for unknown or missing icons", () => {
    expect(projectIconId("🦄")).toBe("folder");
    expect(projectIconId(undefined)).toBe("folder");
    expect(projectIconId("")).toBe("folder");
  });

  it("tags the drawn icon with its id and keeps a caller fallback for none", () => {
    const { container, rerender } = render(<ProjectIcon icon="plane" />);
    expect(
      container.querySelector('[data-project-icon="plane"]'),
    ).not.toBeNull();

    rerender(<ProjectIcon icon={null} fallback={SquareKanbanIcon} />);
    expect(container.querySelector("[data-project-icon]")).toBeNull();
    expect(container.querySelector(".lucide-square-kanban")).not.toBeNull();

    // A stored but unknown icon is still a project icon: the folder.
    rerender(<ProjectIcon icon="🦄" fallback={SquareKanbanIcon} />);
    expect(
      container.querySelector('[data-project-icon="folder"]'),
    ).not.toBeNull();
  });

  it("never prints the stored emoji", () => {
    const { container } = render(<ProjectIcon icon="📝" />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
