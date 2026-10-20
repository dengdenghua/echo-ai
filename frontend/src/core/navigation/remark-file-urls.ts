import { parseWorkspaceOutputRef } from "@/core/artifacts/utils";
import { parseFileReference } from "./file-reference";
import { encodeMarkdownFileURL } from "./markdown-file-url";

interface MarkdownNode {
  type: string;
  url?: string;
  children?: MarkdownNode[];
}

/** Preserve only recognized file URLs before the HTML/URL sanitizers run. */
export function remarkFileURLs() {
  return function transform(node: MarkdownNode) {
    if (
      (node.type === "link" ||
        node.type === "image" ||
        node.type === "definition") &&
      node.url &&
      /^(?:[a-z]:[\\/]|file:\/\/\/|workspace-output:)/i.test(node.url) &&
      (parseFileReference(node.url) || parseWorkspaceOutputRef(node.url))
    ) {
      node.url = encodeMarkdownFileURL(node.url);
    }
    node.children?.forEach(transform);
  };
}
