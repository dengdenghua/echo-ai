import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import { LoginServiceStatus } from "./login-service-status";

const originalEcho = Object.getOwnPropertyDescriptor(window, "echo");
afterEach(() => {
  vi.useRealTimers();
  if (originalEcho) Object.defineProperty(window, "echo", originalEcho);
  else Reflect.deleteProperty(window, "echo");
});

function desktop(backend: object) {
  Object.defineProperty(window, "echo", {
    configurable: true,
    value: { isElectron: true, backend },
  });
}
function renderStatus(onRetry = vi.fn()) {
  return renderWithProviders(
    <LoginServiceStatus unavailable onRetry={onRetry} />,
    { locale: "zh-CN" },
  );
}

describe("local backend readiness", () => {
  it("keeps waiting through a long HTTP outage while the child is running", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn().mockResolvedValue({ state: "running" });
    desktop({ getStatus });
    renderStatus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90000);
    });
    expect(getStatus.mock.calls.length).toBeGreaterThan(30);
    expect(screen.getByTestId("login-service-wait")).toHaveTextContent(
      "正在启动 ECHO AI",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([undefined, vi.fn().mockRejectedValue(new Error("IPC unavailable"))])(
    "does not infer a crashed process from unavailable IPC (%s)",
    async (getStatus) => {
      desktop({ getStatus });
      renderStatus();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId("login-service-wait")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("offers a real service restart only after confirmed process failure", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValue({ state: "failed", reason: "process-exit" });
    const restart = vi.fn().mockResolvedValue({ ok: true });
    const retry = vi.fn();
    desktop({ getStatus, restart });
    renderStatus(retry);
    expect(await screen.findByRole("alert")).toHaveTextContent("未能继续运行");
    getStatus.mockResolvedValue({ state: "running" });
    fireEvent.click(screen.getByRole("button", { name: "重新启动服务" }));
    await waitFor(() => expect(restart).toHaveBeenCalledOnce());
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-service-wait")).toBeInTheDocument();
  });

  it("retains the web connection retry when there is no desktop process", () => {
    Reflect.deleteProperty(window, "echo");
    const retry = vi.fn();
    renderStatus(retry);
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法连接");
    fireEvent.click(screen.getByRole("button", { name: "重试连接" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
