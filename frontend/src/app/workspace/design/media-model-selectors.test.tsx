import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MediaModelSelectors } from "./media-model-selectors";
import { AUTO_DESIGN_CAPABILITIES, resolveDesignCapabilities } from "@/core/design/capabilities";

vi.mock("@/core/design/capabilities", () => ({
  AUTO_DESIGN_CAPABILITIES: { mode: "auto", skills: [], plugins: [] },
  resolveDesignCapabilities: vi.fn(),
}));

it("loads server models and changes task preferences without changing the draft", async () => {
  vi.mocked(resolveDesignCapabilities).mockResolvedValue({ media_models: {
    image: { models: ["image-a"], default: "image-a", available: true },
    video: { models: ["video-b"], default: "video-b", available: true },
  } } as Awaited<ReturnType<typeof resolveDesignCapabilities>>);
  const onChange = vi.fn();
  render(<MediaModelSelectors value={AUTO_DESIGN_CAPABILITIES} onChange={onChange} />);
  await waitFor(() => expect(screen.getByRole("option", { name: "video-b" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("视频生成模型"), { target: { value: "video-b" } });
  expect(onChange).toHaveBeenCalledWith({ ...AUTO_DESIGN_CAPABILITIES, video_model: "video-b" });
});
