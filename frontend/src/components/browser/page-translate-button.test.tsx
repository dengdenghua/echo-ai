import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { PageTranslateButton } from "./page-translate-button";

const mocks = vi.hoisted(() => ({
  setTranslationModel: vi.fn(),
  translate: vi.fn(),
  showOriginal: vi.fn(),
  retry: vi.fn(),
  openCustomModelSetup: vi.fn(),
  model: "",
  failure: null as { error: string; needsModel: boolean } | null,
}));

vi.mock("@/core/models/setup", () => ({
  openCustomModelSetup: mocks.openCustomModelSetup,
}));

vi.mock("@/core/browser/page-translation", () => ({
  isAlwaysTranslated: () => false,
  pageTranslation: {
    pageLoaded: vi.fn(),
    translate: mocks.translate,
    showOriginal: mocks.showOriginal,
    retry: mocks.retry,
  },
  pageTranslationSupported: () => true,
  setAlwaysTranslated: vi.fn(),
  setTranslationModel: mocks.setTranslationModel,
  siteOrigin: () => "https://example.com",
  translationModel: () => mocks.model,
  usePageTranslation: () => ({
    language: { lang: "latin", foreign: true, declared: "en" },
    active: true,
    mode: "translated",
    progress: null,
    busy: false,
    error: null,
    model: "big-pickle",
    ...mocks.failure,
  }),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: [
      {
        id: "echo-mix",
        name: "echo-mix",
        display_name: "Mix",
        provider: "echo",
      },
      {
        id: "deepseek-chat",
        name: "deepseek-chat",
        display_name: "deepseek-chat",
        source_display_name: "DeepSeek",
        entry_id: "deepseek",
        selection_id: "deepseek-chat::default",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

function openPanel() {
  renderWithProviders(
    <PageTranslateButton
      tabId="tab-1"
      url="https://example.com/post"
      isLoading={false}
      webContentsId={3}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Translate page" }));
  return screen.getByRole("dialog", { name: "Page translation" });
}

describe("PageTranslateButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.model = "";
    mocks.failure = null;
  });

  it("offers 添加模型, not a red error, when no model can translate", () => {
    mocks.failure = {
      error: "还没有可用的翻译模型：请在设置里添加一个模型。",
      needsModel: true,
    };
    const panel = openPanel();

    const reason = within(panel).getByText(/还没有可用的翻译模型/);
    expect(reason.parentElement!.className).not.toMatch(/destructive/);
    expect(panel.textContent).not.toMatch(/failed: 503/);
    fireEvent.click(within(panel).getByRole("button", { name: "Add a model" }));
    expect(mocks.openCustomModelSetup).toHaveBeenCalledTimes(1);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("keeps 重试 for a real failure", () => {
    mocks.failure = {
      error: "翻译服务暂时不可用，请稍后重试。",
      needsModel: false,
    };
    const panel = openPanel();

    expect(
      within(panel).getByText(/翻译服务暂时不可用/).parentElement!.className,
    ).toMatch(/text-destructive/);
    fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(mocks.retry).toHaveBeenCalledWith("tab-1");
  });

  it("offers callable models and names the automatic one in use", () => {
    const panel = openPanel();
    const select = within(panel).getByRole("combobox", { name: "Model" });

    const labels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "Automatic (now: big-pickle)",
      "deepseek-chat · DeepSeek",
    ]);

    fireEvent.change(select, { target: { value: "deepseek-chat::default" } });
    expect(mocks.setTranslationModel).toHaveBeenCalledWith(
      "deepseek-chat::default",
    );
  });

  it("keeps a remembered model that is no longer configured", () => {
    mocks.model = "retired-model";
    const panel = openPanel();

    const select = within(panel).getByRole("combobox", { name: "Model" });
    expect(select).toHaveValue("retired-model");
  });

  it("switches views from the panel", () => {
    const panel = openPanel();

    fireEvent.click(within(panel).getByRole("radio", { name: "Original" }));
    expect(mocks.showOriginal).toHaveBeenCalledWith("tab-1");

    fireEvent.click(within(panel).getByRole("radio", { name: "Side by side" }));
    expect(mocks.translate).toHaveBeenCalledWith(
      "tab-1",
      3,
      "bilingual",
      expect.any(String),
    );
  });
});
