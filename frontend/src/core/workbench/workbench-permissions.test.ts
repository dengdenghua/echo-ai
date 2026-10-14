import { describe, expect, it } from "vitest";

import { EchoAPIError } from "@/core/api/request";
import type { AuthStatus, User } from "@/core/auth/types";

import {
  canManageWorkbenches,
  workbenchActionErrorMessage,
} from "./workbench-permissions";

const AUTH_ON: AuthStatus = {
  enabled: true,
  jwt_available: true,
  allow_registration: false,
  exempt_paths: [],
};

function account(roles: string[]): User {
  return { user_id: "local:someone", username: "someone", roles };
}

describe("canManageWorkbenches", () => {
  it("lets only the admin change machine-wide packages when sign-in is on", () => {
    expect(
      canManageWorkbenches({
        authStatus: AUTH_ON,
        user: account(["user", "admin"]),
      }),
    ).toBe(true);
    expect(
      canManageWorkbenches({
        authStatus: AUTH_ON,
        user: account(["user", "local"]),
      }),
    ).toBe(false);
    expect(canManageWorkbenches({ authStatus: AUTH_ON, user: null })).toBe(
      false,
    );
  });

  it("keeps the single-user machine unchanged when sign-in is off", () => {
    expect(
      canManageWorkbenches({
        authStatus: { ...AUTH_ON, enabled: false },
        user: null,
      }),
    ).toBe(true);
  });

  it("leaves the decision to the server outside the auth shell", () => {
    expect(canManageWorkbenches(undefined)).toBe(true);
    expect(canManageWorkbenches(null)).toBe(true);
  });
});

describe("workbenchActionErrorMessage", () => {
  it("shows the server's sentence for a refused change", () => {
    const refused = new EchoAPIError(
      "云插件卸载失败: HTTP 403 {...}",
      403,
      "只有管理员可以安装或移除工作台，请联系本机管理员。",
    );
    expect(workbenchActionErrorMessage(refused)).toBe(
      "只有管理员可以安装或移除工作台，请联系本机管理员。",
    );
  });

  it("keeps the caller's message for other failures", () => {
    expect(
      workbenchActionErrorMessage(
        new EchoAPIError("云插件安装失败", 502, { detail: "upstream" }),
      ),
    ).toBe("云插件安装失败");
    expect(workbenchActionErrorMessage(new Error("network"))).toBe("network");
    expect(workbenchActionErrorMessage("plain")).toBe("plain");
  });
});
