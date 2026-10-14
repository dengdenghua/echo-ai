import { expect, it } from "vitest";

import {
  canAccessGlobalControlPlane,
  canAccessOperatorControlPlane,
} from "./control-plane-access";

const enabled = {
  enabled: true,
  jwt_available: true,
  allow_registration: true,
  exempt_paths: [],
};

it("keeps both control planes available in explicit local auth-off mode", () => {
  const disabled = { ...enabled, enabled: false };
  expect(canAccessOperatorControlPlane(disabled, null)).toBe(true);
  expect(canAccessGlobalControlPlane(disabled, null)).toBe(true);
});

it("does not probe privileged control planes for ordinary users", () => {
  const user = { user_id: "eve", username: "Eve", roles: ["member"] };
  expect(canAccessOperatorControlPlane(enabled, user)).toBe(false);
  expect(canAccessGlobalControlPlane(enabled, user)).toBe(false);
});

it("distinguishes operator access from cross-tenant admin access", () => {
  const operator = {
    user_id: "operator",
    username: "Operator",
    roles: ["operator"],
  };
  const admin = {
    user_id: "admin",
    username: "Admin",
    roles: ["admin"],
    permissions: ["global:admin"],
  };
  expect(canAccessOperatorControlPlane(enabled, operator)).toBe(true);
  expect(canAccessGlobalControlPlane(enabled, operator)).toBe(false);
  expect(canAccessGlobalControlPlane(enabled, admin)).toBe(true);
});

it("does not ask for cross-tenant views on behalf of an admin without the scope", () => {
  const admin = { user_id: "local:me", username: "me", roles: ["admin"] };
  expect(canAccessOperatorControlPlane(enabled, admin)).toBe(true);
  expect(canAccessGlobalControlPlane(enabled, admin)).toBe(false);
  expect(
    canAccessGlobalControlPlane(enabled, { ...admin, permissions: [] }),
  ).toBe(false);
});
