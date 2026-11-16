import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageImage } from "./routed-message-link";
import {
  OPEN_ARTIFACT_EVENT,
  type OpenArtifactDetail,
} from "@/core/artifacts/open-artifact";
import { renderWithProviders } from "@/test/harness";
import { RoutedMessageLink } from "./message-list-item";

vi.mock("@/core/auth/api", () => ({
  getToken: () => "png-test-token",
  authHeaders: () => ({ Authorization: "Bearer png-test-token" }),
}));
afterEach(() => vi.unstubAllGlobals());

it.each([
  "output/final/bicycle_preview.png",
  "C:/Users/owner/AppData/Roaming/echo-frontend/data/workspaces/thread-png/output/final/bicycle_preview.png",
  "workspace-output:final:bicycle_preview.png",
])("loads the current thread image with authentication: %s", async (src) => {
  const fetchImage = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["PNG"], { type: "image/png" }),
  });
  const revoke = vi.fn();
  vi.stubGlobal("fetch", fetchImage);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:protected-png");
      static revokeObjectURL = revoke;
    },
  );
  const { unmount } = renderWithProviders(
    <MessageImage
      src={src}
      threadId="thread-png"
      alt="自行车预览"
      width={800}
    />,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(fetchImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  await waitFor(() =>
    // The thumbnail and the circle-to-edit selector both render the image;
    // every copy must carry the authenticated blob URL.
    expect(screen.getAllByAltText("自行车预览")[0]).toHaveAttribute(
      "src",
      "blob:protected-png",
    ),
  );
  expect(fetchImage).toHaveBeenCalledWith(
    expect.stringContaining(
      "/api/threads/thread-png/outputs/bicycle_preview.png?area=final",
    ),
    expect.objectContaining({
      headers: { Authorization: "Bearer png-test-token" },
    }),
  );
  expect(screen.getAllByAltText("自行车预览")[0]).toHaveAttribute(
    "width",
    "800",
  );
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:protected-png");
});

it.each([
  "https://images.example.test/preview.png",
  "https://images.example.test/workspaces/thread-png/output/final/preview.png",
])(
  "leaves remote images public and never sends Echo credentials to %s",
  (src) => {
    const fetchImage = vi.fn();
    vi.stubGlobal("fetch", fetchImage);
    renderWithProviders(
      <MessageImage src={src} threadId="thread-png" alt="remote" />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getAllByAltText("remote")[0]).toHaveAttribute("src", src);
    expect(fetchImage).not.toHaveBeenCalled();
  },
);

it("opens a full image only after expanding and clicking the thumbnail", () => {
  renderWithProviders(
    <MessageImage src="data:image/png;base64,AA==" threadId="t" alt="render" />,
  );
  const toggle = screen.getByRole("button", { expanded: false });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  // Thumbnail + circle-to-edit selector both render an img; the first is
  // the h-20 thumbnail.
  expect(screen.getAllByRole("img")[0]).toHaveClass("h-20", "w-20");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("img")[0]!.closest("button")!);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(toggle);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("opens a generated Office link in the current artifact workbench", () => {
  let opened: OpenArtifactDetail | null = null;
  const handleOpen = (event: Event) => {
    opened = (event as CustomEvent<OpenArtifactDetail>).detail;
    event.preventDefault();
  };
  window.addEventListener(OPEN_ARTIFACT_EVENT, handleOpen);
  renderWithProviders(
    <RoutedMessageLink href="out/deck.pptx">下载 PPT</RoutedMessageLink>,
  );

  fireEvent.click(screen.getByRole("button", { name: "下载 PPT" }));

  expect(opened).toEqual({ path: "workspace-output:final:out/deck.pptx" });
  window.removeEventListener(OPEN_ARTIFACT_EVENT, handleOpen);
});

it("renders a generated video link as an inline player", () => {
  const href =
    "https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/task_demo.mp4";

  renderWithProviders(
    <RoutedMessageLink href={href}>点击观看视频</RoutedMessageLink>,
  );

  const player = screen.getByLabelText("点击观看视频");
  expect(player).toBeInstanceOf(HTMLVideoElement);
  expect(player).toHaveAttribute("src", href);
  expect(player).toHaveAttribute("controls");
  expect(player).toHaveAttribute("playsinline");
  expect(screen.getByRole("link", { name: "点击观看视频" })).toHaveAttribute(
    "href",
    href,
  );
});

it("labels a video link without plain text in the UI language", () => {
  renderWithProviders(
    <RoutedMessageLink href="https://example.test/videos/demo.mp4">
      <strong>demo</strong>
    </RoutedMessageLink>,
    { locale: "ja-JP" },
  );

  expect(screen.getByLabelText("動画プレビュー")).toBeInstanceOf(
    HTMLVideoElement,
  );
});
