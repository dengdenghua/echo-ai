import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import { BackendBootstrapOverlay } from "./backend-bootstrap-overlay";
import { LoginServiceStatus } from "@/app/login/login-service-status";

vi.mock("@/core/backend/desktop-shell", () => ({
  isPackagedShell: () => true,
}));
vi.mock("@/core/backend/use-startup-gate", () => ({
  useStartupGate: (enabled: boolean) => ({
    visible: enabled,
    slow: false,
    checking: false,
    retry: vi.fn(),
  }),
}));

const original = Object.getOwnPropertyDescriptor(window, "echo");
afterEach(() => {
  if (original) Object.defineProperty(window, "echo", original);
  else Reflect.deleteProperty(window, "echo");
});

describe("startup notice ownership", () => {
  it.each(["/", "/login", "/login/"])(
    "shows just the inline login status at %s",
    (route) => {
      Object.defineProperty(window, "echo", {
        configurable: true,
        value: { isElectron: true, on: () => () => {} },
      });
      renderWithProviders(
        <>
          <LoginServiceStatus unavailable onRetry={() => {}} />
          <BackendBootstrapOverlay />
        </>,
        {
          initialRoute: route,
          locale: "zh-CN",
        },
      );
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByTestId("login-service-wait")).toBeInTheDocument();
      expect(
        screen.queryByTestId("desktop-startup-notice"),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps the startup notice for workspace routes without an inline login", () => {
    renderWithProviders(<BackendBootstrapOverlay />, {
      initialRoute: "/workspace/realtime/new",
      locale: "zh-CN",
    });
    expect(screen.getByTestId("desktop-startup-notice")).toBeInTheDocument();
  });
});
