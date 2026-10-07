import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type * as StorageApi from "@/core/storage/api";
import {
  getNASManifest,
  listNASDirectory,
  startNASService,
} from "@/core/storage/api";
import { renderWithProviders } from "@/test/harness";
import StoragePage from "./page";

const surfaces = vi.hoisted(() => ({
  controlMounted: vi.fn(),
  controlUnmounted: vi.fn(),
  organizerMounted: vi.fn(),
  organizerUnmounted: vi.fn(),
}));
vi.mock("../computer/page", () => ({
  ComputerAutomationSurface: function ControlSurface() {
    useEffect(() => {
      surfaces.controlMounted();
      return surfaces.controlUnmounted;
    }, []);
    return <div>Actual control surface</div>;
  },
}));
vi.mock("../desktop-organizer/page", () => ({
  DesktopOrganizerSurface: function OrganizerSurface() {
    useEffect(() => {
      surfaces.organizerMounted();
      return surfaces.organizerUnmounted;
    }, []);
    return <div>Actual organizer surface</div>;
  },
}));

function StorageRoute() {
  const location = useLocation();
  return (
    <>
      <StoragePage />
      <output aria-label="Current query">{location.search}</output>
    </>
  );
}

vi.mock("@/core/storage/api", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageApi>()),
  getNASManifest: vi.fn(),
  getNASPolicy: vi.fn().mockResolvedValue({ mode: "privacy" }),
  listNASSources: vi.fn().mockResolvedValue([]),
  listNASDirectory: vi.fn().mockRejectedValue(new Error("HTTP 503")),
  startNASService: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNASManifest)
    .mockReset()
    .mockRejectedValue(new Error("HTTP 503"));
  vi.mocked(startNASService).mockReset().mockResolvedValue({
    ok: false,
    status: "not_found",
    base_url: "/api/storage",
    auth_token: null,
  });
});

it("explains a missing storage service without polling an uninstalled process", async () => {
  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/storage?library=computer",
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /未找到 echo-storage/,
  );
  expect(startNASService).toHaveBeenCalledOnce();
  expect(getNASManifest).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "扫描", exact: true }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "效率", exact: true }),
  ).toBeDisabled();
});

it("mounts only the selected computer surface and preserves existing query parameters", async () => {
  const user = userEvent.setup();
  renderWithProviders(<StorageRoute />, {
    locale: "zh-CN",
    initialRoute:
      "/workspace/storage?surface=company&library=computer&view=control&keep=one&keep=two&echoRemote=host-a",
  });
  expect(await screen.findByText("Actual control surface")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "电脑操控" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(getNASManifest).not.toHaveBeenCalled();
  expect(listNASDirectory).not.toHaveBeenCalled();
  expect(startNASService).not.toHaveBeenCalled();
  expect(surfaces.organizerMounted).not.toHaveBeenCalled();

  await user.click(screen.getByRole("tab", { name: "桌面整理" }));
  expect(
    await screen.findByText("Actual organizer surface"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Actual control surface")).not.toBeInTheDocument();
  expect(surfaces.controlUnmounted).toHaveBeenCalledOnce();
  expect(getNASManifest).not.toHaveBeenCalled();
  const query = new URLSearchParams(
    screen.getByLabelText("Current query").textContent!,
  );
  expect(query.get("view")).toBe("organizer");
  expect(query.get("surface")).toBe("company");
  expect(query.get("echoRemote")).toBe("host-a");
  expect(query.getAll("keep")).toEqual(["one", "two"]);

  await user.click(screen.getByRole("tab", { name: "文件", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "未找到 echo-storage",
  );
  expect(surfaces.organizerUnmounted).toHaveBeenCalledOnce();
  expect(
    screen.queryByText("Actual organizer surface"),
  ).not.toBeInTheDocument();
  expect(getNASManifest).toHaveBeenCalledOnce();
  expect(listNASDirectory).toHaveBeenCalledOnce();
  expect(
    new URLSearchParams(
      screen.getByLabelText("Current query").textContent!,
    ).get("view"),
  ).toBe("files");
});

it("defaults an unknown local view to files and stops reconnecting after files unmount", async () => {
  const user = userEvent.setup();
  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute:
      "/workspace/storage?surface=company&library=computer&view=unknown",
  });
  expect(
    screen.getByRole("tab", { name: "文件", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await screen.findByRole("alert");
  const reads = vi.mocked(getNASManifest).mock.calls.length;
  await user.click(screen.getByRole("tab", { name: "电脑操控" }));
  await screen.findByText("Actual control surface");
  fireEvent(window, new Event("focus"));
  expect(getNASManifest).toHaveBeenCalledTimes(reads);
});

it("does not expose computer tools or mount their surfaces in another library", async () => {
  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute:
      "/workspace/storage?surface=company&library=docs&view=control",
  });
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("tab", { name: "电脑操控" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "桌面整理" }),
  ).not.toBeInTheDocument();
  expect(surfaces.controlMounted).not.toHaveBeenCalled();
  expect(surfaces.organizerMounted).not.toHaveBeenCalled();
  expect(getNASManifest).toHaveBeenCalledOnce();
});

it("does not start or continue NAS initialization after switching away from files", async () => {
  const user = userEvent.setup();
  let rejectManifest!: (error: Error) => void;
  vi.mocked(getNASManifest).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectManifest = reject;
      }),
  );
  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/storage?surface=company&library=computer",
  });
  await user.click(screen.getByRole("tab", { name: "电脑操控" }));
  await screen.findByText("Actual control surface");
  await act(async () => {
    rejectManifest(new Error("NAS unavailable"));
  });
  expect(startNASService).not.toHaveBeenCalled();
  expect(getNASManifest).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
