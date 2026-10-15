/* Implementation note. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BrainIcon,
  NetworkIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authHeaders } from "@/core/auth/api";
import { useGlobalControlPlaneAccess } from "@/core/auth/use-control-plane-access";
import { useI18n } from "@/core/i18n/hooks";
import { knowledgeMapCopy } from "@/core/i18n/locales/knowledge-map";
import {
  GlobalControlPlaneAccessError,
  requireGlobalControlPlaneResponse,
  scopedControlPlaneUrl,
} from "@/core/observability/api";
import { KnowledgeGraphView } from "./knowledge-graph-view";
import { serviceErrorMessage } from "@/core/utils/service-error";
import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import { categoricalSlot, categoricalVar } from "@/lib/categorical-palette";

interface KGEntity {
  id: string;
  name: string;
  entity_type: string;
  description: string;
}

interface KGRelationship {
  id: string;
  source_name: string;
  target_name: string;
  relationship_type: string;
}

interface GraphStats {
  total_entities: number;
  total_relationships: number;
  entity_types: Record<string, number>;
}

export function KnowledgeGraphPanel() {
  const { t, locale } = useI18n();
  const copy = knowledgeMapCopy(locale);
  // With the cross-tenant scope the panel shows everyone's graph; any other
  // account reads its own tenant/owner partition (AI-29).
  const globalView = useGlobalControlPlaneAccess();
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [relationships, setRelationships] = useState<KGRelationship[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"map" | "graph" | "list">("map");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [entitiesRes, statsRes] = await Promise.all([
        fetch(
          scopedControlPlaneUrl("/api/knowledge/graph?limit=100", globalView),
          { headers: authHeaders() },
        ),
        fetch(scopedControlPlaneUrl("/api/knowledge/stats", globalView), {
          headers: authHeaders(),
        }),
      ]);

      await requireGlobalControlPlaneResponse(
        entitiesRes,
        "Failed to fetch knowledge graph",
      );
      await requireGlobalControlPlaneResponse(
        statsRes,
        "Failed to fetch knowledge graph stats",
      );

      const entitiesData = await entitiesRes.json();
      const statsData = await statsRes.json();

      setEntities(entitiesData.entities || []);
      setRelationships(entitiesData.relationships || []);
      setStats(statsData);
    } catch (err) {
      const message =
        err instanceof GlobalControlPlaneAccessError
          ? t.observabilityPage.crossTenantAdminRequired
          : serviceErrorMessage(err);
      setLoadError(message);
      // A permission gate is expected for ordinary tenant operators. Keep it
      // as stable panel state instead of producing a toast/error loop.
      if (!(err instanceof GlobalControlPlaneAccessError)) {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [globalView, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const trimmedSearchQuery = searchQuery.trim();
  const filteredEntities = useMemo(() => {
    const q = trimmedSearchQuery.toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (entity) =>
        entity.name.toLowerCase().includes(q) ||
        entity.description.toLowerCase().includes(q) ||
        entity.entity_type.toLowerCase().includes(q),
    );
  }, [entities, trimmedSearchQuery]);

  if (loading) {
    return (
      <BrandLoadingPanel
        label={t.common.loading}
        hideLabel
        className="h-64 min-h-0"
      />
    );
  }

  if (loadError) {
    return (
      <div
        className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-border-default/70 px-6 py-10 text-center"
        role="status"
      >
        <BrainIcon className="size-5 text-muted-foreground" />
        <p className="max-w-lg text-sm text-muted-foreground">{loadError}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadData()}
        >
          <RefreshCwIcon className="mr-1.5 size-3.5" />
          {t.knowledgeGraph.refresh}
        </Button>
      </div>
    );
  }

  // Empty state · KG booted fresh with zero entities. Without this
  // the page renders 3 zero-count cards + an empty list · no hint
  // that the extractor hasn't had source material yet.
  if (entities.length === 0 && relationships.length === 0 && !searchQuery) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <div className="rounded-lg bg-muted p-3 text-muted-foreground">
          <BrainIcon className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="font-medium">{t.knowledgeGraph.emptyStateTitle}</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild size="sm">
            <Link to="/workspace/realtime/new">
              {t.knowledgeGraph.startTask}
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
          >
            <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
            {t.knowledgeGraph.refresh}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Implementation note. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("map")}
          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "map" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
        >
          <NetworkIcon className="mr-1 inline size-3.5" />
          {copy.mapView}
        </button>
        <button
          type="button"
          onClick={() => setViewMode("graph")}
          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "graph" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
        >
          <NetworkIcon className="mr-1 inline size-3.5" />
          {t.knowledgePanel.graphView}
        </button>
        <button
          type="button"
          onClick={() => setViewMode("list")}
          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
        >
          <BrainIcon className="mr-1 inline size-3.5" />
          {t.knowledgePanel.listView}
        </button>
        {viewMode !== "graph" && (
          <div className="relative order-last w-full sm:order-none sm:ml-auto sm:w-52">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={copy.findNodeLabel}
              placeholder={copy.findNode}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-7 rounded-md pl-8 text-xs"
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => void loadData()}
          aria-label={t.knowledgeGraph.refresh}
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>

      {viewMode === "map" ? (
        <KnowledgeRelationMap
          entities={entities}
          relationships={relationships}
          searchQuery={searchQuery}
        />
      ) : viewMode === "graph" ? (
        <KnowledgeGraphView />
      ) : (
        <>
          {/* Implementation note. */}
          {stats && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.knowledgeGraph.totalEntities}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {stats.total_entities}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.knowledgeGraph.totalRelationships}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {stats.total_relationships}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {t.knowledgeGraph.entityTypesCount}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {Object.keys(stats.entity_types).length}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Implementation note. */}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {trimmedSearchQuery
                ? t.knowledgeGraph.foundEntities(
                    filteredEntities.length,
                    entities.length,
                  )
                : t.knowledgeGraph.totalEntitiesCount(entities.length)}
            </span>
            {trimmedSearchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setSearchQuery("")}
              >
                {t.knowledgeGraph.clearSearch}
              </Button>
            )}
          </div>

          {/* Implementation note. */}
          {filteredEntities.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {filteredEntities.map((entity) => (
                <Card key={entity.id}>
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-center gap-2">
                      <BrainIcon className="h-4 w-4 text-primary" />
                      <CardTitle className="text-base">{entity.name}</CardTitle>
                    </div>
                    <Badge variant="secondary">{entity.entity_type}</Badge>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {entity.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border-default bg-muted/20 px-4 py-10 text-center">
              <SearchIcon className="mx-auto mb-2 size-5 text-muted-foreground" />
              <div className="text-sm font-medium">
                {t.knowledgeGraph.noMatchingEntities}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.knowledgeGraph.noMatchingEntitiesHint}
              </p>
            </div>
          )}

          {/* Implementation note. */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <NetworkIcon className="h-5 w-5 text-primary" />
              {t.knowledgeGraph.relationshipsHeader}
            </h3>
            <div className="space-y-2">
              {relationships.slice(0, 20).map((rel) => (
                <div
                  key={rel.id}
                  className="flex items-center gap-2 rounded-md border p-2.5"
                >
                  <span className="font-medium">{rel.source_name}</span>
                  <Badge variant="outline">{rel.relationship_type}</Badge>
                  <span className="font-medium">{rel.target_name}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function KnowledgeRelationMap({
  entities,
  relationships,
  searchQuery,
}: {
  entities: KGEntity[];
  relationships: KGRelationship[];
  searchQuery: string;
}) {
  const { t, locale } = useI18n();
  const copy = knowledgeMapCopy(locale);
  const entityTypeNames: Record<string, string> = t.knowledgePanel.entityTypes;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [localDepth, setLocalDepth] = useState<0 | 1 | 2>(0);
  const [hideOrphans, setHideOrphans] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [entityType, setEntityType] = useState("all");
  const degree = new Map<string, number>();
  relationships.forEach((relationship) => {
    degree.set(
      relationship.source_name,
      (degree.get(relationship.source_name) ?? 0) + 1,
    );
    degree.set(
      relationship.target_name,
      (degree.get(relationship.target_name) ?? 0) + 1,
    );
  });
  const entityTypes = [
    ...new Set(entities.map((node) => node.entity_type).filter(Boolean)),
  ].sort();
  const rankedNodes = [...entities]
    .filter((node) => entityType === "all" || node.entity_type === entityType)
    .filter((node) => !hideOrphans || (degree.get(node.name) ?? 0) > 0)
    .sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))
    .slice(0, 30);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMatchId = normalizedSearchQuery
    ? rankedNodes.find(
        (node) =>
          node.name.toLowerCase().includes(normalizedSearchQuery) ||
          node.description.toLowerCase().includes(normalizedSearchQuery),
      )?.id
    : undefined;
  useEffect(() => {
    if (!normalizedSearchQuery) {
      setLocalDepth(0);
      return;
    }
    if (searchMatchId) {
      setSelectedNodeId(searchMatchId);
      setLocalDepth(1);
    }
  }, [normalizedSearchQuery, searchMatchId]);
  const selectedNode =
    rankedNodes.find((node) => node.id === selectedNodeId) ?? rankedNodes[0];
  const visibleNames = new Set<string>();
  if (localDepth > 0 && selectedNode) {
    visibleNames.add(selectedNode.name);
    let frontier = new Set([selectedNode.name]);
    for (let depth = 0; depth < localDepth; depth += 1) {
      const next = new Set<string>();
      relationships.forEach((relationship) => {
        if (frontier.has(relationship.source_name))
          next.add(relationship.target_name);
        if (frontier.has(relationship.target_name))
          next.add(relationship.source_name);
      });
      next.forEach((name) => visibleNames.add(name));
      frontier = next;
    }
  }
  const localNodes = rankedNodes.filter((node) => visibleNames.has(node.name));
  const nodes =
    localDepth === 0 || !selectedNode
      ? rankedNodes
      : [
          selectedNode,
          ...localNodes.filter((node) => node.id !== selectedNode.id),
        ];
  const nodePositions = nodes.map((node, index) => {
    if (index === 0) return { node, point: { x: 500, y: 280 }, rank: index };
    const ring = index <= 8 ? 1 : index <= 20 ? 2 : 3;
    const ringStart = ring === 1 ? 1 : ring === 2 ? 9 : 21;
    const ringCount =
      ring === 1
        ? Math.min(8, nodes.length - 1)
        : ring === 2
          ? Math.min(12, Math.max(0, nodes.length - 9))
          : Math.max(1, nodes.length - 21);
    const angle =
      ((index - ringStart) / Math.max(ringCount, 1)) * Math.PI * 2 -
      Math.PI / 2;
    const radius = ring === 1 ? 118 : ring === 2 ? 218 : 300;
    return {
      node,
      point: {
        x: 500 + Math.cos(angle) * radius,
        y: 280 + Math.sin(angle) * radius * 0.72,
      },
      rank: index,
    };
  });
  const positions = new Map(
    nodePositions.flatMap(({ node, point }) => [
      [node.id, point],
      [node.name, point],
    ]),
  );
  const visibleRelationships = relationships
    .filter(
      (relationship) =>
        positions.has(relationship.source_name) &&
        positions.has(relationship.target_name),
    )
    .slice(0, 90);
  const activeNode =
    rankedNodes.find((node) => node.id === hoveredNodeId) ?? selectedNode;
  const activeNeighbors = new Set<string>();
  if (activeNode) {
    relationships.forEach((relationship) => {
      if (relationship.source_name === activeNode.name)
        activeNeighbors.add(relationship.target_name);
      if (relationship.target_name === activeNode.name)
        activeNeighbors.add(relationship.source_name);
    });
  }
  const labelFor = (name: string) =>
    name
      .replace(/^https?:\/\//, "")
      .split("/")[0]!
      .slice(0, 14);
  const typeLabelFor = (type: string) => entityTypeNames[type] ?? type;
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-[var(--echo-surface-sunken)]">
      <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-1 rounded-md sm:left-auto border border-border bg-popover/85 p-1 text-mini text-muted-foreground backdrop-blur-md">
        <select
          aria-label={copy.filterByType}
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          className="h-6 max-w-28 rounded border-0 bg-muted px-1.5 text-mini text-foreground outline-none"
        >
          <option value="all">{copy.allTypes}</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {typeLabelFor(type)}
            </option>
          ))}
        </select>
        <span className="mx-0.5 h-4 w-px bg-border" />
        {(
          [
            [0, copy.depthGlobal],
            [1, copy.depthLocal(1)],
            [2, copy.depthLocal(2)],
          ] as const
        ).map(([depth, label]) => (
          <button
            key={depth}
            type="button"
            onClick={() => setLocalDepth(depth)}
            className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${localDepth === depth ? "bg-foreground text-background" : "hover:bg-muted hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        <button
          type="button"
          aria-pressed={hideOrphans}
          onClick={() => setHideOrphans((value) => !value)}
          className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${hideOrphans ? "bg-muted text-foreground" : "hover:bg-muted hover:text-foreground"}`}
        >
          {copy.hideOrphans}
        </button>
        <button
          type="button"
          aria-pressed={showArrows}
          onClick={() => setShowArrows((value) => !value)}
          className={`whitespace-nowrap rounded px-2 py-1 transition-colors ${showArrows ? "bg-muted text-foreground" : "hover:bg-muted hover:text-foreground"}`}
        >
          {copy.showDirection}
        </button>
      </div>
      {nodes.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
          {copy.noRelations}
        </div>
      ) : (
        <svg
          viewBox="0 0 1000 560"
          className="h-[min(62vh,560px)] w-full"
          role="img"
          aria-label={copy.mapLabel}
        >
          <defs>
            <radialGradient id="knowledge-map-glow" cx="50%" cy="50%">
              <stop
                offset="0%"
                style={{ stopColor: "var(--echo-core)" }}
                stopOpacity=".1"
              />
              <stop
                offset="100%"
                style={{ stopColor: "var(--echo-core)" }}
                stopOpacity="0"
              />
            </radialGradient>
            <filter
              id="knowledge-map-shadow"
              x="-80%"
              y="-80%"
              width="260%"
              height="260%"
            >
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id="knowledge-map-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                style={{ fill: "var(--echo-ink-muted)" }}
                fillOpacity=".7"
              />
            </marker>
          </defs>
          <rect width="1000" height="560" fill="url(#knowledge-map-glow)" />
          <circle
            cx="500"
            cy="280"
            r="72"
            style={{ fill: "var(--echo-core)" }}
            fillOpacity=".035"
          />
          <circle
            cx="500"
            cy="280"
            r="118"
            fill="none"
            style={{ stroke: "var(--echo-ink-muted)" }}
            strokeOpacity=".16"
          />
          <circle
            cx="500"
            cy="280"
            r="218"
            fill="none"
            style={{ stroke: "var(--echo-ink-muted)" }}
            strokeOpacity=".1"
          />
          <g
            fill="none"
            style={{ stroke: "var(--echo-ink-muted)" }}
            strokeWidth="1.2"
          >
            {visibleRelationships.map((relationship) => {
              const source = positions.get(relationship.source_name);
              const target = positions.get(relationship.target_name);
              if (!source || !target) return null;
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2 - 18;
              const related =
                !activeNode ||
                relationship.source_name === activeNode.name ||
                relationship.target_name === activeNode.name;
              return (
                <path
                  key={relationship.id}
                  d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
                  strokeOpacity={related ? 0.58 : 0.09}
                  strokeWidth={related ? 1.8 : 1}
                  markerEnd={
                    showArrows ? "url(#knowledge-map-arrow)" : undefined
                  }
                />
              );
            })}
          </g>
          {nodePositions.map(({ node, point, rank }) => {
            const color = categoricalVar(
              node.entity_type === "object"
                ? 2
                : node.entity_type === "subject"
                  ? 1
                  : categoricalSlot(node.entity_type),
            );
            const nodeDegree = degree.get(node.name) ?? 0;
            const radius =
              rank === 0 ? 12 : Math.min(8, 4.5 + nodeDegree * 0.7);
            const selected = selectedNode?.id === node.id;
            const active = activeNode?.id === node.id;
            const connected =
              !activeNode || active || activeNeighbors.has(node.name);
            const showLabel = rank === 0 || selected;
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
                filter="url(#knowledge-map-shadow)"
                opacity={connected ? 1 : 0.22}
                className="group cursor-pointer transition-opacity"
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedNodeId(node.id)}
              >
                <circle
                  r={radius * 2.7}
                  style={{ fill: color }}
                  fillOpacity={selected ? ".16" : ".07"}
                />
                <circle
                  r={radius}
                  style={{
                    fill: color,
                    stroke: selected || active ? "var(--echo-core)" : color,
                  }}
                  strokeWidth={selected || active ? 2 : 0}
                />
                <rect
                  x="-56"
                  y={-radius - 28}
                  width="112"
                  height="20"
                  rx="10"
                  style={{ fill: "var(--echo-surface-raised)" }}
                  fillOpacity={showLabel ? ".9" : ".2"}
                  className={
                    showLabel
                      ? "opacity-100"
                      : "opacity-0 transition-opacity group-hover:opacity-100"
                  }
                />
                <text
                  y={-radius - 14}
                  textAnchor="middle"
                  style={{ fill: "var(--echo-ink)" }}
                  fontSize={rank === 0 ? "13" : "11"}
                  fontWeight="600"
                  className={
                    showLabel
                      ? "opacity-100"
                      : "opacity-0 transition-opacity group-hover:opacity-100"
                  }
                >
                  {labelFor(node.name)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {selectedNode && (
        <div className="absolute bottom-3 left-3 max-w-[var(--text-truncate-2xl)] rounded-md border border-border bg-popover/90 px-3 py-2 text-foreground backdrop-blur-md">
          <div className="truncate text-xs font-semibold">
            {labelFor(selectedNode.name)}
          </div>
          <div className="mt-1 text-mini text-muted-foreground">
            {typeLabelFor(selectedNode.entity_type)} ·{" "}
            {copy.relationCount(degree.get(selectedNode.name) ?? 0)}
          </div>
          {selectedNode.description && (
            <div className="mt-1 line-clamp-2 text-mini leading-4 text-muted-foreground">
              {selectedNode.description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
