/**
 * Evolution control panel — companion to EvolutionDashboard.
 *
 * The dashboard shows "what the agent learned". This panel surfaces
 * the seven new backend control surfaces added in the recent evolution
 * overhaul:
 *
 *  1. Budget + circuit breakers   (GET /api/evolution/budget/snapshot)
 *  2. Skill proposals from intel  (GET /api/intel-evolution/skills/proposals)
 *  3. Model proposals             (GET /api/intel-evolution/models/proposals)
 *  4. MCP proposals               (GET /api/intel-evolution/mcp/proposals)
 *  5. Curriculum goals            (GET /api/evolution/curriculum/goals)
 *  6. Framework benchmarks        (GET /api/intel-evolution/frameworks/benchmarks)
 *  7. Protocol drift + repair     (GET /api/intel-evolution/protocols/drift,
 *                                  GET /api/intel-evolution/protocols/repair/proposals)
 *  plus the A/B dispatch snapshot (GET /api/evolution/dispatch/snapshot)
 *
 * All UI is intentionally functional rather than polished — the
 * existing EvolutionDashboard is the primary narrative surface; this
 * panel is the operator console.
 */

import { CheckCircle2Icon } from "lucide-react";
import { useState } from "react";

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { BudgetSection } from "./budget-section";
import {
  CurriculumSection,
  FrameworkBenchmarksSection,
} from "./curriculum-benchmark-sections";
import { DispatchSection } from "./dispatch-section";
import {
  McpProposalsSection,
  ModelProposalsSection,
  SkillProposalsSection,
} from "./proposal-sections";
import { ProtocolDriftSection } from "./protocol-drift-section";
import type { EvolutionApi } from "./types";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getBackendBaseURL()}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBackendBaseURL()}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

const evolutionApi: EvolutionApi = { get: apiGet, post: apiPost };

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type SectionKey =
  | "budget"
  | "skill_proposals"
  | "models"
  | "mcp"
  | "curriculum"
  | "frameworks"
  | "drift"
  | "dispatch";

const SECTION_ORDER: SectionKey[] = [
  "budget",
  "skill_proposals",
  "models",
  "mcp",
  "curriculum",
  "frameworks",
  "drift",
  "dispatch",
];

export function EvolutionControlPanel() {
  const { t } = useI18n();
  const [active, setActive] = useState<SectionKey>("budget");

  const sectionLabels: Record<SectionKey, string> = {
    budget: t.evolutionControl.sections.budget,
    skill_proposals: t.evolutionControl.sections.skillProposals,
    models: t.evolutionControl.sections.models,
    mcp: t.evolutionControl.sections.mcp,
    curriculum: t.evolutionControl.sections.curriculum,
    frameworks: t.evolutionControl.sections.frameworks,
    drift: t.evolutionControl.sections.drift,
    dispatch: t.evolutionControl.sections.dispatch,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-border-default pb-2 text-xs">
        <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground">
          <CheckCircle2Icon className="size-3.5" />
          {t.evolutionControl.panelTitle}
        </div>
        <div
          className="ml-4 flex flex-wrap gap-1"
          role="group"
          aria-label={t.evolutionControl.panelTitle}
        >
          {SECTION_ORDER.map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setActive(k)}
              aria-pressed={active === k}
              className={cn(
                "rounded-lg px-3 py-1 text-xs transition-colors",
                active === k
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {sectionLabels[k]}
            </button>
          ))}
        </div>
      </div>

      {active === "budget" && <BudgetSection api={evolutionApi} />}
      {active === "skill_proposals" && (
        <SkillProposalsSection api={evolutionApi} />
      )}
      {active === "models" && <ModelProposalsSection api={evolutionApi} />}
      {active === "mcp" && <McpProposalsSection api={evolutionApi} />}
      {active === "curriculum" && <CurriculumSection api={evolutionApi} />}
      {active === "frameworks" && (
        <FrameworkBenchmarksSection api={evolutionApi} />
      )}
      {active === "drift" && <ProtocolDriftSection api={evolutionApi} />}
      {active === "dispatch" && <DispatchSection api={evolutionApi} />}
    </div>
  );
}

export default EvolutionControlPanel;
