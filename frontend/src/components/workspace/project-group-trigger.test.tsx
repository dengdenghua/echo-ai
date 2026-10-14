import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Collapsible } from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ProjectGroupTrigger } from "./project-group-trigger";

function renderTrigger(props: {
  icon?: string | null;
  hasBoundFolder?: boolean;
}) {
  return render(
    <TooltipProvider>
      <Collapsible>
        <ProjectGroupTrigger
          project="秋季旅行"
          threadCount={1}
          deletable={false}
          hasBoundFolder={props.hasBoundFolder ?? false}
          icon={props.icon}
        />
      </Collapsible>
    </TooltipProvider>,
  );
}

describe("ProjectGroupTrigger", () => {
  it("draws the icon the project was created with", () => {
    const { container } = renderTrigger({ icon: "plane" });

    expect(
      container.querySelector('[data-project-icon="plane"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-project-kind]")).toBeNull();
  });

  it("keeps the folder or milestone kind for projects without one", () => {
    const milestone = renderTrigger({ icon: null });
    expect(
      milestone.container.querySelector('[data-project-kind="milestone"]'),
    ).not.toBeNull();
    milestone.unmount();

    const folder = renderTrigger({ hasBoundFolder: true });
    expect(
      folder.container.querySelector('[data-project-kind="folder"]'),
    ).not.toBeNull();
  });
});
