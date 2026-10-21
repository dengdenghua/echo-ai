import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness";

import {
  AudioCard,
  VideoCard,
  mediaFromFence,
} from "./media-cards";
import { MarkdownImage } from "./markdown-image";

describe("MarkdownImage", () => {
  it("renders the image and opens a zoom overlay on click", () => {
    const { container } = renderWithProviders(
      <MarkdownImage src="https://example.com/a.png" alt="架构图" />,
      { locale: "zh-CN" },
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("架构图");

    // The shared message-image preview expands before opening the lightbox.
    const thumbnail = img?.closest("button");
    if (!thumbnail) throw new Error("Missing image preview button");
    fireEvent.click(thumbnail);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭", exact: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a failure chip when the image errors", () => {
    const { container } = renderWithProviders(
      <MarkdownImage src="https://example.com/broken.png" alt="挂了" />,
      { locale: "zh-CN" },
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(screen.getByText(/图片读取失败/)).not.toBeNull();
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
