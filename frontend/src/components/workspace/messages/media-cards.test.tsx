import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AudioCard,
  VideoCard,
  mediaFromFence,
} from "./media-cards";
import { MarkdownImage } from "./markdown-image";

describe("MarkdownImage", () => {
  it("renders the image and opens a zoom overlay on click", () => {
    const { container } = render(
      <MarkdownImage src="https://example.com/a.png" alt="架构图" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("架构图");

    fireEvent.click(container.querySelector("span[aria-hidden]") ?? container);
    // Click on the wrapper span opens the lightbox (role=dialog).
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a failure chip when the image errors", () => {
    const { container } = render(
      <MarkdownImage src="https://example.com/broken.png" alt="挂了" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(screen.getByText(/图片加载失败/)).not.toBeNull();
  });
});

describe("mediaFromFence", () => {
  it("classifies explicit video/audio fences", () => {
    expect(
      mediaFromFence("https://x.com/a.mp4", "video"),
    ).toEqual({ kind: "video", src: "https://x.com/a.mp4" });
    expect(mediaFromFence("https://x.com/a.mp3\n录音", "audio")).toEqual({
      kind: "audio",
      src: "https://x.com/a.mp3",
      filename: "录音",
    });
  });

  it("classifies bare media URLs by extension", () => {
    expect(mediaFromFence("https://x.com/b.webm", "")).toEqual({
      kind: "video",
      src: "https://x.com/b.webm",
    });
    expect(mediaFromFence("<https://x.com/c.flac>", "text")).toEqual({
      kind: "audio",
      src: "https://x.com/c.flac",
    });
  });

  it("ignores non-media fences", () => {
    expect(mediaFromFence("const a = 1;", "javascript")).toBeNull();
    expect(mediaFromFence("https://x.com/page", "")).toBeNull();
    expect(mediaFromFence("", "video")).toBeNull();
  });
});

describe("media cards", () => {
  it("VideoCard renders a native player with a download link", () => {
    render(
      <VideoCard src="https://x.com/a.mp4" filename="演示.mp4" />,
    );
    expect(screen.getByText("演示.mp4")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "下载" }).getAttribute("href"),
    ).toBe("https://x.com/a.mp4");
  });

  it("cards render nothing without a source", () => {
    const { container } = render(<VideoCard filename="x.mp4" />);
    expect(container.querySelector("section")).toBeNull();
    const audio = render(<AudioCard />).container;
    expect(audio.querySelector("section")).toBeNull();
  });
});
