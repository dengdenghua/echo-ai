import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

const artifact = vi.hoisted(() => ({ content: "" }));

vi.mock("@/core/artifacts/hooks", () => ({
  useArtifactContent: () => ({
    content: artifact.content,
    error: null,
    isLoading: false,
    url: undefined,
    refetch: () => undefined,
  }),
}));

vi.mock("@/components/workspace/artifacts/artifact-file-detail", () => ({
  HtmlPreview: () => <div data-testid="html-preview" />,
  OfficePreview: () => <div data-testid="office-preview" />,
}));

vi.mock("@/components/workspace/code-editor", () => ({
  CodeEditor: (props: {
    value: string;
    readonly?: boolean;
    filePath?: string;
    syntaxPath?: string;
  }) => (
    <pre
      data-testid="code-editor"
      data-readonly={String(Boolean(props.readonly))}
      data-file-path={props.filePath ?? ""}
      data-syntax-path={props.syntaxPath ?? ""}
      data-length={props.value.length}
    >
      {props.value.slice(0, 80)}
    </pre>
  ),
}));

import { PreviewPane } from "./artifact-inline-preview";

function renderPreview(filepath: string) {
  return renderWithProviders(
    <PreviewPane
      filepath={filepath}
      onBack={() => undefined}
      streamdownPlugins={{ remarkPlugins: [], rehypePlugins: [] }}
      threadId="thread-1"
    />,
    { locale: "zh-CN" },
  );
}

beforeEach(() => {
  artifact.content = "";
});

it("shows a produced Python file as read-only highlighted code", async () => {
  artifact.content = 'print("hello")\n';
  renderPreview("workspace-output:final:hello.py");

  const editor = await screen.findByTestId("code-editor");
  expect(editor).toHaveTextContent('print("hello")');
  expect(editor).toHaveAttribute("data-readonly", "true");
  // Highlighting only: no save / code-intelligence path for a preview.
  expect(editor).toHaveAttribute("data-syntax-path", "hello.py");
  expect(editor).toHaveAttribute("data-file-path", "");
  expect(screen.queryByText("此文件类型暂不支持预览")).not.toBeInTheDocument();
});

it.each(["config.yaml", "run.log", "notes.txt", "pyproject.toml", "app.ts"])(
  "previews %s as text instead of the unsupported notice",
  async (name) => {
    artifact.content = "a: 1";
    renderPreview(`workspace-output:final:${name}`);
    expect(await screen.findByTestId("code-editor")).toHaveTextContent("a: 1");
  },
);

it("caps a large text file and says so", async () => {
  artifact.content = "x".repeat(200 * 1024 + 50);
  renderPreview("workspace-output:final:big.log");

  expect(await screen.findByTestId("code-editor")).toHaveAttribute(
    "data-length",
    String(200 * 1024),
  );
  expect(screen.getByText(/仅显示前 200 KB/)).toBeInTheDocument();
});

it("keeps the unsupported notice for binary files", () => {
  renderPreview("workspace-output:final:photo.png");
  expect(screen.getByText("此文件类型暂不支持预览")).toBeInTheDocument();
  expect(screen.queryByTestId("code-editor")).not.toBeInTheDocument();
});
