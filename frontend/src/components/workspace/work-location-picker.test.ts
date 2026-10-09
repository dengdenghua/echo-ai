import { describe, expect, it } from "vitest";

import { shortenPath } from "./work-location-picker";

describe("shortenPath", () => {
  it("keeps short paths whole", () => {
    expect(shortenPath("E:\AGENT\echo-os")).toBe("E:\AGENT\echo-os");
  });

  it("keeps the drive and the last two folders of a long path", () => {
    expect(
      shortenPath(
        "C:/Users/Administrator/AppData/Local/Temp/claude/scratchpad/node-shared-project",
      ),
    ).toBe("C:/…/scratchpad/node-shared-project");
    expect(shortenPath("/home/me/work/clients/acme/website/frontend")).toBe(
      "/home/…/website/frontend",
    );
  });
});
