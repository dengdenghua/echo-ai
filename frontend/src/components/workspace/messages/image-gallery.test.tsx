import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ImageGalleryScope } from "./image-gallery";
import { MessageImage, RoutedMessageLink } from "./routed-message-link";
import { FileReferenceScope } from "@/core/navigation/file-reference";

vi.mock("@/core/auth/api", () => ({
  getToken: () => "image-test",
  authHeaders: () => ({ Authorization: "Bearer image-test" }),
}));
afterEach(() => vi.unstubAllGlobals());

it("opens the clicked image in its own answer, with no cross-answer gallery state", () => {
  const a = "data:image/png;base64,AA==",
    b = "data:image/png;base64,BB==",
    c = "data:image/png;base64,CC==";
  renderWithProviders(
    <>
      <ImageGalleryScope>
        <MessageImage src={a} alt="first" threadId="t" />
        <MessageImage src={b} alt="second" threadId="t" />
      </ImageGalleryScope>
      <ImageGalleryScope>
        <MessageImage src={c} alt="other answer" threadId="t" />
      </ImageGalleryScope>
    </>,
  );
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { expanded: false })[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Open full image" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByAltText("second")).toHaveAttribute("src", b);
  expect(within(dialog).queryByAltText("other answer")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "上一张" }));
  expect(within(dialog).getByAltText("first")).toHaveAttribute("src", a);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("authenticates both the protected thumbnail and the full gallery image", async () => {
  const fetchImage = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["PNG"], { type: "image/png" }),
    });
  vi.stubGlobal("fetch", fetchImage);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:protected-gallery";
      static revokeObjectURL = vi.fn();
    },
  );
  renderWithProviders(
    <ImageGalleryScope>
      <MessageImage
        src="output/final/render.png"
        alt="protected"
        threadId="t"
      />
    </ImageGalleryScope>,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(await screen.findByAltText("protected")).toHaveAttribute(
    "src",
    "blob:protected-gallery",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open full image" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByAltText("protected"),
    ).toHaveAttribute("src", "blob:protected-gallery"),
  );
  expect(fetchImage).toHaveBeenCalledTimes(2);
  expect(fetchImage).toHaveBeenLastCalledWith(
    expect.stringContaining("/api/threads/t/outputs/render.png?area=final"),
    expect.objectContaining({
      headers: { Authorization: "Bearer image-test" },
    }),
  );
});

it("opens a Windows conversation file link in a preview rather than navigating to the drive URL", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "readable file" }),
    }),
  );
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "t", basePath: "D:/project" }}
    >
      <RoutedMessageLink href="D:/project/probe.log">日志</RoutedMessageLink>
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "日志" }));
  expect(await screen.findByText("readable file")).toBeVisible();
  expect(screen.getByRole("dialog")).toBeVisible();
  vi.unstubAllGlobals();
});
