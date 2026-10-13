import { describe, expect, it } from "vitest";

import { WORKBENCH_APP_ICONS } from "@/components/workspace/module-icons";
import { zhCN } from "@/core/i18n/locales/zh-CN";
import { WORKBENCH_BUILTIN_APPS } from "@/core/workbench/apps";

import { buildDesktopApps, desktopWindowURL } from "./desktop-apps";

describe("desktop launcher", () => {
  const apps = buildDesktopApps(zhCN);

  it("gives every app its own icon", () => {
    const byIcon = new Map<unknown, string[]>();
    for (const app of apps) {
      byIcon.set(app.icon, [...(byIcon.get(app.icon) ?? []), app.name]);
    }
    const shared = [...byIcon.values()].filter((names) => names.length > 1);
    expect(shared).toEqual([]);
  });

  it("draws workbench apps with the sidebar's icons", () => {
    for (const app of WORKBENCH_BUILTIN_APPS) {
      const tile = apps.find((entry) => entry.id === `workbench:${app.id}`);
      expect(tile?.icon).toBe(WORKBENCH_APP_ICONS[app.icon]);
    }
  });
});

describe("desktop app catalog helpers", () => {
  it("keeps route query parameters inside the shell hash", () => {
    expect(
      desktopWindowURL("/workspace/storage?surface=company&library=images"),
    ).toBe(
      "echo-app://app/index.html#/workspace/storage?surface=company&library=images&embedded=app",
    );
  });

  it("normalizes route-less app paths", () => {
    expect(desktopWindowURL("workspace/realtime/new")).toBe(
      "echo-app://app/index.html#/workspace/realtime/new?embedded=app",
    );
  });
});
