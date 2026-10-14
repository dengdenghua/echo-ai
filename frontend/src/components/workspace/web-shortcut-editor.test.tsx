import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { resetWorkspaceWebShortcutCache } from "@/core/workbench/apps";
import { WebShortcutEditor } from "./web-shortcut-editor";

beforeEach(() => {
  localStorage.clear();
  resetWorkspaceWebShortcutCache();
});

it("adds, restores, renames and removes a pinned webpage", () => {
  const view = render(<WebShortcutEditor />);
  fireEvent.change(screen.getByLabelText("网页网址"), {
    target: { value: "example.com" },
  });
  fireEvent.click(screen.getByText("添加网页"));
  expect(screen.getByText("https://example.com/")).toBeInTheDocument();
  view.unmount();
  resetWorkspaceWebShortcutCache();
  render(<WebShortcutEditor />);
  fireEvent.click(screen.getByLabelText("编辑 example.com"));
  fireEvent.change(screen.getByLabelText("网页名称"), {
    target: { value: "文档" },
  });
  fireEvent.click(screen.getByText("保存网页"));
  expect(screen.getByText("文档")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("移除 文档"));
  expect(screen.queryByText("https://example.com/")).not.toBeInTheDocument();
});

it("rejects executable URLs", () => {
  render(<WebShortcutEditor />);
  fireEvent.change(screen.getByLabelText("网页网址"), {
    target: { value: "javascript:alert(1)" },
  });
  fireEvent.click(screen.getByText("添加网页"));
  expect(screen.getByRole("alert")).toHaveTextContent("有效的 http");
  expect(localStorage.length).toBe(0);
});
