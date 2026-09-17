import { Globe2Icon } from "lucide-react";
import { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AutomationTargetIcon } from "@/components/ui/automation-target-icon";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { listComputerTargets } from "@/core/computer/api";
import {
  OPEN_AUTOMATION_PREVIEW,
  toolResources,
} from "@/core/automation/references";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { LinkedFileReference } from "./linked-file-reference";

export function ToolResourceReferences({
  input,
  output,
  compact = false,
}: {
  input: unknown;
  output?: unknown;
  compact?: boolean;
}) {
  const scope = useContext(FileReferenceScope);
  const resources = useMemo(
    () =>
      toolResources(input, output).filter(
        (resource) =>
          !compact ||
          resource.kind !== "file" ||
          !/^(?:(?:plan|todos?)\.md|.*-full\.jsonl|.*\.lock)$/i.test(
            resource.path.split(/[\\/]/).pop() || "",
          ),
      ),
    [input, output, compact],
  );
  const needsIcons = resources.some(
    (r) =>
      r.kind === "app" &&
      r.target.kind === "desktop_window" &&
      !r.target.icon_url,
  );
  const targets = useQuery({
    queryKey: ["automation-window-identities"],
    queryFn: listComputerTargets,
    enabled: needsIcons,
    staleTime: 60_000,
    retry: false,
  });
  if (!resources.length) return null;
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-1.5 py-0.5"
      data-testid="tool-resource-references"
      onClick={(event) => event.stopPropagation()}
    >
      {resources.map((resource, index) => {
        if (resource.kind === "file")
          return (
            <LinkedFileReference
              key={`file:${resource.path}`}
              path={resource.path}
              lines={resource.lines}
            />
          );
        if (resource.kind === "web")
          return (
            <RoutedWebLink
              key={resource.url}
              href={resource.url}
              title={resource.url}
              openTargetSource="tool-result"
              className="inline-flex max-w-64 items-center gap-1 rounded-md bg-primary/5 px-1.5 py-0.5 text-xs text-primary underline decoration-primary/25 underline-offset-2 hover:bg-primary/10"
            >
              <Globe2Icon className="size-3 shrink-0" />
              <span className="truncate">{resource.title}</span>
            </RoutedWebLink>
          );
        const target = {
          ...resource.target,
          icon_url:
            resource.target.icon_url ||
            targets.data?.targets.find((t) => t.id === resource.target.id)
              ?.icon_url,
        };
        return (
          <button
            key={`app:${index}`}
            type="button"
            title={target.title}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(OPEN_AUTOMATION_PREVIEW, {
                  detail: { threadId: scope.threadId, target },
                }),
              )
            }
            className="inline-flex max-w-64 items-center gap-1 rounded-md bg-primary/5 px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
          >
            <AutomationTargetIcon target={target} className="size-3.5" />
            <span className="truncate">{target.title}</span>
          </button>
        );
      })}
    </span>
  );
}
