import { describe, expect, it } from "vitest";

import { connectionErrorHint } from "./remote-connection-dialog";

describe("connection error hints", () => {
  it("explains an unknown SSH host key, which BatchMode cannot accept", () => {
    expect(
      connectionErrorHint(
        "ssh_tunnel_failed: Host key verification failed.",
        true,
      ),
    ).toMatch(/^主机密钥未确认：先在终端里 ssh 连一次/);
  });

  it("keeps the raw detail next to the hint", () => {
    expect(
      connectionErrorHint(
        "ssh_tunnel_failed: banner exchange: Connection refused",
        false,
      ),
    ).toBe(
      "Connection refused: no SSH server on that port (banner exchange: Connection refused)",
    );
  });

  it("separates Echo-level failures from SSH ones", () => {
    expect(connectionErrorHint("HTTP 401", true)).toMatch(
      /^远端 Echo 拒绝了访问/,
    );
    expect(connectionErrorHint("something odd", true)).toBe("something odd");
  });
});
