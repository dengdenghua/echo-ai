import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { imageRegion, MediaReference } from "./media-reference";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("quotes the dragged region relative to image bounds", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const quote = vi.fn();
  render(
    <MediaReference
      url="blob:preview"
      type="image/png"
      path="design.png"
      zh
      onQuote={quote}
    />,
  );
  const area = screen.getByRole("img").parentElement!;
  area.setPointerCapture = vi.fn();
  area.hasPointerCapture = vi.fn().mockReturnValue(false);
  vi.spyOn(area, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 400,
    height: 200,
  } as DOMRect);
  fireEvent.pointerDown(area, { button: 0, clientX: 400, clientY: 250 });
  fireEvent.pointerMove(area, { clientX: 200, clientY: 150 });
  fireEvent.pointerUp(area, { clientX: 200, clientY: 150 });
  expect(quote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("引用选中区域"));
  expect(quote).toHaveBeenCalledWith(
    expect.stringContaining("x=25.00%, y=25.00%, width=50.00%, height=50.00%"),
  );
  fireEvent.click(screen.getByText("清除框选"));
  expect(screen.getByText("引用图片")).toBeInTheDocument();
});
it("normalizes reverse drags and clips selections to image bounds", () => {
  expect(imageRegion({ x: 1.2, y: 0.8 }, { x: -0.2, y: 0.2 })).toEqual({
    x: 0,
    y: 0.2,
    width: 1,
    height: 0.6000000000000001,
  });
});
it("quotes an image only on explicit action", () => {
  const quote = vi.fn();
  render(
    <MediaReference
      url="blob:preview"
      type="image/png"
      path="D:/project/design.png"
      zh
      onQuote={quote}
    />,
  );
  expect(quote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("引用图片"));
  expect(quote).toHaveBeenCalledWith("图片：D:/project/design.png\n整张图片");
});
it("rejects invalid PDF pages and quotes the explicitly chosen page", () => {
  const quote = vi.fn();
  render(
    <MediaReference
      url="blob:preview"
      type="application/pdf"
      path="D:/project/design.pdf"
      zh
      onQuote={quote}
    />,
  );
  fireEvent.change(screen.getByLabelText("引用页码"), {
    target: { value: "0" },
  });
  expect(screen.getByText("引用此页")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("引用页码"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByText("定位"));
  expect(screen.getByTitle("D:/project/design.pdf")).toHaveAttribute(
    "src",
    "blob:preview#page=4",
  );
  fireEvent.click(screen.getByText("引用此页"));
  expect(quote).toHaveBeenCalledWith(
    "PDF：D:/project/design.pdf\n引用第 4 页（用户指定）",
  );
});
