import { describe, expect, it } from "vitest";

import {
  workLocationEnUS,
  workLocationJaJP,
  workLocationKoKR,
  workLocationZhCN,
} from "@/core/i18n/locales/work-location";

import { connectionErrorHint } from "./remote-connection-dialog";

describe("connection error hints", () => {
  it("explains an unknown SSH host key, which BatchMode cannot accept", () => {
    expect(
      connectionErrorHint(
        "ssh_tunnel_failed: Host key verification failed.",
        workLocationZhCN,
      ),
    ).toMatch(/^主机密钥未确认：先在终端里 ssh 连一次/);
  });

  it("keeps the raw detail next to the hint", () => {
    expect(
      connectionErrorHint(
        "ssh_tunnel_failed: banner exchange: Connection refused",
        workLocationEnUS,
      ),
    ).toBe(
      "Connection refused: no SSH server on that port (banner exchange: Connection refused)",
    );
  });

  it("separates Echo-level failures from SSH ones", () => {
    expect(connectionErrorHint("HTTP 401", workLocationZhCN)).toMatch(
      /^远端 Echo 拒绝了访问/,
    );
    expect(connectionErrorHint("something odd", workLocationZhCN)).toBe(
      "something odd",
    );
  });

  it("speaks the user's language, not just Chinese or English", () => {
    const detail = "ssh_tunnel_failed: Permission denied (publickey)";
    expect(connectionErrorHint(detail, workLocationJaJP)).toMatch(
      /^SSH 認証に失敗/,
    );
    expect(connectionErrorHint(detail, workLocationKoKR)).toMatch(
      /^SSH 인증에 실패/,
    );
  });
});
