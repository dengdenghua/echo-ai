import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useState } from "react";
import { FolderIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { AppShortcutRow } from "./app-shortcut-row";

function Harness({
  opened,
  disabled = false,
}: {
  opened: () => void;
  disabled?: boolean;
}) {
  const [pinned, setPinned] = useState(false);
  const location = useLocation();
  return (
    <>
      <output aria-label="当前位置">{location.pathname}</output>
      <AppShortcutRow
        id="knowledge"
        to="/workspace/storage"
        label="知识库"
        icon={FolderIcon}
        pinned={pinned}
        pinLabel="固定"
        unpinLabel="取消固定"
        pinDisabled={disabled}
        pinDisabledReason="最多固定 8 个"
        onTogglePin={() => setPinned(!pinned)}
        onOpen={opened}
      />
    </>
  );
}

describe("application shortcut actions", () => {
  it("pins and unpins without navigating or closing; opening still navigates", () => {
    const opened = vi.fn();
    render(
      <MemoryRouter initialEntries={["/workspace/realtime/new"]}>
        <Harness opened={opened} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "固定 知识库" }));
    expect(
      screen.getByRole("button", { name: "取消固定 知识库" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("当前位置")).toHaveTextContent(
      "/workspace/realtime/new",
    );
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消固定 知识库" }));
    expect(screen.getByRole("button", { name: "固定 知识库" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("link", { name: "知识库" }));
    expect(screen.getByLabelText("当前位置")).toHaveTextContent(
      "/workspace/storage",
    );
    expect(opened).toHaveBeenCalledOnce();
  });
  it("explains a full rail while leaving the application accessible", () => {
    render(
      <MemoryRouter>
        <Harness opened={vi.fn()} disabled />
      </MemoryRouter>,
    );
    const pin = screen.getByRole("button", { name: "固定 知识库" });
    expect(pin).toBeDisabled();
    expect(pin).toHaveAttribute("title", "最多固定 8 个");
    fireEvent.click(screen.getByRole("link", { name: "知识库" }));
    expect(screen.getByLabelText("当前位置")).toHaveTextContent(
      "/workspace/storage",
    );
  });
});
