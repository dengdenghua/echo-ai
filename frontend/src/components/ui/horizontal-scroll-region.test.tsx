import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { horizontalScrollKey } from "./horizontal-scroll-region";

it("uses Home and End within a wide region without navigating the transcript", () => {
  const parentKey = vi.fn();
  render(
    <div onKeyDown={parentKey}>
      <div role="region" tabIndex={0} onKeyDown={horizontalScrollKey}>
        wide table
      </div>
    </div>,
  );
  const viewport = screen.getByRole("region");
  Object.defineProperties(viewport, {
    clientWidth: { value: 300 },
    scrollWidth: { value: 1100 },
  });
  fireEvent.keyDown(viewport, { key: "End" });
  expect(viewport.scrollLeft).toBe(800);
  fireEvent.keyDown(viewport, { key: "Home" });
  expect(viewport.scrollLeft).toBe(0);
  expect(parentKey).not.toHaveBeenCalled();
  fireEvent.keyDown(viewport, { key: "End", ctrlKey: true });
  expect(parentKey).toHaveBeenCalledOnce();
});
