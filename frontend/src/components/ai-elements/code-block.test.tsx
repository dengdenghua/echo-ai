import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { CodeBlock, CodeBlockCopyButton } from "./code-block";

describe("CodeBlockCopyButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies through the desktop bridge when browser Clipboard API is absent", async () => {
    const writeText = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("echo", { clipboard: { writeText } });
    vi.stubGlobal("navigator", {});
    const onCopy = vi.fn();
    renderWithProviders(
      <CodeBlock code={'console.log("复制成功")'} language="ts">
        <CodeBlockCopyButton aria-label="Copy code" onCopy={onCopy} />
      </CodeBlock>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('console.log("复制成功")');
  });
  it("does not show copy actions while the code block is still streaming", () => {
    const { container } = renderWithProviders(
      <CodeBlock code={'console.log("half")'} language="ts" isStreaming>
        <CodeBlockCopyButton />
      </CodeBlock>,
    );

    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows copy actions once the code block is complete", () => {
    const { container } = renderWithProviders(
      <CodeBlock code={'console.log("done")'} language="ts">
        <CodeBlockCopyButton />
      </CodeBlock>,
    );

    expect(container.querySelector("button")).not.toBeNull();
  });
});
