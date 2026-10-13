import { render } from "@testing-library/react";
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

  it("never prints the stored emoji", () => {
    const { container } = render(<ProjectIcon icon="📝" />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
