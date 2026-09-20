import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness";

import { ProjectCommandContent } from "./project-command-content";

describe("sent project commands", () => {
  it("shows an icon for a command-only message", () => {
    const { container } = renderWithProviders(
      <ProjectCommandContent content="/project run" renderBody={(body) => <p>{body}</p>} />,
    );
    expect(screen.getByText("/project run")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps command arguments available to the normal message renderer", () => {
    renderWithProviders(<ProjectCommandContent content={"/project run\n发布准备"} renderBody={(body) => <p>{body}</p>} />);
    expect(screen.getByText("发布准备")).toBeInTheDocument();
    expect(screen.getByText("/project run")).toBeInTheDocument();
  });

  it.each(["解释 /project run", "```\n/project run\n```", "/projects run"])(
    "leaves ordinary text and code unchanged: %s", (content) => {
      const { container } = renderWithProviders(<ProjectCommandContent content={content} renderBody={(body) => <p>{body}</p>} />);
      expect(container.querySelector("p")?.textContent).toBe(content);
      expect(container.querySelector("svg")).toBeNull();
    },
  );

  it("renders project decision landmark card when content starts with 🏛️ [项目决策固化]", () => {
    renderWithProviders(
      <ProjectCommandContent
        content={"🏛️ [项目决策固化] 采纳微服务拆分方案\n详细架构文档已就绪"}
        renderBody={(body) => <p>{body}</p>}
      />,
    );
    expect(screen.getByTestId("landmark-decision-card")).toBeInTheDocument();
    expect(screen.getByText("项目核心决策固化")).toBeInTheDocument();
    expect(screen.getByText("已沉淀至事实库")).toBeInTheDocument();
  });

  it("renders sandbox landmark card when content starts with 🌱 【方案推演沙盒】", () => {
    renderWithProviders(
      <ProjectCommandContent
        content={"🌱 【方案推演沙盒】针对并列协作者方案开启推演"}
        renderBody={(body) => <p>{body}</p>}
      />,
    );
    expect(screen.getByTestId("landmark-sandbox-card")).toBeInTheDocument();
    expect(screen.getByText("方案推演沙盒")).toBeInTheDocument();
    expect(screen.getByText("进入推演沙盒")).toBeInTheDocument();
  });
});
