import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

const artifact = vi.hoisted(() => ({
  content: "",
  files: [] as string[],
  selected: null as string | null,
  select: vi.fn(),
  clearSelection: vi.fn(),
}));
vi.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => ({
    artifacts: [...artifact.files],
    selectedArtifact: artifact.selected,
    select: artifact.select,
    clearSelection: artifact.clearSelection,
  }),
}));

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

import {
  ArtifactInlinePreviewEmbedded,
  PreviewPane,
} from "./artifact-inline-preview";

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
  artifact.files = [];
  artifact.select.mockClear();
  artifact.selected = null;
  artifact.clearSelection.mockReset().mockImplementation(() => {
    artifact.selected = null;
  });
});

it("stays on the list after returning from an externally selected file across artifact refreshes", () => {
  artifact.files = ["workspace-output:final:check.txt"];
  artifact.selected = artifact.files[0]!;
  const view = renderWithProviders(
    <ArtifactInlinePreviewEmbedded threadId="thread-1" />,
    { locale: "zh-CN" },
  );
  fireEvent.click(screen.getByRole("button", { name: "返回", exact: true }));
  view.rerender(<ArtifactInlinePreviewEmbedded threadId="thread-1" />);
  expect(artifact.clearSelection).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "check.txt" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "返回", exact: true }),
  ).not.toBeInTheDocument();
});

it("distinguishes same-name artifacts by directory and opens the selected reference", () => {
  artifact.files = [
    "workspace-output:final:reports/check.txt",
    "workspace-output:final:review/check.txt",
  ];
  renderWithProviders(<ArtifactInlinePreviewEmbedded threadId="thread-1" />);
  expect(
    screen.getByRole("button", { name: "reports/check.txt" }),
  ).toHaveAttribute("title", "reports/check.txt");
  fireEvent.click(screen.getByRole("button", { name: "review/check.txt" }));
  expect(artifact.select).toHaveBeenCalledWith(
    "workspace-output:final:review/check.txt",
  );
  expect(screen.getByTitle("review/check.txt")).toHaveTextContent("check.txt");
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
