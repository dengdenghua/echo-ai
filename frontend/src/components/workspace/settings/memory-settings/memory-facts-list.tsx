import { PenLineIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { pathOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

import {
  confidenceToLevelKey,
  factScopeLabel,
  isThreadSource,
  truncateFactPreview,
  upperFirst,
  type MemoryFact,
} from "./memory-helpers";

export function MemoryFactsList({
  facts,
  emptyText,
  deleteDisabled,
  onEdit,
  onDelete,
}: {
  facts: MemoryFact[];
  emptyText: string;
  deleteDisabled: boolean;
  onEdit: (fact: MemoryFact) => void;
  onDelete: (fact: MemoryFact) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="text-sm font-medium mb-4">
        {t.settings.memory.markdown.facts}
      </h3>

      {facts.length === 0 ? (
        <div className="text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="divide-y">
          {facts.map((fact) => {
            const { key } = confidenceToLevelKey(fact.confidence);
            const confidenceText =
              t.settings.memory.markdown.table.confidenceLevel[key];

            return (
              <div
                key={fact.id}
                className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t.settings.memory.markdown.table.category}:{" "}
                      <span className="text-foreground">
                        {upperFirst(fact.category)}
                      </span>
                    </span>
                    <span>
                      {t.settings.memory.markdown.table.confidence}:{" "}
                      <span className="text-foreground">{confidenceText}</span>
                    </span>
                    <span>
                      {t.settings.memory.markdown.table.createdAt}:{" "}
                      <span className="text-foreground">
                        {formatTimeAgo(fact.createdAt)}
                      </span>
                    </span>
                    <span>
                      {t.settings.memory.markdown.table.source}:{" "}
                      {fact.source === "manual" ? (
                        <span className="text-foreground">
                          {t.settings.memory.manualFactSource}
                        </span>
                      ) : isThreadSource(fact.source) ? (
                        <Link
                          to={pathOfThread(fact.source)}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {t.settings.memory.markdown.table.view}
                        </Link>
                      ) : (
                        <span className="text-foreground">{fact.source}</span>
                      )}
                    </span>
                    <span>
                      {t.settings.memory.scopeLabel}:{" "}
                      <span className="text-foreground">
                        {factScopeLabel(fact, t)}
                      </span>
                    </span>
                  </div>
                  <p className="text-sm break-words">{fact.content}</p>
                </div>

                <div className="flex shrink-0 items-center gap-1 self-start sm:ml-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => onEdit(fact)}
                    disabled={deleteDisabled}
                    title={t.common.edit}
                    aria-label={`${t.common.edit}: ${truncateFactPreview(fact.content, 60)}`}
                  >
                    <PenLineIcon className="size-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => onDelete(fact)}
                    disabled={deleteDisabled}
                    title={t.common.delete}
                    aria-label={`${t.common.delete}: ${truncateFactPreview(fact.content, 60)}`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
