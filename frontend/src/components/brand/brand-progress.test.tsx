import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandLoadingPanel, BrandProgressLine } from "./brand-progress";

describe("ECHO loading line", () => {
  it("draws a 2px core line that stops under reduced motion", () => {
    const { container } = render(<BrandProgressLine />);
    const track = container.querySelector("[data-echo-progress]");
    expect(track).toHaveClass("h-0.5");
    const segment = track?.firstElementChild;
    expect(segment?.className).toContain("bg-[var(--echo-core)]");
    expect(segment?.className).toContain("animate-[echo-progress-slide");
    expect(segment?.className).toContain("motion-reduce:animate-none");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("announces the panel as a busy status with its label", () => {
    render(<BrandLoadingPanel label="加载中" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("加载中");
  });

  it("can keep the label for assistive tech only", () => {
    render(<BrandLoadingPanel label="加载中" hideLabel />);
    expect(screen.getByText("加载中")).toHaveClass("sr-only");
  });
});
