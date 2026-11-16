import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useLocation, useNavigate } from "react-router-dom";
import type * as AuthApi from "@/core/auth/api";
import { renderWithProviders } from "@/test/harness";
import { KnowledgeApplicationLayout } from "./knowledge-application-layout";
import {
  isKnowledgeApplication,
  isMainConversationRoute,
  useConversationHomeRoute,
  useConversationReturnRoute,
} from "@/core/workspace/knowledge-application";

const identity = vi.hoisted(() => ({ actor: "layout-user" }));
vi.mock("@/core/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApi>()),
  currentActorId: () => identity.actor,
}));
function Harness() {
  const route = useLocation();
  const navigate = useNavigate();
  const back = useConversationReturnRoute();
  const home = useConversationHomeRoute();
  return (
    <>
      <button
        onClick={() =>
          navigate("/workspace/realtime/echo-assistant?agent=echo")
        }
      >
        打开助手
      </button>
      <button onClick={() => navigate(home)}>首页</button>
      <output aria-label="当前路由">
        {route.pathname}
        {route.search}
      </output>
      {isKnowledgeApplication(route.pathname) ? (
        <KnowledgeApplicationLayout returnTo={back}>
          <div>真实应用内容插槽</div>
        </KnowledgeApplicationLayout>
      ) : (
        <button onClick={() => navigate("/workspace/storage?library=sources")}>
          打开知识库
        </button>
      )}
    </>
  );
}
beforeEach(() => {
  sessionStorage.clear();
  identity.actor = "layout-user";
});
it("uses application navigation and preserves citation context when changing categories", () => {
  renderWithProviders(<Harness />, {
    locale: "zh-CN",
    initialRoute:
      "/workspace/storage?library=sources&sourceThread=original&presentation=workbench",
  });
  expect(screen.getByRole("navigation", { name: "知识库导航" })).toBeVisible();
  expect(screen.getByRole("link", { name: "授权目录" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("link", { name: "文档", exact: true }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent("library=docs");
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "sourceThread=original",
  );
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "presentation=workbench",
  );
  fireEvent.click(screen.getByRole("link", { name: "返回对话" }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "/workspace/realtime/original",
  );
});
it("returns to the active conversation without replacing it with the application route", () => {
  renderWithProviders(<Harness />, {
    locale: "zh-CN",
    initialRoute: "/workspace/realtime/saved-task?agent=coder",
  });
  fireEvent.click(screen.getByRole("button", { name: "打开知识库" }));
  fireEvent.click(screen.getByRole("link", { name: "检索", exact: true }));
  fireEvent.click(screen.getByRole("link", { name: "返回对话" }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "/workspace/realtime/saved-task?agent=coder",
  );
});
it("does not use another account or an external saved route for the return link", () => {
  sessionStorage.setItem(
    "echo:last-conversation-route:other-user",
    "/workspace/realtime/private-task",
  );
  sessionStorage.setItem(
    "echo:last-conversation-route:layout-user",
    "//example.invalid/redirect",
  );
  renderWithProviders(<Harness />, {
    locale: "zh-CN",
    initialRoute: "/workspace/storage",
  });
  expect(screen.getByRole("link", { name: "返回对话" })).toHaveAttribute(
    "href",
    "/workspace/realtime/new",
  );
});

it("keeps ordinary conversations under Home after visiting the assistant and knowledge", () => {
  renderWithProviders(<Harness />, {
    locale: "zh-CN",
    initialRoute: "/workspace/realtime/project-task?agent=coder",
  });
  fireEvent.click(screen.getByRole("button", { name: "打开助手" }));
  fireEvent.click(screen.getByRole("button", { name: "打开知识库" }));
  fireEvent.click(screen.getByRole("link", { name: "返回对话" }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "/workspace/realtime/project-task?agent=coder",
  );
  fireEvent.click(screen.getByRole("button", { name: "打开助手" }));
  fireEvent.click(screen.getByRole("button", { name: "首页" }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "/workspace/realtime/project-task?agent=coder",
  );
});

it("does not treat an assistant alias, resolved assistant, or stale assistant bookmark as Home", () => {
  for (const route of [
    "/workspace/realtime/echo-assistant?agent=echo",
    "/workspace/realtime/echo-assistant-user123",
    "/workspace/realtime/echo%2Dassistant",
  ])
    expect(isMainConversationRoute(route)).toBe(false);
  sessionStorage.setItem(
    "echo:last-conversation-route:layout-user",
    "/workspace/realtime/echo-assistant?agent=echo",
  );
  renderWithProviders(<Harness />, {
    locale: "zh-CN",
    initialRoute: "/workspace/realtime/echo-assistant-user123",
  });
  fireEvent.click(screen.getByRole("button", { name: "首页" }));
  expect(screen.getByLabelText("当前路由")).toHaveTextContent(
    "/workspace/realtime/new",
  );
});
