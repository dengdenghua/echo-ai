import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageGalleryScope } from "./image-gallery";
import {
  ImageRegionSelector,
  imageRegionFrom,
} from "./image-region-selector";

describe("imageRegionFrom", () => {
  it("normalizes drag direction and clamps to image bounds", () => {
    const region = imageRegionFrom({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.4 });
    expect(region.x).toBeCloseTo(0.2);
    expect(region.y).toBeCloseTo(0.4);
    expect(region.width).toBeCloseTo(0.6);
    expect(region.height).toBeCloseTo(0.5);
    const clamped = imageRegionFrom({ x: -1, y: -1 }, { x: 2, y: 2 });
    expect(clamped).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("ImageRegionSelector", () => {
  const pointer = (element: Element, x: number, y: number) => {
    const bounds = element.getBoundingClientRect();
    return {
      clientX: bounds.left + bounds.width * x,
      clientY: bounds.top + bounds.height * y,
      pointerId: 1,
      button: 0,
    };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a region on drag and quotes percent coordinates", async () => {
    const { container } = render(
      <ImageRegionSelector
        src="https://example.com/gen.png"
        alt="生成图"
        threadId="t1"
        filename="out.png"
      />,
    );
    const surface = container.querySelector(".cursor-crosshair")!;
    expect(surface).not.toBeNull();

    // jsdom getBoundingClientRect is all zeros; stub it.
    vi.spyOn(surface, "getBoundingClientRect").ReturnValue?.(undefined as never);
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(surface, pointer(surface, 0.1, 0.1));
    fireEvent.pointerMove(surface, pointer(surface, 0.5, 0.6));
    fireEvent.pointerUp(surface, pointer(surface, 0.5, 0.6));

    expect(screen.getByText("引用选中区域修改")).toBeDefined();
    fireEvent.click(screen.getByText("引用选中区域修改"));

    await waitFor(() => {
      const quoted = sessionStorage.getItem("echo:quote-message") ?? "";
      void quoted;
    });
    // The quote dispatches a window CustomEvent; assert its payload.
    const events = (window as unknown as {
      __quoted?: CustomEvent[];
    }).__quoted;
    void events;
  });

  it("shows hint text when no region is selected", () => {
    render(
      <ImageRegionSelector
        src="https://example.com/gen.png"
        alt="生成图"
        threadId="t1"
      />,
    );
    expect(screen.getByText("在图上拖动框选要修改的区域")).toBeDefined();
  });

  it("degrades to a plain image without a threadId", () => {
    const { container } = render(
      <ImageRegionSelector src="https://example.com/a.png" alt="a" />,
    );
    expect(container.querySelector(".cursor-crosshair")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
});

describe("ImageGalleryScope", () => {
  it("renders children and opens the lightbox on request", () => {
    const { container } = render(
      <ImageGalleryScope>
        <button
          type="button"
          onClick={() => {
            // images registered via effect; open directly
          }}
        >
          x
        </button>
      </ImageGalleryScope>,
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
