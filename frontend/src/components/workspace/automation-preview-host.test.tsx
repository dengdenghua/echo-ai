import { act, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import {
  OPEN_AUTOMATION_PREVIEW,
  CLOSE_AUTOMATION_INSPECTION,
} from "@/core/automation/references";
import { AutomationPreviewHost } from "./automation-preview-host";
vi.mock("./automation-picture-in-picture", () => ({
  AutomationPictureInPicture: ({ target }: { target: { title: string } }) => (
    <div data-testid="inspection">{target.title}</div>
  ),
}));
const target = {
  kind: "desktop_window",
  source: "computer",
  id: "win32:1:2",
  title: "Editor",
};
it("inspects only this conversation and closes when live control preview resumes", () => {
  renderWithProviders(<AutomationPreviewHost threadId="t1" />);
  act(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_AUTOMATION_PREVIEW, {
        detail: { threadId: "other", target },
      }),
    );
  });
  expect(screen.queryByTestId("inspection")).toBeNull();
  act(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_AUTOMATION_PREVIEW, {
        detail: { threadId: "t1", target },
      }),
    );
  });
  expect(screen.getByTestId("inspection")).toHaveTextContent("Editor");
  act(() => {
    window.dispatchEvent(
      new CustomEvent(CLOSE_AUTOMATION_INSPECTION, {
        detail: { threadId: "t1" },
      }),
    );
  });
  expect(screen.queryByTestId("inspection")).toBeNull();
});
it("does not carry a historical window into another conversation", () => {
  const view = renderWithProviders(<AutomationPreviewHost threadId="t1" />);
  act(() => {
    window.dispatchEvent(
      new CustomEvent(OPEN_AUTOMATION_PREVIEW, {
        detail: { threadId: "t1", target },
      }),
    );
  });
  view.rerender(<AutomationPreviewHost threadId="t2" />);
  expect(screen.queryByTestId("inspection")).toBeNull();
});
