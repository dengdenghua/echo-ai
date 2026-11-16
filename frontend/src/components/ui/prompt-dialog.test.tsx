import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { PromptDialog } from "./prompt-dialog";

describe("PromptDialog", () => {
  it("gives the prompt input an accessible name when no label is supplied", () => {
    renderWithProviders(
      <PromptDialog
        open
        title="重命名文件夹"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "重命名文件夹" }),
    ).toBeInTheDocument();
  });

  it("prefers the explicit field label over the dialog title", () => {
    renderWithProviders(
      <PromptDialog
        open
        title="新建站点"
        label="站点 URL"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "站点 URL" })).toBeInTheDocument();
  });
});
