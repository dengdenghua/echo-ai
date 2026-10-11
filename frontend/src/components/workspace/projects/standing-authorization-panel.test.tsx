import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { STANDING_COPY } from "@/core/projects/standing-copy";
import type { Locale } from "@/core/i18n/locale";
import { StandingAuthorizationPanel } from "./standing-authorization-panel";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  actor: "alice",
  granted: false,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { user_id: mocks.actor, actor_id: mocks.actor },
    isAuthenticated: true,
    authStatus: { enabled: true },
    isLoading: false,
  }),
}));
const phases = [
  {
    id: "M",
    name: "Reviewed phase",
    status: "pending",
    spec: { ai_budget_usd: 5 },
  },
];
const review = {
  review_id: "review",
  project_id: "P",
  owner_id: "alice",
  tenant_id: "a",
  phases: [
    {
      id: "M",
      name: "Reviewed phase",
      fingerprint: "fingerprint",
      ai_budget_usd: 5,
    },
  ],
  limit_usd: 3,
  expires_at: 9999999999,
  budget_basis: "cumulative_project_spend",
};
const grant = {
  grant_id: "grant",
  project_id: "P",
  owner_id: "alice",
  tenant_id: "a",
  granted_by: "alice",
  review_id: "review",
  phase_ids: ["M"],
  phase_fingerprints: ["fingerprint"],
  limit_usd: 3,
  budget_basis: "cumulative_project_spend",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function render(locale: Locale = "en-US") {
  return renderWithProviders(
    <StandingAuthorizationPanel
      projectId="P"
      ownerId="alice"
      phases={phases}
    />,
    { locale },
  );
}
function requests(method: string) {
  return mocks.fetch.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
}
async function begin(locale: Locale = "en-US") {
  const copy = STANDING_COPY[locale];
  await screen.findByText(copy.inactive);
  fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed phase" }));
  fireEvent.change(screen.getByRole("textbox", { name: copy.limit }), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: copy.review }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor = "alice";
  mocks.granted = false;
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/review")) return json(review);
    if (url.endsWith("/confirm")) {
      mocks.granted = true;
      return json({ grant_id: "grant", replayed: false });
    }
    if (init?.method === "DELETE") {
      mocks.granted = false;
      return json({ revocation_id: "revoke" });
    }
    return json({ grant: mocks.granted ? grant : null });
  });
});

it.each<Locale>(["en-US", "zh-CN", "ja-JP", "ko-KR"])(
  "shows server-reviewed scope and requires owner confirmation in %s",
  async (locale) => {
    render(locale);
    const copy = STANDING_COPY[locale];
    const dialog = await begin(locale);
    expect(
      within(dialog).getByRole("heading", { name: copy.confirm }),
    ).toBeInTheDocument();
    expect(dialog.textContent).toContain("Reviewed phase ($5)");
    expect(dialog.textContent).toContain(copy.bounds);
    expect(dialog.textContent).toContain(copy.approvals);
    expect(requests("POST")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.confirm }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(copy.saved));
    expect(JSON.parse(requests("POST")[1]![1].body)).toEqual({
      review_id: "review",
      confirmed: true,
    });
    expect(requests("POST")[1]![0]).toMatch(/\/confirm$/);
    expect(screen.getByText(`${copy.active} · $3`)).toBeInTheDocument();
  },
);

it("cancelling review never creates execution authority", async () => {
  render();
  const dialog = await begin();
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(requests("POST")).toHaveLength(1);
});

it.each(["Infinity", "NaN", "0", "-1"])(
  "rejects invalid ceiling %s before sending review",
  async (value) => {
    render();
    await screen.findByText(STANDING_COPY["en-US"].inactive);
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed phase" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", { name: "Review authorization" }),
    );
    expect(mocks.error).toHaveBeenCalledWith(STANDING_COPY["en-US"].invalid);
    expect(requests("POST")).toHaveLength(0);
  },
);

it("revoke requires confirmation and refreshes durable grant state", async () => {
  mocks.granted = true;
  render();
  await screen.findByText("Authorization recorded · $3");
  fireEvent.click(screen.getByRole("button", { name: "Revoke authorization" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain(STANDING_COPY["en-US"].revokeBody);
  expect(requests("DELETE")).toHaveLength(0);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Revoke authorization" }),
  );
  await screen.findByText("No standing authorization");
  expect(requests("DELETE")).toHaveLength(1);
});

it("a stale review conflict is visible and never reported as saved", async () => {
  const original = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation((url: string, init?: RequestInit) =>
    url.endsWith("/confirm")
      ? Promise.resolve(json({ detail: "plan changed" }, 409))
      : original(url, init),
  );
  render();
  const dialog = await begin();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Authorize progress" }),
  );
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(STANDING_COPY["en-US"].changed),
  );
  expect(mocks.success).not.toHaveBeenCalled();
});

it("account change aborts a pending review and cannot open a late confirmation", async () => {
  let resolve: ((response: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  const original = mocks.fetch.getMockImplementation()!;
  mocks.fetch.mockImplementation((url: string, init?: RequestInit) => {
    if (!url.endsWith("/review")) return original(url, init);
    signal = init?.signal ?? undefined;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  });
  const view = render();
  await screen.findByText("No standing authorization");
  fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed phase" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Review authorization" }));
  await waitFor(() => expect(resolve).toBeDefined());
  mocks.actor = "bob";
  view.rerender(
    <StandingAuthorizationPanel
      projectId="P"
      ownerId="alice"
      phases={phases}
    />,
  );
  expect(signal?.aborted).toBe(true);
  resolve!(json(review));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(requests("POST")).toHaveLength(1);
});

it("nonowners and phases without bounded budgets do not get an authorization action", async () => {
  mocks.actor = "bob";
  const view = render();
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.actor = "alice";
  view.rerender(
    <StandingAuthorizationPanel
      projectId="P"
      ownerId="alice"
      phases={[{ id: "M", name: "unsafe", status: "pending" }]}
    />,
  );
  await screen.findByText("No standing authorization");
  expect(
    screen.getByRole("button", { name: "Review authorization" }),
  ).toBeDisabled();
});
