import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { apiGet } from "@/core/api/request";
import { renderWithProviders } from "@/test/harness";
import { CodeBuddyModelControl } from "./codebuddy-model-control";

vi.mock("@/core/api/request", () => ({ apiGet: vi.fn() }));

beforeEach(() => {
  vi.mocked(apiGet).mockResolvedValue({
    models: ["hy3", "custom-local:example"],
  });
});

it("selects only the installed CLI models with explicit CodeBuddy ownership", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <CodeBuddyModelControl value="auto" onChange={onChange} />,
  );
  await screen.findByRole("option", { name: "hy3" });
  await user.selectOptions(screen.getByRole("combobox"), "codebuddy/hy3");
  expect(onChange).toHaveBeenCalledWith("codebuddy/hy3");
});

it("replaces another engine's model with the CLI default on entry", () => {
  const onChange = vi.fn();
  renderWithProviders(
    <CodeBuddyModelControl
      value="opencode-zen/big-pickle"
      onChange={onChange}
    />,
  );
  expect(onChange).toHaveBeenCalledWith("auto");
  expect(screen.getByRole("combobox")).toHaveValue("auto");
});

it("marks an unavailable saved model without silently changing the user's provider", async () => {
  vi.mocked(apiGet).mockResolvedValue({ models: ["custom-local:example"] });
  const onChange = vi.fn();
  renderWithProviders(
    <CodeBuddyModelControl
      value="codebuddy/deepseek-v4.1-flash"
      onChange={onChange}
    />,
  );
  await screen.findByRole("option", { name: "custom-local:example" });
  expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("option", { name: /deepseek-v4.1-flash/ }),
  ).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});
