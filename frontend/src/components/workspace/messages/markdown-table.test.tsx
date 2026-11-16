import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { FileReferenceChip } from "@/components/ui/file-reference-chip";
import { MarkdownTable, serializeTable } from "./markdown-table";

afterEach(() => vi.unstubAllGlobals());

it("escapes table separators and preserves CSV quotes and multiline cells", () => {
  const rows = [
    ["名称", "值"],
    ["A|B", '一行\n"二行"'],
  ];
  expect(serializeTable(rows, "markdown")).toBe(
    '| 名称 | 值 |\n| --- | --- |\n| A\\|B | 一行<br>"二行" |',
  );
  expect(serializeTable(rows, "csv")).toBe(
    '"名称","值"\r\n"A|B","一行\n""二行"""',
  );
});

it("copies through the desktop bridge while preserving complete file references", async () => {
  const writeText = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("echo", { clipboard: { writeText } });
  renderWithProviders(
    <MarkdownTable>
      <thead>
        <tr>
          <th>路径</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <FileReferenceChip path="output/final/report.md" />
            <br />
            已验证
          </td>
        </tr>
      </tbody>
    </MarkdownTable>,
    { locale: "zh-CN" },
  );
  const scroller = screen.getByRole("region", { name: "表格内容" });
  expect(scroller).toHaveAttribute("tabindex", "0");
  expect(scroller).not.toContainElement(
    screen.getByRole("button", { name: "复制到剪贴板 (Markdown)" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "复制到剪贴板 (Markdown)" }),
  );
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      "| 路径 |\n| --- |\n| output/final/report.md<br>已验证 |",
    ),
  );
  expect(
    await screen.findByRole("button", { name: "已复制到剪贴板" }),
  ).toBeEnabled();
});

it("disables incomplete table actions until streaming has settled", () => {
  const table = (isStreaming: boolean) => (
    <MarkdownTable isStreaming={isStreaming}>
      <tbody>
        <tr>
          <td>结果</td>
        </tr>
      </tbody>
    </MarkdownTable>
  );
  const view = renderWithProviders(table(true), { locale: "zh-CN" });
  expect(
    screen.getByRole("button", { name: "复制到剪贴板 (Markdown)" }),
  ).toBeDisabled();
  view.rerender(table(false));
  expect(
    screen.getByRole("button", { name: "复制到剪贴板 (Markdown)" }),
  ).toBeEnabled();
});
