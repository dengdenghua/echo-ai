import {
  AlertTriangleIcon,
  DownloadIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import { exportMemory, searchMemory } from "@/core/memory/api";
import {
  useClearMemory,
  useCreateMemoryFact,
  useDeleteMemoryFact,
  useImportMemory,
  useMemory,
  useMemoryConfig,
  useUpdateMemoryConfig,
  useUpdateMemoryFact,
} from "@/core/memory/hooks";
import type {
  MemoryFactInput,
  MemoryFactPatchInput,
  MemoryConfigPatch,
  MemorySearchResult,
} from "@/core/memory/types";
import { useStreamdownPlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

import {
  ClearMemoryDialog,
  DeleteFactDialog,
  FactEditorDialog,
  ImportMemoryDialog,
} from "./memory-settings/memory-dialogs";
import { MemoryFactsList } from "./memory-settings/memory-facts-list";
import {
  DEFAULT_FACT_FORM_STATE,
  buildMemorySectionGroups,
  isMemorySummaryEmpty,
  summariesToMarkdown,
  type FactFormState,
  type MemoryFact,
  type PendingImport,
} from "./memory-settings/memory-helpers";
import {
  MAX_MEMORY_IMPORT_BYTES,
  isImportedMemory,
} from "./memory-settings/memory-import";
import { SettingsSection } from "./settings-section";
import { PersonalWorkRulesSettings } from "./personal-space-settings-page";
import { getMemoryLoadErrorCopy } from "./settings-resilience";

export {
  MAX_MEMORY_IMPORT_BYTES,
  isImportedMemory,
} from "./memory-settings/memory-import";

const LazyStreamdown = lazy(
  () => import("@/components/ai-elements/streamdown-host"),
);

type MemoryViewFilter = "all" | "facts" | "summaries";

export default function MemorySettingsPage() {
  const { t, locale } = useI18n();
  const streamdownPlugins = useStreamdownPlugins();
  const { memory, isLoading, error, refetch, isRefreshing } = useMemory();
  const {
    config: memoryConfig,
    isLoading: isMemoryConfigLoading,
    error: memoryConfigError,
    refetch: refetchMemoryConfig,
    isRefreshing: isMemoryConfigRefreshing,
  } = useMemoryConfig();
  const updateMemoryConfig = useUpdateMemoryConfig();
  const clearMemory = useClearMemory();
  const createMemoryFact = useCreateMemoryFact();
  const deleteMemoryFact = useDeleteMemoryFact();
  const importMemoryMutation = useImportMemory();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const updateMemoryFact = useUpdateMemoryFact();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [factToDelete, setFactToDelete] = useState<MemoryFact | null>(null);
  const [factToEdit, setFactToEdit] = useState<MemoryFact | null>(null);
  const [factEditorOpen, setFactEditorOpen] = useState(false);
  const [factForm, setFactForm] = useState<FactFormState>(
    DEFAULT_FACT_FORM_STATE,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemoryViewFilter>("all");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const [backendSearchResults, setBackendSearchResults] = useState<
    MemorySearchResult[] | null
  >(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Debounced backend FTS5 search
  useEffect(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    if (!normalizedQuery) {
      setBackendSearchResults(null);
      setIsSearching(false);
      return;
    }

    setBackendSearchResults(null);
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      searchMemory(deferredQuery.trim(), 100)
        .then((results) => {
          if (!controller.signal.aborted) {
            setBackendSearchResults(results);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            // Fallback: clear backend results so client-side filter is used
            setBackendSearchResults(null);
            setIsSearching(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      searchAbortRef.current?.abort();
    };
  }, [normalizedQuery, deferredQuery]);

  const clearAllLabel = t.settings.memory.clearAll ?? "Clear all memory";
  const clearAllConfirmTitle =
    t.settings.memory.clearAllConfirmTitle ?? "Clear all memory?";
  const clearAllConfirmDescription =
    t.settings.memory.clearAllConfirmDescription ??
    "This will remove all saved summaries and facts. This action cannot be undone.";
  const clearAllSuccess =
    t.settings.memory.clearAllSuccess ?? "All memory cleared";
  const factDeleteConfirmTitle =
    t.settings.memory.factDeleteConfirmTitle ?? "Delete this fact?";
  const factDeleteConfirmDescription =
    t.settings.memory.factDeleteConfirmDescription ??
    "This fact will be removed from memory immediately. This action cannot be undone.";
  const factDeleteSuccess =
    t.settings.memory.factDeleteSuccess ?? "Fact deleted";
  const addFactLabel = t.settings.memory.addFact;
  const addFactSuccess = t.settings.memory.addFactSuccess;
  const editFactSuccess = t.settings.memory.editFactSuccess;
  const factValidationContent = t.settings.memory.factValidationContent;
  const factValidationConfidence = t.settings.memory.factValidationConfidence;
  const noFacts = t.settings.memory.noFacts ?? "No saved facts yet.";
  const summaryReadOnly = t.settings.memory.summaryReadOnly;
  const memoryFullyEmpty =
    t.settings.memory.memoryFullyEmpty ?? "No memory saved yet.";
  const factPreviewLabel =
    t.settings.memory.factPreviewLabel ?? "Fact to delete";
  const searchPlaceholder =
    t.settings.memory.searchPlaceholder ?? "Search memory";
  const filterAll = t.settings.memory.filterAll ?? "All";
  const filterFacts = t.settings.memory.filterFacts ?? "Facts";
  const filterSummaries = t.settings.memory.filterSummaries ?? "Summaries";
  const noMatches = t.settings.memory.noMatches ?? "No matching memory found";
  const exportButton = t.settings.memory.exportButton ?? t.common.export;
  const exportSuccess =
    t.settings.memory.exportSuccess ?? t.common.exportSuccess;
  const importButton = t.settings.memory.importButton ?? t.common.import;
  const importSuccess = t.settings.memory.importSuccess ?? "Memory imported";
  const memoryConfigEnabled = memoryConfig?.enabled ?? false;
  const autoCaptureEnabled = memoryConfig?.auto_capture_enabled ?? false;
  const injectionEnabled = memoryConfig?.injection_enabled ?? false;
  const memoryConfigUnavailable =
    isMemoryConfigLoading || Boolean(memoryConfigError) || !memoryConfig;

  async function handleMemoryConfigChange(patch: MemoryConfigPatch) {
    if (memoryConfigUnavailable) return;
    try {
      await updateMemoryConfig.mutateAsync(patch);
      toast.success(t.settings.memory.saved);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    }
  }

  const sectionGroups = memory ? buildMemorySectionGroups(memory, t) : [];
  const filteredSectionGroups = sectionGroups
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) =>
        normalizedQuery
          ? `${section.title} ${section.summary}`
              .toLowerCase()
              .includes(normalizedQuery)
          : true,
      ),
    }))
    .filter((group) => group.sections.length > 0);

  // Use backend FTS5 results when available; fall back to client-side filter
  const filteredFacts = (() => {
    if (!memory) return [];
    if (!normalizedQuery) return memory.facts;
    if (backendSearchResults !== null) {
      // Map backend results back to local facts for consistent rendering,
      // preserving relevance ordering from the backend.
      const factMap = new Map(memory.facts.map((f) => [f.id, f]));
      const matched: MemoryFact[] = [];
      for (const sr of backendSearchResults) {
        const local = factMap.get(sr.id);
        if (local) matched.push(local);
      }
      return matched;
    }
    // Client-side fallback (e.g. backend unreachable)
    return memory.facts.filter((fact) =>
      `${fact.content} ${fact.category}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  })();

  const showSummaries = filter !== "facts";
  const showFacts = filter !== "summaries";
  const shouldRenderSummariesBlock =
    showSummaries && (filteredSectionGroups.length > 0 || !normalizedQuery);
  const shouldRenderFactsBlock =
    showFacts &&
    (filteredFacts.length > 0 || !normalizedQuery || filter === "facts");
  const hasMatchingVisibleContent =
    !memory ||
    (showSummaries && filteredSectionGroups.length > 0) ||
    (showFacts && filteredFacts.length > 0);

  async function handleExportMemory() {
    try {
      setIsExporting(true);
      const exportedMemory = await exportMemory();
      const fileName = `echo-memory-${(exportedMemory.lastUpdated || new Date().toISOString()).replace(/[:.]/g, "-")}.json`;
      const blob = new Blob([JSON.stringify(exportedMemory, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(exportSuccess);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImportFileSelection(event: {
    target: HTMLInputElement;
  }) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    if (file.size > MAX_MEMORY_IMPORT_BYTES) {
      toast.error(t.settings.memory.importFileTooLarge);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isImportedMemory(parsed)) {
        toast.error(t.settings.memory.importInvalidFile);
        return;
      }
      setPendingImport({
        fileName: file.name,
        memory: parsed,
      });
    } catch {
      toast.error(t.settings.memory.importInvalidFile);
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) {
      return;
    }

    try {
      await importMemoryMutation.mutateAsync(pendingImport.memory);
      toast.success(importSuccess);
      setPendingImport(null);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    }
  }

  async function handleClearMemory() {
    try {
      await clearMemory.mutateAsync();
      toast.success(clearAllSuccess);
      setClearDialogOpen(false);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    }
  }

  async function handleDeleteFact() {
    if (!factToDelete) return;

    try {
      await deleteMemoryFact.mutateAsync(factToDelete.id);
      toast.success(factDeleteSuccess);
      setFactToDelete(null);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    }
  }

  function openCreateFactDialog() {
    setFactToEdit(null);
    setFactForm(DEFAULT_FACT_FORM_STATE);
    setFactEditorOpen(true);
  }

  function openEditFactDialog(fact: MemoryFact) {
    setFactToEdit(fact);
    setFactForm({
      content: fact.content,
      category: fact.category,
      confidence: String(fact.confidence),
    });
    setFactEditorOpen(true);
  }

  async function handleSaveFact() {
    const trimmedContent = factForm.content.trim();
    if (!trimmedContent) {
      toast.error(factValidationContent);
      return;
    }

    const confidence = Number(factForm.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      toast.error(factValidationConfidence);
      return;
    }

    const input: MemoryFactInput = {
      content: trimmedContent,
      category: factForm.category.trim() || "context",
      confidence,
    };

    try {
      if (factToEdit) {
        const patchInput: MemoryFactPatchInput = {
          content: input.content,
          category: input.category,
          confidence: input.confidence,
        };
        await updateMemoryFact.mutateAsync({
          factId: factToEdit.id,
          input: patchInput,
        });
        toast.success(editFactSuccess);
      } else {
        await createMemoryFact.mutateAsync(input);
        toast.success(addFactSuccess);
      }
      setFactEditorOpen(false);
      setFactToEdit(null);
      setFactForm(DEFAULT_FACT_FORM_STATE);
    } catch {
      toast.error(t.settings.memory.actionFailed);
    }
  }

  const isFactFormPending =
    createMemoryFact.isPending || updateMemoryFact.isPending;
  const factFormConfidence = Number(factForm.confidence);
  const factFormConfidenceValid =
    Number.isFinite(factFormConfidence) &&
    factFormConfidence >= 0 &&
    factFormConfidence <= 1;
  const factFormValid =
    factForm.content.trim().length > 0 && factFormConfidenceValid;

  return (
    <>
      <SettingsSection
        title={t.settings.memory.title}
        description={t.settings.memory.description}
      >
        <div className="mb-8 border-b border-border-subtle pb-8">
          <PersonalWorkRulesSettings />
        </div>
        {isLoading ? (
          <div className="text-muted-foreground text-sm">
            {t.common.loading}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-4 py-3 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 items-start gap-2 text-sm text-destructive">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{getMemoryLoadErrorCopy(locale)}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full shrink-0 sm:w-auto"
              disabled={isRefreshing}
              onClick={() => void refetch()}
            >
              <RefreshCwIcon
                className={cn(
                  "mr-1.5 size-3.5",
                  isRefreshing && "animate-spin",
                )}
              />
              {t.errorBoundary.retry}
            </Button>
          </div>
        ) : !memory ? (
          <div className="text-muted-foreground text-sm">
            {t.settings.memory.empty}
          </div>
        ) : (
          <div className="space-y-4">
            {isMemoryConfigLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Loader2Icon className="size-3.5 animate-spin" />
                {t.settings.memory.configLoading}
              </div>
            ) : memoryConfigError ? (
              <div
                role="alert"
                className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/[0.04] px-4 py-3 text-xs sm:flex-row sm:items-center"
              >
                <span className="text-destructive">
                  {t.settings.memory.configLoadFailed}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 w-full px-2 text-xs sm:w-auto"
                  disabled={isMemoryConfigRefreshing}
                  onClick={() => void refetchMemoryConfig?.()}
                >
                  <RefreshCwIcon
                    className={cn(
                      "mr-1.5 size-3.5",
                      isMemoryConfigRefreshing && "animate-spin",
                    )}
                  />
                  {t.errorBoundary.retry}
                </Button>
              </div>
            ) : null}
            <div className="rounded-lg border bg-card divide-y">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">
                    {t.settings.memory.enableMemory}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.settings.memory.enableMemoryDesc}
                  </div>
                </div>
                <Switch
                  aria-label={t.settings.memory.enableMemory}
                  checked={memoryConfigEnabled}
                  disabled={
                    memoryConfigUnavailable || updateMemoryConfig.isPending
                  }
                  onCheckedChange={(enabled) =>
                    void handleMemoryConfigChange({ enabled })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">
                    {t.settings.memory.autoCapture}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.settings.memory.autoCaptureDesc}
                  </div>
                </div>
                <Switch
                  aria-label={t.settings.memory.autoCapture}
                  checked={memoryConfigEnabled && autoCaptureEnabled}
                  disabled={
                    !memoryConfigEnabled ||
                    updateMemoryConfig.isPending ||
                    memoryConfigUnavailable
                  }
                  onCheckedChange={(auto_capture_enabled) =>
                    void handleMemoryConfigChange({ auto_capture_enabled })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium">
                    {t.settings.memory.injectOnReply}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.settings.memory.injectOnReplyDesc}
                  </div>
                </div>
                <Switch
                  aria-label={t.settings.memory.injectOnReply}
                  checked={memoryConfigEnabled && injectionEnabled}
                  disabled={
                    !memoryConfigEnabled ||
                    updateMemoryConfig.isPending ||
                    memoryConfigUnavailable
                  }
                  onCheckedChange={(injection_enabled) =>
                    void handleMemoryConfigChange({ injection_enabled })
                  }
                />
              </div>
            </div>

            {isMemorySummaryEmpty(memory) && memory.facts.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                {memoryFullyEmpty}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative sm:max-w-xs w-full">
                  <SearchIcon className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                  <Input
                    // Same autofill trap as the settings section filter: a
                    // plain text input gets the saved account auto-filled by
                    // the browser, which then searches memories for it.
                    type="search"
                    name="echo-memory-search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-label={searchPlaceholder}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                  />
                  {isSearching && normalizedQuery ? (
                    <Loader2Icon className="text-muted-foreground absolute right-2.5 top-2.5 size-4 animate-spin" />
                  ) : null}
                </div>
                <ToggleGroup
                  aria-label={t.settings.memory.filterLabel}
                  type="single"
                  value={filter}
                  onValueChange={(value) => {
                    if (value) setFilter(value as MemoryViewFilter);
                  }}
                  variant="outline"
                >
                  <ToggleGroupItem value="all">{filterAll}</ToggleGroupItem>
                  <ToggleGroupItem value="facts">{filterFacts}</ToggleGroupItem>
                  <ToggleGroupItem value="summaries">
                    {filterSummaries}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => void handleImportFileSelection(event)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMemoryMutation.isPending}
                >
                  <UploadIcon className="mr-1.5 size-3.5" />
                  {importButton}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleExportMemory()}
                  disabled={isExporting}
                >
                  <DownloadIcon className="mr-1.5 size-3.5" />
                  {isExporting ? t.common.loading : exportButton}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCreateFactDialog}
                >
                  <PlusIcon className="mr-1.5 size-3.5" />
                  {addFactLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setClearDialogOpen(true)}
                  disabled={
                    clearMemory.isPending ||
                    (isMemorySummaryEmpty(memory) && memory.facts.length === 0)
                  }
                >
                  {clearMemory.isPending ? t.common.loading : clearAllLabel}
                </Button>
              </div>
            </div>

            {!hasMatchingVisibleContent && normalizedQuery ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                {noMatches}
              </div>
            ) : null}

            {shouldRenderSummariesBlock ? (
              <div className="rounded-lg border p-4">
                <div className="text-muted-foreground mb-4 text-sm">
                  {summaryReadOnly}
                </div>
                <Suspense
                  fallback={
                    <div className="whitespace-pre-wrap break-words">
                      {summariesToMarkdown(memory, filteredSectionGroups, t)}
                    </div>
                  }
                >
                  <LazyStreamdown
                    className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                    {...streamdownPlugins}
                  >
                    {summariesToMarkdown(memory, filteredSectionGroups, t)}
                  </LazyStreamdown>
                </Suspense>
              </div>
            ) : null}

            {shouldRenderFactsBlock ? (
              <MemoryFactsList
                facts={filteredFacts}
                emptyText={normalizedQuery ? noMatches : noFacts}
                deleteDisabled={deleteMemoryFact.isPending}
                onEdit={openEditFactDialog}
                onDelete={setFactToDelete}
              />
            ) : null}
          </div>
        )}
      </SettingsSection>

      <ClearMemoryDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title={clearAllConfirmTitle}
        description={clearAllConfirmDescription}
        confirmLabel={clearAllLabel}
        pending={clearMemory.isPending}
        onConfirm={() => void handleClearMemory()}
      />

      <FactEditorDialog
        open={factEditorOpen}
        onOpenChange={(open) => {
          setFactEditorOpen(open);
          if (!open) {
            setFactToEdit(null);
            setFactForm(DEFAULT_FACT_FORM_STATE);
          }
        }}
        editing={factToEdit !== null}
        form={factForm}
        setForm={setFactForm}
        confidenceValid={factFormConfidenceValid}
        valid={factFormValid}
        pending={isFactFormPending}
        onCancel={() => {
          setFactEditorOpen(false);
          setFactToEdit(null);
          setFactForm(DEFAULT_FACT_FORM_STATE);
        }}
        onSave={() => void handleSaveFact()}
      />

      <DeleteFactDialog
        fact={factToDelete}
        onClose={() => setFactToDelete(null)}
        title={factDeleteConfirmTitle}
        description={factDeleteConfirmDescription}
        previewLabel={factPreviewLabel}
        pending={deleteMemoryFact.isPending}
        onConfirm={() => void handleDeleteFact()}
      />

      <ImportMemoryDialog
        pendingImport={pendingImport}
        onClose={() => setPendingImport(null)}
        pending={importMemoryMutation.isPending}
        onConfirm={() => void handleConfirmImport()}
      />
    </>
  );
}
