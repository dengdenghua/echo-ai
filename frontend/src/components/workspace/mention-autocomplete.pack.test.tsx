import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness";

import { MentionAutocompletePopup } from "./mention-autocomplete";

describe("skill pack mentions", () => {
  it("describes a pack in the reader's language", () => {
    renderWithProviders(
      <MentionAutocompletePopup
        selectedIndex={0}
        items={[
          {
            type: "pack",
            label: "research",
            value: "@pack:research",
            description: "Bundled skills: web_search, fetch_url",
            icon: "pack",
          },
        ]}
      />,
      { locale: "zh-CN" },
    );

    expect(screen.getByText("技能组：web_search, fetch_url")).toBeVisible();
    expect(screen.queryByText(/Bundled skills/)).toBeNull();
  });
});
