import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import * as clipboard from "@/core/clipboard";
import {
  BROADCAST_DELIVERY_PREFIX,
  BROADCAST_DELIVERY_SUFFIX,
  BROADCAST_PROGRESS_PREFIX,
  BROADCAST_PROGRESS_SUFFIX,
  DECISION_MARKER,
  MERGE_MARKER,
  parseCollaborationLandmark,
  ProjectCollaborationLandmark,
} from "./project-collaboration-landmark";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

describe("ProjectCollaborationLandmark", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    vi.restoreAllMocks();
  });

  describe("parseCollaborationLandmark", () => {
    it("parses project decision text correctly", () => {
      const text = "🏛️ [项目决策固化] 采纳并列协作者【架构师】方案：\n采用微服务拆分";
      const match = parseCollaborationLandmark(text);
      expect(match).not.toBeNull();
      expect(match?.kind).toBe("decision");
      expect(match?.body).toContain("采用微服务拆分");
      expect(match?.body).not.toContain("[项目决策固化]");
    });

    it("parses spike sandbox text correctly", () => {
      const text = "🌱 【方案推演沙盒】针对并列协作者【测试员】开展推演";
      const match = parseCollaborationLandmark(text);
      expect(match).not.toBeNull();
      expect(match?.kind).toBe("sandbox");
      expect(match?.body).toContain("开展推演");
    });

    it("parses collaborator broadcast deliverable correctly", () => {
      const text = "📢 来自并列协作者【算法工程师】的阶段交付：\n模型收敛达标";
      const match = parseCollaborationLandmark(text);
      expect(match).not.toBeNull();
      expect(match?.kind).toBe("broadcast");
      expect(match?.body).toBe("模型收敛达标");
      expect(match?.broadcast).toEqual({
        agentName: "算法工程师",
        phase: "delivery",
      });
    });

    it("parses merge conclusion text correctly", () => {
      const text = "🏛️ [推演结论合并] 方案经 POC 验证成立，合入主干";
      const match = parseCollaborationLandmark(text);
      expect(match).not.toBeNull();
      expect(match?.kind).toBe("merge");
      expect(match?.body).toContain("方案经 POC 验证成立");
    });

    it("reads back every header the writers produce", () => {
      expect(
        parseCollaborationLandmark(`${DECISION_MARKER} Adopted plan\n\nShip it`),
      ).toMatchObject({ kind: "decision", body: "Adopted plan\n\nShip it" });
      expect(
        parseCollaborationLandmark(`${MERGE_MARKER} merged`),
      ).toMatchObject({ kind: "merge", body: "merged" });
      expect(
        parseCollaborationLandmark(
          `${BROADCAST_DELIVERY_PREFIX}Eve${BROADCAST_DELIVERY_SUFFIX}\n\nDone`,
        ),
      ).toEqual({
        kind: "broadcast",
        body: "Done",
        broadcast: { agentName: "Eve", phase: "delivery" },
      });
      expect(
        parseCollaborationLandmark(
          `${BROADCAST_PROGRESS_PREFIX}Eve${BROADCAST_PROGRESS_SUFFIX}\nDraft`,
        ),
      ).toEqual({
        kind: "broadcast",
        body: "Draft",
        broadcast: { agentName: "Eve", phase: "progress" },
      });
    });

    it("returns null for normal conversational text", () => {
      expect(parseCollaborationLandmark("普通对话消息")).toBeNull();
      expect(parseCollaborationLandmark("/project run")).toBeNull();
    });
  });

  describe("Card rendering & interactions", () => {
    it("renders decision landmark card and allows copying content", async () => {
      const copySpy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue(true);
      const text = "🏛️ [项目决策固化] 采纳方案：全员采用 TypeScript";
      const match = parseCollaborationLandmark(text)!;

      renderWithProviders(
        <ProjectCollaborationLandmark
          match={match}
          rawContent={text}
          renderBody={(body) => <p>{body}</p>}
        />,
        { locale: "zh-CN" },
      );

      expect(screen.getByTestId("landmark-decision-card")).toBeInTheDocument();
      expect(screen.getByText("项目核心决策固化")).toBeInTheDocument();
      expect(screen.getByText("已沉淀至事实库")).toBeInTheDocument();
      expect(screen.getByText(/全员采用 TypeScript/)).toBeInTheDocument();

      const copyBtn = screen.getByRole("button", { name: /复制决策内容/ });
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(copySpy).toHaveBeenCalledWith(text);
    });

    it("renders sandbox landmark card and allows entering sandbox thread", () => {
      const text = "🌱 【方案推演沙盒】针对并列协作者【专家】验证 POC";
      const match = parseCollaborationLandmark(text)!;

      renderWithProviders(
        <ProjectCollaborationLandmark
          match={match}
          rawContent={text}
          renderBody={(body) => <p>{body}</p>}
        />,
        { locale: "zh-CN" },
      );

      expect(screen.getByTestId("landmark-sandbox-card")).toBeInTheDocument();
      expect(screen.getByText("方案推演沙盒")).toBeInTheDocument();
      expect(screen.getByText("POC 隔离验证")).toBeInTheDocument();

      const enterBtn = screen.getByRole("button", { name: "进入推演沙盒" });
      fireEvent.click(enterBtn);

      expect(mocks.navigate).toHaveBeenCalledOnce();
      const calledUrl = mocks.navigate.mock.calls[0][0];
      expect(calledUrl).toContain("/workspace/realtime/new?");
      expect(calledUrl).toContain("sandbox=true");
    });

    it("renders merge landmark card and allows copying conclusion", async () => {
      const copySpy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue(true);
      const text = "🏛️ [推演结论合并] 方案 POC 验证通过，准予合入主干";
      const match = parseCollaborationLandmark(text)!;

      renderWithProviders(
        <ProjectCollaborationLandmark
          match={match}
          rawContent={text}
          renderBody={(body) => <p>{body}</p>}
        />,
        { locale: "zh-CN" },
      );

      expect(screen.getByTestId("landmark-merge-card")).toBeInTheDocument();
      expect(screen.getByText("沙盒推演结论合入主干")).toBeInTheDocument();
      expect(screen.getByText("已合入主项目")).toBeInTheDocument();
      expect(screen.getByText(/方案 POC 验证通过/)).toBeInTheDocument();

      const copyBtn = screen.getByRole("button", { name: /复制推演结论/ });
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(copySpy).toHaveBeenCalledWith(text);
    });

    it("renders broadcast landmark card", () => {
      const text = "📢 来自并列协作者【测试专家】的阶段交付：自动化全通过";
      const match = parseCollaborationLandmark(text)!;

      renderWithProviders(
        <ProjectCollaborationLandmark
          match={match}
          rawContent={text}
          renderBody={(body) => <p>{body}</p>}
        />,
        { locale: "zh-CN" },
      );

      expect(screen.getByTestId("landmark-broadcast-card")).toBeInTheDocument();
      expect(screen.getByText("协作者阶段成果广播")).toBeInTheDocument();
      expect(screen.getByText("已同步至群公共")).toBeInTheDocument();
      expect(
        screen.getByText("来自并列协作者【测试专家】的阶段交付："),
      ).toBeInTheDocument();
      expect(screen.getByText("自动化全通过")).toBeInTheDocument();
    });

    it("shows the protocol header in the UI language", () => {
      const text = "📢 来自并列协作者【测试专家】的阶段交付：自动化全通过";

      renderWithProviders(
        <ProjectCollaborationLandmark
          match={parseCollaborationLandmark(text)!}
          rawContent={text}
          renderBody={(body) => <p>{body}</p>}
        />,
      );

      expect(screen.getByText("Collaborator update")).toBeInTheDocument();
      expect(
        screen.getByText("Interim delivery from 测试专家:"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/并列协作者/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy results" }),
      ).toBeInTheDocument();
    });
  });
});
