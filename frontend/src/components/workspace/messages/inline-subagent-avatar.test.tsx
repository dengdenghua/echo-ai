import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { InlineSubagentCards } from "./inline-subagent-cards";

test.each(["/api/agents/twin_health/avatar", null])(
  "uses the installed role visual for an older receipt (image=%s)",
  (avatarUrl) => {
    const client = new QueryClient();
    client.setQueryData(
      ["agents"],
      [
        {
          name: "twin_health",
          display_name: "医疗健康协作分身",
          icon: "🩺",
          avatar_url: avatarUrl,
        },
      ],
    );
    const { container } = renderWithProviders(
      <InlineSubagentCards
        settled
        agents={[
          {
            id: "twin_health",
            name: "医疗健康协作分身",
            avatar: "🐙",
            status: "done",
            task: "回归",
            filesTouchedCount: 0,
          },
        ]}
      />,
      { queryClient: client },
    );
    expect(screen.queryByText("🐙")).not.toBeInTheDocument();
    if (avatarUrl) {
      expect(container.querySelector("img")).toHaveAttribute("src", avatarUrl);
      // Compact roster URLs are optimistic; a missing image falls back to
      // the HUB icon instead of leaving an invisible broken image.
      for (const img of container.querySelectorAll("img")) fireEvent.error(img);
    }
    expect(screen.getAllByText("🩺").length).toBeGreaterThan(0);
  },
);
