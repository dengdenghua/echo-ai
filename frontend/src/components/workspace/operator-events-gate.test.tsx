import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

const auth = vi.hoisted(() => ({
  value: null as null | {
    authStatus: { enabled: boolean };
    user: { user_id: string; username: string; roles?: string[] };
  },
}));

vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => auth.value,
}));

import { OperatorEventsGate } from "./operator-events-gate";

function signedIn(roles: string[]) {
  auth.value = {
    authStatus: { enabled: true },
    user: { user_id: "local:x", username: "x", roles },
  };
}

describe("OperatorEventsGate", () => {
  beforeEach(() => {
    auth.value = null;
  });

  it("shows the live panels to administrators and operators", () => {
    for (const roles of [["user", "admin"], ["operator"]]) {
      signedIn(roles);
      const { unmount } = renderWithProviders(
        <OperatorEventsGate>
          <div>live events</div>
        </OperatorEventsGate>,
      );
      expect(screen.getByText("live events")).toBeInTheDocument();
      unmount();
    }
  });

  it("explains instead of opening a stream the server refuses", () => {
    signedIn(["user", "local"]);
    renderWithProviders(
      <>
        <OperatorEventsGate>
          <div>live events</div>
        </OperatorEventsGate>
        <OperatorEventsGate quiet>
          <div>journal</div>
        </OperatorEventsGate>
      </>,
    );
    expect(screen.queryByText("live events")).toBeNull();
    expect(screen.queryByText("journal")).toBeNull();
    expect(screen.getAllByText("实时事件流由管理员查看")).toHaveLength(1);
  });

  it("keeps the panels when sign-in is off", () => {
    auth.value = {
      authStatus: { enabled: false },
      user: { user_id: "anonymous", username: "anonymous" },
    };
    renderWithProviders(
      <OperatorEventsGate>
        <div>live events</div>
      </OperatorEventsGate>,
    );
    expect(screen.getByText("live events")).toBeInTheDocument();
  });
});
