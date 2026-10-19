import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/harness";
import { untypedApi } from "@/core/api/request";
import { PersonalAppsPanel } from "./personal-apps-panel";
import { CreateAssetButton } from "./create-asset-button";

vi.mock("@/core/api/request", () => ({
  untypedApi: { get: vi.fn(), fetch: vi.fn() },
}));

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}

describe("independent creation flows", () => {
  for (const kind of ["skill", "app", "plugin"] as const) {
    it(`starts only the ${kind} creator`, async () => {
      renderWithProviders(
        <>
          <CreateAssetButton kind={kind} />
          <Location />
        </>,
        { locale: "en-US" },
      );
      await userEvent.click(screen.getByRole("button"));
      const url = screen.getByTestId("location").textContent!;
      expect(
        new URL(url, "https://echo.test").searchParams.get("prompt"),
      ).toMatch(new RegExp(`^\\$${kind}-creator\\n`));
    });
  }
});

describe("personal apps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists only apps, selects their latest snapshot and opens authenticated isolated HTML", async () => {
    vi.mocked(untypedApi.get).mockResolvedValue({
      apps: [
        {
          id: "new",
          app: {
            schema: "echo.app.v1",
            id: "calc",
            name: "Calculator",
            description: "New",
            version: "0.2.0",
          },
        },
        {
          id: "old",
          app: {
            schema: "echo.app.v1",
            id: "calc",
            name: "Old calculator",
            description: "Old",
            version: "0.1.0",
          },
        },
        { id: "site", label: "Ordinary website" },
      ],
    });
    vi.mocked(untypedApi.fetch).mockResolvedValue(
      new Response("<button>Calculate</button>"),
    );
    renderWithProviders(<PersonalAppsPanel />, { locale: "en-US" });
    expect(await screen.findByText("Calculator")).toBeVisible();
    expect(screen.queryByText("Old calculator")).toBeNull();
    expect(screen.queryByText("Ordinary website")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() =>
      expect(screen.getByTitle("Calculator")).toHaveAttribute(
        "srcdoc",
        expect.stringContaining("Calculate"),
      ),
    );
    const frame = screen.getByTitle("Calculator");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("connect-src 'none'");
    expect(untypedApi.fetch).toHaveBeenCalledWith(
      "get",
      "/api/deployments/new/index.html",
      expect.any(Object),
    );
  });

  it("reports catalog failures with a retry action", async () => {
    vi.mocked(untypedApi.get).mockRejectedValue(new Error("offline"));
    renderWithProviders(<PersonalAppsPanel />, { locale: "en-US" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});
