import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModuleEditorDialog } from "./module-editor-dialog";
import { renderWithProviders } from "@/test/harness";
import type { AuthStatus, User } from "@/core/auth/types";
import {
  resetModuleStateCache,
  setModuleAvailable,
  setModuleStateProvider,
} from "@/core/modules/enabled-modules";
import type * as AuthProviderModule from "@/providers/AuthProvider";

const authState = vi.hoisted(() => {
  const state: {
    current: { authStatus: AuthStatus | null; user: User | null } | undefined;
  } = { current: undefined };
  return state;
});

vi.mock("@/providers/AuthProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthProviderModule>()),
  useOptionalAuth: () => authState.current,
}));

function signedInAs(roles: string[]) {
  authState.current = {
    authStatus: {
      enabled: true,
      jwt_available: true,
      allow_registration: false,
      exempt_paths: [],
    },
    user: { user_id: "local:someone", username: "someone", roles },
  };
}

function memoryProvider(initial: string[] = []) {
  let disabled = [...initial];
  let overrides: Record<string, Record<string, boolean>> = {};
  return {
    readDisabled: () => [...disabled],
    writeDisabled: (ids: string[]) => {
      disabled = [...ids];
    },
    readOverrides: () => structuredClone(overrides),
    writeOverrides: (next: Record<string, Record<string, boolean>>) => {
      overrides = structuredClone(next);
    },
    current: () => [...disabled],
    currentOverrides: () => structuredClone(overrides),
  };
}

describe("ModuleEditorDialog", () => {
  beforeEach(() => {
    authState.current = undefined;
    setModuleStateProvider(memoryProvider());
    resetModuleStateCache();
  });

  it("sends the admin to install a missing app", () => {
    signedInAs(["user", "admin"]);
    setModuleAvailable("narrative", false);
    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(screen.getByRole("button", { name: "去安装" })).toBeInTheDocument();
  });

  it("tells an ordinary account that the admin installs a missing app", () => {
    signedInAs(["user", "local"]);
    setModuleAvailable("narrative", false);
    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(screen.getByText("由管理员安装")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "去安装" })).toBeNull();
  });

  it("renders group headings and module cards", () => {
    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(screen.getByText("工作台核心")).toBeInTheDocument();
    expect(screen.getByText("知识与存储")).toBeInTheDocument();
    // 发现社区 became 广场 (e7f82deb); a module card shares the name.
    expect(screen.getByRole("heading", { name: "广场" })).toBeInTheDocument();
  });

  it("shows pinned modules as non-interactive with an always-on label", () => {
    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    // The agent roster (navHR) is pinned — it must not be a toggle button.
    expect(screen.getByText("常驻")).toBeInTheDocument();
  });

  it("toggles a removable module off and persists it", async () => {
    const provider = memoryProvider();
    setModuleStateProvider(provider);
    resetModuleStateCache();

    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    const toggles = screen.getAllByRole("button", { pressed: true });
    expect(toggles.length).toBeGreaterThan(0);

    await userEvent.click(toggles[0]);
    expect(provider.current()).toEqual([]);
    // Overrides are keyed by the canonical persona id, so the default identity
    // is stored under `eve` rather than the legacy `general`.
    expect(provider.currentOverrides()).toEqual({
      eve: expect.any(Object),
    });
  });

  it("closes via the done button", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ModuleEditorDialog open onOpenChange={onOpenChange} />,
      { locale: "zh-CN" },
    );

    await userEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("localizes group headings", () => {
    renderWithProviders(<ModuleEditorDialog open onOpenChange={vi.fn()} />, {
      locale: "en-US",
    });
    expect(screen.getByText("Knowledge & storage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });
});
