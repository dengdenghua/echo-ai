import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EchoAPIError } from "@/core/api/request";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/core/i18n/context";
import { enUS } from "@/core/i18n/locales/en-US";
import { AnnotationThread } from "./annotations";

const mock = vi.hoisted(() => ({ deleteAnnotation: vi.fn() }));
vi.mock("./collab-provider", () => ({
  useCollab: () => ({ ...mock, canWrite: true }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("echo-language", "en-US");
});

it("shows a rejected delete and keeps the annotation visible", async () => {
  mock.deleteAnnotation.mockRejectedValue(
    new EchoAPIError("Forbidden", 403, null),
  );
  render(
    <I18nProvider initialLocale="en-US" initialTranslations={enUS}>
      <TooltipProvider>
        <AnnotationThread
          annotation={{
            annotation_id: "annotation-1",
            message_id: "message-1",
            author: null,
            body: "Keep this annotation",
            created_at: Date.now() / 1000,
            resolved: false,
            replies: [],
          }}
        />
      </TooltipProvider>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /delete|删除/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/author|作者/);
  expect(screen.getByText("Keep this annotation")).toBeVisible();
  expect(mock.deleteAnnotation).toHaveBeenCalledWith("annotation-1");
});
