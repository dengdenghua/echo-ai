import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { BackendStartupCard } from "./backend-bootstrap-overlay";

describe("<BackendStartupCard />", () => {
  it("names the app, not the backend, in the reader's language", () => {
    renderWithProviders(<BackendStartupCard message={null} />, {
      locale: "zh-CN",
    });
    expect(screen.getByText("正在启动 ECHO AI…")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/后端/);
  });

  it("speaks English to an English reader", () => {
    renderWithProviders(<BackendStartupCard message={null} />, {
      locale: "en-US",
    });
    expect(screen.getByText("Starting ECHO AI…")).toBeInTheDocument();
  });

  it("shows the step the development bootstrap reports", () => {
    renderWithProviders(
      <BackendStartupCard message="安装 browser 能力…" percent={75} />,
      { locale: "zh-CN" },
    );
    expect(screen.getByText("安装 browser 能力…")).toBeInTheDocument();
  });

  it("uses a compact status notice without a modal or full-screen backdrop", () => {
    const { container } = renderWithProviders(
      <BackendStartupCard message={null} />,
    );
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      container.querySelector("[aria-modal], .backdrop-blur-sm, .inset-0"),
    ).toBeNull();
    expect(container.querySelector('[data-echo-core="sync"]')).not.toBeNull();
  });

  it("offers a connection retry during slow startup and disables it while checking", () => {
    const retry = vi.fn();
    const { rerender } = renderWithProviders(
      <BackendStartupCard message={null} slow onRetry={retry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(
      <BackendStartupCard message={null} slow checking onRetry={retry} />,
    );
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  });
});
