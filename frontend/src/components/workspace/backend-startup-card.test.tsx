import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { BackendStartupCard } from "./backend-bootstrap-overlay";

describe("<BackendStartupCard />", () => {
  it("names the app, not the backend, in the reader's language", () => {
    renderWithProviders(<BackendStartupCard message={null} />, {
      locale: "zh-CN",
    });
    expect(screen.getByText("正在启动 ECHO AI…")).toBeInTheDocument();
    expect(screen.getByTestId("backend-startup-mark")).toBeInTheDocument();
    expect(
      screen.getByTestId("backend-startup-mark").querySelectorAll("img"),
    ).toHaveLength(2);
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
});
