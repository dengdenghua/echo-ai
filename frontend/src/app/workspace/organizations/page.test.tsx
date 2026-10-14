import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import type { User } from "@/core/auth/types";
import type { OrgDetails, Organization } from "@/core/organizations/api";
import type * as OrgApi from "@/core/organizations/api";
import { EchoAPIError } from "@/core/api/request";
const mocks = vi.hoisted(() => ({
  user: { user_id: "owner", username: "Owner", roles: ["admin"] } as User,
  enabled: true,
  list: vi.fn(),
  details: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  delete: vi.fn(),
  createDept: vi.fn(),
  deleteDept: vi.fn(),
  createChannel: vi.fn(),
  channelMembers: vi.fn(),
  saveChannelMember: vi.fn(),
  removeChannelMember: vi.fn(),
  deleteChannel: vi.fn(),
}));
vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: mocks.user,
    isAuthenticated: true,
    authStatus: { enabled: mocks.enabled },
    isLoading: false,
  }),
}));
vi.mock("@/components/workspace/workspace-container", () => ({
  WorkspaceContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/core/organizations/api", async (original) => ({
  ...(await original<typeof OrgApi>()),
  listOrganizations: mocks.list,
  getOrgDetails: mocks.details,
  createOrganization: mocks.create,
  saveOrgMember: mocks.save,
  removeOrgMember: mocks.remove,
  deleteOrganization: mocks.delete,
  createOrgDepartment: mocks.createDept,
  deleteOrgDepartment: mocks.deleteDept,
  createOrgChannel: mocks.createChannel,
  listChannelMembers: mocks.channelMembers,
  saveChannelMember: mocks.saveChannelMember,
  removeChannelMember: mocks.removeChannelMember,
  deleteOrgChannel: mocks.deleteChannel,
}));
import OrganizationsPage from "./page";
const organization: Organization = {
  id: "org",
  name: "Company",
  owner_id: "owner",
};
function details(): OrgDetails {
  return {
    members: [
      {
        member_id: "owner",
        kind: "human",
        role: "owner",
        display_name: "Owner",
      },
      { member_id: "eve", kind: "agent", role: "member", display_name: "Eve" },
    ],
    departments: [{ id: "d", name: "Engineering", parent_id: null }],
    channels: [{ id: "c", name: "Build", kind: "channel", department_id: "d" }],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = { user_id: "owner", username: "Owner", roles: ["admin"] };
  mocks.enabled = true;
  mocks.list.mockResolvedValue([organization]);
  mocks.details.mockResolvedValue(details());
  mocks.channelMembers.mockResolvedValue([
    { member_id: "owner", role: "owner" },
    { member_id: "eve", role: "member" },
  ]);
  mocks.create.mockResolvedValue({ id: "new", name: "New", owner_id: "owner" });
});
describe("enterprise organization management", () => {
  it("shows an empty state that says how to start", async () => {
    mocks.list.mockResolvedValue([]);
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText("No organizations yet.")).toBeVisible();
    expect(screen.getByText(/Name one above to start/)).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("removes deleted department IDs from pending creation drafts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    const departments = screen.getByRole("region", {
      name: "Departments",
      exact: true,
    });
    const channels = screen.getByRole("region", {
      name: "Internal channels",
      exact: true,
    });
    await user.selectOptions(
      within(departments).getByLabelText("Parent department"),
      "d",
    );
    await user.selectOptions(
      within(channels).getByLabelText("Departments"),
      "d",
    );
    mocks.details.mockResolvedValue({
      ...details(),
      departments: [],
      channels: [],
    });
    await user.click(
      within(departments).getByRole("button", { name: "Delete: Engineering" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
        exact: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(departments).getByLabelText("Parent department"),
      ).toHaveValue(""),
    );
    await user.type(
      within(departments).getByLabelText("Name"),
      "New department",
    );
    await user.click(
      within(departments).getByRole("button", { name: "Create department" }),
    );
    await waitFor(() =>
      expect(mocks.createDept).toHaveBeenCalledWith(
        "org",
        "New department",
        null,
      ),
    );
    await user.type(within(channels).getByLabelText("Name"), "New channel");
    await user.click(
      within(channels).getByRole("button", { name: "Create channel" }),
    );
    await waitFor(() =>
      expect(mocks.createChannel).toHaveBeenCalledWith(
        "org",
        "New channel",
        null,
      ),
    );
  });
  it.each([403, 409])(
    "reports HTTP %s without a fake mutation success",
    async (status) => {
      mocks.save.mockRejectedValue(
        new EchoAPIError("Server refusal", status, "refused"),
      );
      const user = userEvent.setup();
      renderWithProviders(<OrganizationsPage />);
      await screen.findByRole("article", { name: "Company" });
      fireEvent.change(screen.getByLabelText("Role: eve"), {
        target: { value: "admin" },
      });
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Save",
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        status === 403 ? /Access denied/ : /conflicts with current membership/,
      );
      expect(mocks.details).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Role: eve")).toHaveValue("member");
    },
  );
  it("switching accounts dismisses a pending permission confirmation", async () => {
    const view = renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    fireEvent.change(screen.getByLabelText("Role: eve"), {
      target: { value: "admin" },
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    mocks.user = { user_id: "other", username: "Other" };
    mocks.list.mockResolvedValue([]);
    view.rerender(<OrganizationsPage />);
    await screen.findByText("No organizations yet.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("creates under the authenticated actor and selects the returned organization", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    mocks.list.mockResolvedValue([
      organization,
      { id: "new", name: "New", owner_id: "owner" },
    ]);
    await user.type(screen.getAllByLabelText("Name")[0]!, "New");
    await user.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    expect(mocks.create).toHaveBeenCalledWith("New", "owner");
    expect(await screen.findByRole("article", { name: "New" })).toBeVisible();
  });
  it("platform admin remains read only without organization membership", async () => {
    mocks.user = {
      user_id: "outsider",
      username: "Admin",
      roles: ["admin", "operator"],
    };
    renderWithProviders(<OrganizationsPage />);
    const article = await screen.findByRole("article", { name: "Company" });
    expect(within(article).getByText(/Read only/)).toBeVisible();
    expect(
      within(article).queryByRole("button", { name: "Add member" }),
    ).not.toBeInTheDocument();
    expect(
      within(article).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });
  it("local anonymous mode cannot create an unmanageable placeholder-owned org", async () => {
    mocks.enabled = false;
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    expect(
      screen.queryByRole("button", { name: "Create organization" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Sign in with an authenticated/)).toBeVisible();
  });
  it("changes member roles only after confirmation and protects the last owner", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    expect(
      screen.getByRole("button", { name: "Remove: owner" }),
    ).toBeDisabled();
    expect(
      within(screen.getByLabelText("Role: owner")).getByRole("option", {
        name: "Member",
      }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Role: eve"), {
      target: { value: "admin" },
    });
    expect(mocks.save).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("org", {
        member_id: "eve",
        kind: "agent",
        role: "admin",
        display_name: "Eve",
      }),
    );
  });
  it("shows cascade impact and sends no deletion when cancelled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    await user.click(
      screen.getByRole("button", { name: "Delete: Engineering" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        /Child departments and their channels are retained/,
      ),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.deleteDept).not.toHaveBeenCalled();
  });
  it("channel access uses channel authority and requires organization membership", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Company" });
    await user.click(
      screen.getByRole("button", { name: /Build.*org|Build.*c/ }),
    );
    const access = await screen.findByRole("region", {
      name: "Channel access: Build",
    });
    await within(access).findByLabelText("Role: eve");
    fireEvent.change(within(access).getByLabelText("Role: eve"), {
      target: { value: "viewer" },
    });
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(mocks.saveChannelMember).toHaveBeenCalledWith("c", {
        member_id: "eve",
        role: "viewer",
      }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("account changes discard old confirmations and ignore late organization details", async () => {
    let resolveOld: (value: OrgDetails) => void = () => undefined;
    mocks.details.mockReturnValueOnce(
      new Promise<OrgDetails>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const view = renderWithProviders(<OrganizationsPage />);
    await waitFor(() =>
      expect(mocks.details).toHaveBeenCalledWith(
        "org",
        expect.any(AbortSignal),
      ),
    );
    mocks.user = { user_id: "other", username: "Other" };
    mocks.list.mockResolvedValue([
      { id: "other-org", name: "Other company", owner_id: "other" },
    ]);
    view.rerender(<OrganizationsPage />);
    await screen.findByRole("article", { name: "Other company" });
    await act(async () => {
      resolveOld(details());
    });
    expect(
      screen.queryByRole("article", { name: "Company" }),
    ).not.toBeInTheDocument();
    expect(mocks.details.mock.calls[0]?.[1].aborted).toBe(true);
  });
});
