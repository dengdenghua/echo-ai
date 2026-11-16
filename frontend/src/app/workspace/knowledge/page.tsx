import { useState } from "react";
import { BrainIcon, FileTextIcon, NetworkIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { KnowledgeGraphPanel } from "@/components/workspace/knowledge-graph-panel";
import { MemoryAssetsPanel } from "@/components/workspace/memory-assets-panel";
import { WikiPanel } from "@/components/workspace/wiki-panel";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";

export default function KnowledgePage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("graph");
  const tabs = [
    { value: "graph", icon: NetworkIcon, label: t.knowledgeGraph.graph },
    { value: "memory", icon: BrainIcon, label: t.evolutionDashboard.memories },
    { value: "wiki", icon: FileTextIcon, label: "Wiki" },
  ] as const;
  const selectTab = (value: string) => {
    setActiveTab(value);
    requestAnimationFrame(() => {
      document.getElementById(`knowledge-tab-${value}`)?.focus();
    });
  };
  return (
    <WorkspaceContainer>
      <WorkspaceBody>
        <div className="flex h-full min-h-0 w-full flex-col bg-card">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted px-3">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">知识库</h1>
              <div className="truncate text-xs text-muted-foreground">
                实体、关系与本地记忆
              </div>
            </div>
            <div
              role="tablist"
              aria-label="知识库视图"
              className="flex h-8 items-center gap-0.5 rounded-md bg-transparent p-0"
            >
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    id={`knowledge-tab-${tab.value}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`knowledge-panel-${tab.value}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveTab(tab.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                        return;
                      }
                      event.preventDefault();
                      const offset = event.key === "ArrowRight" ? 1 : -1;
                      selectTab(
                        tabs[(index + offset + tabs.length) % tabs.length]!.value,
                      );
                    }}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "bg-background text-foreground shadow-[var(--shadow-xs)]"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-0 bg-card p-3">
            {tabs.map((tab) => (
              <div
                key={tab.value}
                id={`knowledge-panel-${tab.value}`}
                role="tabpanel"
                aria-labelledby={`knowledge-tab-${tab.value}`}
                hidden={activeTab !== tab.value}
                className="h-full"
              >
                {activeTab === "graph" && tab.value === "graph" && (
                  <KnowledgeGraphPanel />
                )}
                {activeTab === "memory" && tab.value === "memory" && (
                  <MemoryAssetsPanel />
                )}
                {activeTab === "wiki" && tab.value === "wiki" && <WikiPanel />}
              </div>
            ))}
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
