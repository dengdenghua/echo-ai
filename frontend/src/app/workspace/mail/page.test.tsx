import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import MailPage from "./page";
import { mailboxRequest } from "@/core/mailbox/api";

vi.mock("@/core/mailbox/api", () => ({ mailboxRequest: vi.fn() }));
const api = vi.mocked(mailboxRequest);
const message = {
  id: "1-1",
  account_id: "one",
  sender: "Team <team@example.com>",
  to: "one@gmail.com",
  subject: "Meeting agenda",
  body: "Friday at 3 PM",
  date: 1,
  read: false,
  starred: false,
  attachments: [],
  reply_to: "team@example.com",
  message_id: "<original@example.com>",
};
const calls = () => api.mock.calls.map(([path]) => path);
beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path) => {
    if (path === "/google/config") return { configured: false, local: true };
    if (path === "/accounts")
      return {
        accounts: [{ id: "one", email: "one@gmail.com", provider: "gmail" }],
      };
    if (path.includes("/messages?")) return { messages: [message], total: 1 };
    if (path.includes("/messages/")) return message;
    if (path === "/assist") return { text: "A polite draft reply" };
    if (path === "/drafts") return { drafts: [] };
    if (path === "/send") return { refused: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it("reads and summarizes a message without sending or marking it read", async () => {
  const user = userEvent.setup();
  renderWithProviders(<MailPage />);
  await user.click(
    await screen.findByRole("button", { name: /Meeting agenda/ }),
  );
  expect(await screen.findByText("Friday at 3 PM")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "帮我读邮件" }));
  expect(await screen.findByText("A polite draft reply")).toBeVisible();
  expect(calls()).not.toContain("/send");
  expect(
    api.mock.calls.some(([, options]) => options?.method === "PATCH"),
  ).toBe(false);
});

it("drafts a reply for review, and only sends on the explicit send button", async () => {
  const user = userEvent.setup();
  renderWithProviders(<MailPage />);
  await user.click(
    await screen.findByRole("button", { name: /Meeting agenda/ }),
  );
  await user.click(await screen.findByRole("button", { name: "回复邮件" }));
  expect(screen.getByLabelText("收件人")).toHaveValue("team@example.com");
  await user.type(screen.getByLabelText("邮件写作要求"), "Confirm the meeting");
  await user.click(screen.getByRole("button", { name: "帮我写" }));
  await waitFor(() =>
    expect(screen.getByLabelText("邮件正文")).toHaveValue(
      "A polite draft reply",
    ),
  );
  expect(calls()).not.toContain("/send");
  await user.click(screen.getByRole("button", { name: "发送邮件" }));
  expect(await screen.findByText("邮件已发送")).toBeVisible();
  const send = api.mock.calls.find(([path]) => path === "/send")?.[1]
    ?.body as Record<string, string>;
  expect(send.reply_message_id).toBe("<original@example.com>");
  expect(send.request_id).toBe(send.id);
});

it("shows an honest connection screen with no fabricated inbox", async () => {
  api.mockResolvedValue({ accounts: [] });
  const user = userEvent.setup();
  renderWithProviders(<MailPage />);
  await user.click(await screen.findByRole("button", { name: "连接 Gmail" }));
  await user.click(screen.getByText("其他方式：应用专用密码"));
  expect(screen.getByLabelText("应用专用密码")).toHaveAttribute(
    "type",
    "password",
  );
  expect(screen.queryByText("Meeting agenda")).not.toBeInTheDocument();
});

it("retains other accounts' mail when one account fails", async () => {
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (path, options) => {
    if (path === "/accounts")
      return {
        accounts: [
          { id: "one", email: "one@gmail.com" },
          { id: "two", email: "two@gmail.com" },
        ],
      };
    if (path.startsWith("/accounts/two/"))
      throw new Error("Authentication expired");
    return original(path, options);
  });
  renderWithProviders(<MailPage />);
  expect(
    await screen.findByRole("button", { name: /Meeting agenda/ }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("two@gmail.com");
});
