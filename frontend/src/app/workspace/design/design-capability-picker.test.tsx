import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DesignCapabilityPicker } from "./design-capability-picker";
import {
  AUTO_DESIGN_CAPABILITIES,
  resolveDesignCapabilities,
  type DesignCapabilities,
} from "@/core/design/capabilities";

vi.mock("@/core/design/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/design/capabilities")>()),
  resolveDesignCapabilities: vi.fn(),
}));
const resolve = vi.mocked(resolveDesignCapabilities);
const plan = {
  mode: "auto" as const,
  preferences: AUTO_DESIGN_CAPABILITIES,
  foundations: "",
  tasks: ["网页与界面"],
  skills: ["frontend-ui-engineering"],
  plugins: [],
  tools: [],
  ready: true,
  blockers: [],
  warnings: [],
  available_skills: [
    { id: "frontend-ui-engineering", available: true },
    { id: "presentations", available: false },
  ],
  available_plugins: [],
};
function Picker() {
  const [value, setValue] = useState<DesignCapabilities>(
    AUTO_DESIGN_CAPABILITIES,
  );
  return (
    <DesignCapabilityPicker
      goal="制作网页"
      value={value}
      onChange={setValue}
      onManage={vi.fn()}
      onSkills={vi.fn()}
    />
  );
}
describe("design capability selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolve.mockResolvedValue(plan);
  });
  it("does not fetch on mount and shows only the task selection when opened", async () => {
    render(<Picker />);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "设计能力 · 自动" }));
    expect(await screen.findByLabelText("界面设计与实现")).toBeChecked();
    expect(screen.getByLabelText(/演示文稿/)).toBeDisabled();
    expect(screen.getByLabelText(/演示文稿/)).not.toBeChecked();
  });
  it("turns an override into manual selection and can restore auto", async () => {
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "设计能力 · 自动" }));
    fireEvent.click(await screen.findByLabelText("界面设计与实现"));
    await waitFor(() =>
      expect(resolve).toHaveBeenLastCalledWith(
        "制作网页",
        { mode: "manual", skills: [], plugins: [] },
        false,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "自动选择" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭设计能力" }));
    expect(
      screen.getByRole("button", { name: "设计能力 · 自动" }),
    ).toBeInTheDocument();
  });
  it("shows fetch failures and retries", async () => {
    resolve.mockRejectedValueOnce(new Error("连接失败"));
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: "设计能力 · 自动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("连接失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByLabelText("界面设计与实现")).toBeChecked();
  });
});
