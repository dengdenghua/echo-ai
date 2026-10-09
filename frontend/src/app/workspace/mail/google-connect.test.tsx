import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { mailboxRequest } from "@/core/mailbox/api";
import { GoogleMailboxConnect } from "./google-connect";

vi.mock("@/core/mailbox/api", () => ({mailboxRequest: vi.fn()}));
const api = vi.mocked(mailboxRequest);
beforeEach(() => {
  api.mockReset();
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => { vi.restoreAllMocks(); });

it("requires a desktop client config and imports it without browser persistence", async () => {
  api.mockImplementation(async (path) => path === "/google/config" ? {configured: false, local: true} : {});
  renderWithProviders(<GoogleMailboxConnect onConnected={vi.fn()}/>);
  expect(await screen.findByText("首次使用：配置 Echo 的 Google 客户端")).toBeVisible();
  expect(screen.getByRole("button", {name: "使用 Google 账号连接"})).toBeDisabled();
  const file = new File(["{}"], "client.json", {type: "application/json"});
  Object.defineProperty(file, "text", {value: async () => JSON.stringify({installed: {client_id: "client.apps.googleusercontent.com", client_secret: "secret"}})});
  await userEvent.upload(screen.getByLabelText("导入 Google 客户端 JSON"), file);
  await waitFor(() => expect(screen.getByRole("button", {name: "使用 Google 账号连接"})).toBeEnabled());
  expect(api).toHaveBeenCalledWith("/google/config", {method: "PUT", body: {client_id: "client.apps.googleusercontent.com", client_secret: "secret"}});
});

it("opens Google and only completes when the backend confirms the grant", async () => {
  const connected = vi.fn();
  api.mockImplementation(async path => {
    if (path === "/google/config") return {configured: true, local: true};
    if (path === "/google/start") return {flow_id: "flow", authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?state=test"};
    return {status: "connected", error: ""};
  });
  renderWithProviders(<GoogleMailboxConnect onConnected={connected}/>);
  const button = screen.getByRole("button", {name: "使用 Google 账号连接"});
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(window.open).toHaveBeenCalledWith(expect.stringContaining("https://accounts.google.com/"), "_blank", "noopener,noreferrer");
  expect(connected).not.toHaveBeenCalled();
  await waitFor(() => expect(connected).toHaveBeenCalledOnce(), {timeout: 3000});
});

it("rejects web client files with a useful error", async () => {
  api.mockResolvedValue({configured: false, local: true});
  renderWithProviders(<GoogleMailboxConnect onConnected={vi.fn()}/>);
  await screen.findByText("首次使用：配置 Echo 的 Google 客户端");
  const file = new File(["{}"], "web.json", {type: "application/json"});
  Object.defineProperty(file, "text", {value: async () => JSON.stringify({web: {client_id: "client", client_secret: "secret"}})});
  await userEvent.upload(screen.getByLabelText("导入 Google 客户端 JSON"), file);
  expect(await screen.findByRole("alert")).toHaveTextContent("桌面应用");
  expect(api.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
});
