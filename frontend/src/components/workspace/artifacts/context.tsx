import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useWorkspaceArtifacts } from "@/core/artifacts/use-workspace-artifacts";
import { useSidebar } from "@/components/ui/sidebar";
import { env } from "@/env";

export interface ArtifactsContextType {
  artifacts: string[];
  setArtifacts: Dispatch<SetStateAction<string[]>>;

  selectedArtifact: string | null;
  autoSelect: boolean;
  select: (artifact: string, autoSelect?: boolean, lines?: string) => void;
  selectedLines?: string;
  deselect: () => void;
  clearSelection: () => void;
  registerNavigationGuard: (guard: () => Promise<boolean>) => () => void;

  open: boolean;
  autoOpen: boolean;
  setOpen: (open: boolean) => void;
}

const ArtifactsContext = createContext<ArtifactsContextType | undefined>(
  undefined,
);

interface ArtifactsProviderProps {
  children: ReactNode;
  threadId?: string | null;
  /** False while the id is still pending: the server has no outputs yet. */
  threadExists?: boolean;
}

export function ArtifactsProvider({
  children,
  threadId,
  threadExists = true,
}: ArtifactsProviderProps) {
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<string>();
  const [autoSelect, setAutoSelect] = useState(true);
  const [open, setOpen] = useState(env.STATIC_WEBSITE_ONLY);
  const [autoOpen, setAutoOpen] = useState(true);
  const { setOpen: setSidebarOpen } = useSidebar();
  const navigationGuard = useRef<(() => Promise<boolean>) | null>(null);
  const selectionRequest = useRef(0);
  const registerNavigationGuard = useCallback(
    (guard: () => Promise<boolean>) => {
      navigationGuard.current = guard;
      return () => {
        if (navigationGuard.current === guard) navigationGuard.current = null;
      };
    },
    [],
  );

  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      prevThreadIdRef.current = threadId;
      selectionRequest.current++;
      navigationGuard.current = null;
      setArtifacts([]);
      setSelectedArtifact(null);
      setSelectedLines(undefined);
      setAutoSelect(true);
      setOpen(env.STATIC_WEBSITE_ONLY);
      setAutoOpen(true);
    }
  }, [threadId]);

  // Hydrate the artifact list from the backend on mount / thread change.
  // Historically this was only triggered from chat-box after the assistant
  // message settled; switching to the workbench "产物" tab before that
  // point (or clicking an artifact summary row while the list was empty)
  // showed `暂无预览内容` even though files were already persisted on disk.
  //
  // Now using the shared useWorkspaceArtifacts hook which is also used by
  // chat-box, so React Query deduplicates requests. This fallback only runs
  // when the shared query hasn't populated the list yet.
  const { data: fallbackArtifacts } = useWorkspaceArtifacts(threadId, {
    enabled: threadExists && !env.STATIC_WEBSITE_ONLY && artifacts.length === 0,
  });

  useEffect(() => {
    if (!fallbackArtifacts || fallbackArtifacts.length === 0) return;
    setArtifacts((prev) =>
      prev.length === 0
        ? fallbackArtifacts
        : Array.from(new Set([...prev, ...fallbackArtifacts])),
    );
  }, [fallbackArtifacts]);

  const select = useCallback(
    (artifact: string, autoSelect = false, lines?: string) => {
      const request = ++selectionRequest.current;
      const apply = () => {
        if (request !== selectionRequest.current) return;
        setSelectedArtifact(artifact);
        setSelectedLines(lines);
      };
      if (artifact !== selectedArtifact && navigationGuard.current) {
        void navigationGuard.current().then((allowed) => {
          if (allowed) apply();
        });
      } else apply();
      if (!env.STATIC_WEBSITE_ONLY) {
        setSidebarOpen(false);
      }
      if (!autoSelect) {
        setAutoSelect(false);
      }
    },
    [setSidebarOpen, setSelectedArtifact, setAutoSelect, selectedArtifact],
  );

  const deselect = useCallback(() => {
    selectionRequest.current++;
    setSelectedArtifact(null);
    setAutoSelect(true);
    setOpen(false);
  }, []);

  const clearSelection = useCallback(() => {
    selectionRequest.current++;
    setSelectedArtifact(null);
    setAutoSelect(true);
  }, []);

  const value: ArtifactsContextType = {
    artifacts,
    setArtifacts,

    open,
    autoOpen,
    autoSelect,
    setOpen: (isOpen: boolean) => {
      if (!isOpen && autoOpen) {
        setAutoOpen(false);
        setAutoSelect(false);
      }
      setOpen(isOpen);
    },

    selectedArtifact,
    selectedLines,
    select,
    deselect,
    clearSelection,
    registerNavigationGuard,
  };

  return (
    <ArtifactsContext.Provider value={value}>
      {children}
    </ArtifactsContext.Provider>
  );
}

export function useArtifacts() {
  const context = useContext(ArtifactsContext);
  if (context === undefined) {
    throw new Error("useArtifacts must be used within an ArtifactsProvider");
  }
  return context;
}

/** Receipt cards also render outside the full workspace in previews/tests. */
export function useOptionalArtifacts() {
  return useContext(ArtifactsContext);
}
