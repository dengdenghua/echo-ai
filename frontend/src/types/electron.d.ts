/**
 * Implementation note.
 *
 * Implementation note.
 * Implementation note.
 * Implementation note.
 */

import type { DevicePreset } from "@/components/workspace/embedded-browser/browser-context";

/** One back / forward history entry of a browser tab. */
export interface BrowserNavigationEntry {
  url: string;
  title: string;
}

export interface BrowserExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  manifestVersion: number;
  path: string;
  enabled: boolean;
  installedAt: string;
  /** "folder", or the store it was installed from ("chrome" / "edge"). */
  source?: string;
  /** Shown on the toolbar rather than only in the extensions menu. */
  pinned?: boolean;
}

/** An extension's toolbar button as it stands for one tab. */
export interface BrowserExtensionAction {
  id: string;
  name: string;
  title: string;
  /** data: URL, or null when the extension ships no icon. */
  icon: string | null;
  badgeText: string;
  badgeColor?: string;
  badgeTextColor?: string;
  /** The manifest declares a toolbar action. */
  hasAction: boolean;
  hasPopup: boolean;
  hasOptions: boolean;
  enabled: boolean;
  pinned: boolean;
}

/** Toolbar button position, in the app window's CSS pixels. */
export interface ExtensionActionAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NativeDesktopItem {
  id: string;
  name: string;
  subtitle: string;
  path: string;
  kind: "folder" | "file" | "app";
  extension: string;
}

/** ``window.echo.notifications.show`` input (validated in main). */
export interface DesktopNotificationPayload {
  title: string;
  body?: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
  /** In-app route (``/workspace/...``) to open on click. */
  href?: string;
  threadId?: string;
  silent?: boolean;
}

/** ``notification:clicked`` event payload. */
export interface DesktopNotificationClick {
  href: string | null;
  threadId: string | null;
  tag: string | null;
}

export interface EchoElectronAPI {
  isElectron: true;
  platform: NodeJS.Platform;
  /** The native title bar overlaps web content only in the main shell window. */
  windowControlsOverlay?: boolean;
  /** Synchronous backend URL injected by Electron preload for packaged builds. */
  backendBaseURL?: string;

  browser: {
    setDevice: (
      webContentsId: number,
      mode: DevicePreset,
    ) => Promise<{ ok: boolean; mode: DevicePreset }>;
    executeJS: (webContentsId: number, code: string) => Promise<unknown>;
    reload: (webContentsId: number) => Promise<void>;
    goBack: (webContentsId: number) => Promise<void>;
    goForward: (webContentsId: number) => Promise<void>;
    openDevTools: (
      webContentsId: number,
    ) => Promise<{ ok: boolean; error?: string }>;
    capturePage: (
      webContentsId: number,
    ) => Promise<{ dataUrl: string; width: number; height: number }>;
    extractText: (webContentsId: number) => Promise<{
      url: string;
      title: string;
      text: string;
      truncated: boolean;
      textLength: number;
    }>;

    // Implementation note.
    click: (
      webContentsId: number,
      selector: string,
    ) => Promise<{
      ok: boolean;
      error?: string;
      tag?: string;
      text?: string;
    }>;
    type: (
      webContentsId: number,
      selector: string,
      text: string,
      opts?: { clear?: boolean },
    ) => Promise<{ ok: boolean; error?: string; value?: string }>;
    hover: (
      webContentsId: number,
      selector: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    scroll: (
      webContentsId: number,
      opts: { selector?: string; deltaX?: number; deltaY?: number },
    ) => Promise<{ ok: boolean; error?: string; y?: number }>;
    waitFor: (
      webContentsId: number,
      selector: string,
      timeout?: number,
    ) => Promise<{ ok: boolean; error?: string; elapsed?: number }>;
    pressKey: (
      webContentsId: number,
      key: string,
    ) => Promise<{ ok: boolean; key: string }>;
    getAriaTree: (
      webContentsId: number,
      opts?: { maxDepth?: number },
    ) => Promise<{
      ok: boolean;
      error?: string;
      nodes?: Array<{
        id: string;
        role: string;
        name: string;
        value: string;
        backendDOMNodeId?: number;
        childIds: string[];
        ignored: boolean;
      }>;
    }>;
    getCurrentUrl: (
      webContentsId: number,
    ) => Promise<{ ok: boolean; url: string; title: string }>;
    clearSiteData: (
      webContentsId: number,
    ) => Promise<{ ok: boolean; origin?: string; error?: string }>;
    clearBrowsingData: () => Promise<{ ok: boolean; error?: string }>;
    listPasswords: (origin?: string) => Promise<{
      ok: boolean;
      available: boolean;
      entries: Array<{
        id: string;
        origin: string;
        username: string;
        updatedAt: number;
      }>;
      error?: string;
    }>;
    savePassword: (entry: {
      origin: string;
      username: string;
      password: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    deletePassword: (id: string) => Promise<{ ok: boolean; error?: string }>;
    fillPassword: (
      webContentsId: number,
      id: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    listSitePermissions: () => Promise<{
      ok: boolean;
      entries: Array<{
        origin: string;
        permission:
          | "camera"
          | "microphone"
          | "camera-microphone"
          | "location"
          | "notifications"
          | "clipboard";
        decision: "allow" | "block";
        updatedAt: number;
      }>;
      error?: string;
    }>;
    setSitePermission: (
      origin: string,
      permission:
        | "camera"
        | "microphone"
        | "camera-microphone"
        | "location"
        | "notifications"
        | "clipboard",
      decision: "ask" | "allow" | "block",
    ) => Promise<{ ok: boolean; error?: string }>;
    showDownloadInFolder: (
      id: string,
    ) => Promise<{ ok: boolean; error?: string }>;
    openDownload: (id: string) => Promise<{ ok: boolean; error?: string }>;
    print: (webContentsId: number) => Promise<{ ok: boolean; error?: string }>;
    /** Answer a "save password?" offer; the password never leaves main. */
    resolvePasswordOffer: (
      token: string,
      /** "never": don't save and never ask again for this site. */
      save: boolean | "never",
    ) => Promise<{ ok: boolean; saved?: boolean; error?: string }>;
    listPasswordNeverSites: () => Promise<{ ok: boolean; origins: string[] }>;
    removePasswordNeverSite: (origin: string) => Promise<{ ok: boolean }>;
    getNavigationHistory: (webContentsId: number) => Promise<{
      ok: boolean;
      entries: BrowserNavigationEntry[];
      index: number;
      error?: string;
    }>;
    /** History for the next webview that attaches with this src. */
    queueNavigationRestore: (
      src: string,
      entries: BrowserNavigationEntry[],
      index: number,
    ) => Promise<{ ok: boolean; error?: string }>;
    importBookmarks: (browser: "chrome" | "edge") => Promise<{
      ok: boolean;
      entries: { title: string; url: string }[];
      error?: string;
    }>;
    pauseDownload: (id: string) => Promise<{ ok: boolean; error?: string }>;
    resumeDownload: (id: string) => Promise<{ ok: boolean; error?: string }>;
    cancelDownload: (id: string) => Promise<{ ok: boolean; error?: string }>;
    retryDownload: (id: string) => Promise<{ ok: boolean; error?: string }>;
  };

  dialog: {
    open: (
      options?: Electron.OpenDialogOptions,
    ) => Promise<Electron.OpenDialogReturnValue>;
    save: (
      options?: Electron.SaveDialogOptions,
    ) => Promise<Electron.SaveDialogReturnValue>;
  };

  extensions: {
    list: () => Promise<{
      ok: boolean;
      extensions: BrowserExtensionInfo[];
      error?: string;
    }>;
    installFromFolder: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      extension?: BrowserExtensionInfo;
      error?: string;
    }>;
    /** Chrome Web Store / Edge Add-ons link or extension ID. */
    installFromStore: (input: string) => Promise<{
      ok: boolean;
      extension?: BrowserExtensionInfo;
      error?: string;
    }>;
    setEnabled: (
      id: string,
      enabled: boolean,
    ) => Promise<{
      ok: boolean;
      extension?: BrowserExtensionInfo;
      error?: string;
    }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    /** Toolbar buttons of the enabled extensions, for one tab. */
    actions: (
      tabWebContentsId: number | null,
    ) => Promise<{ ok: boolean; actions: BrowserExtensionAction[] }>;
    /** Open the popup / side panel, or tell the extension it was clicked. */
    clickAction: (
      id: string,
      tabWebContentsId: number | null,
      anchor: ExtensionActionAnchor,
    ) => Promise<{ ok: boolean; error?: string }>;
    showActionMenu: (
      id: string,
      tabWebContentsId: number | null,
    ) => Promise<{ ok: boolean }>;
    setPinned: (id: string, pinned: boolean) => Promise<{ ok: boolean }>;
    openOptions: (id: string) => Promise<{ ok: boolean; error?: string }>;
  };

  app: {
    getVersion: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    getPlatform: () => Promise<NodeJS.Platform>;
  };

  desktop: {
    getAutomationPermissions: () => Promise<{
      supported: boolean;
      platform: NodeJS.Platform;
      screenRecording: "granted" | "denied" | "restricted" | "unknown";
      accessibility: "granted" | "denied" | "unknown";
    }>;
    openAutomationPermission: (
      permission: "screen-recording" | "accessibility",
    ) => Promise<{ ok: boolean; error?: string }>;
    listItems: () => Promise<{
      ok: boolean;
      desktopPath?: string;
      items: NativeDesktopItem[];
      error?: string;
    }>;
    openItem: (path: string) => Promise<{ ok: boolean; error?: string }>;
    /** Moves one direct Desktop item to the operating system trash. */
    trashItem: (path: string) => Promise<{ ok: boolean; error?: string }>;
    installContextMenu: () => Promise<{ ok: boolean; error?: string }>;
    removeContextMenu: () => Promise<{ ok: boolean; error?: string }>;
    moveItem: (
      srcPath: string,
      destDir: string,
    ) => Promise<{
      ok: boolean;
      destPath?: string;
      skipped?: boolean;
      error?: string;
    }>;
    moveItemsBatch: (
      items: Array<{ srcPath: string; category: string }>,
    ) => Promise<{
      ok: boolean;
      moved: number;
      skipped: number;
      error?: string;
    }>;
    undoMoves: () => Promise<{
      ok: boolean;
      undone: number;
      error?: string;
    }>;
    getSystemInfo: () => Promise<{
      ok: boolean;
      cpu?: {
        model: string;
        cores: number;
        usage: number;
      };
      memory?: {
        total: number;
        used: number;
        percent: number;
      };
      uptime?: number;
      platform?: string;
      error?: string;
    }>;
    /** Capture a read-only thumbnail of the selected browser/app window for
     * the automation picture-in-picture surface. */
    captureAutomationPreview: (request: {
      kind: "browser_tab" | "desktop_window";
      id: string;
      title: string;
      appId?: string;
      appName?: string;
      width?: number;
      height?: number;
    }) => Promise<{
      ok: boolean;
      dataUrl?: string;
      width?: number;
      height?: number;
      sourceId?: string;
      sourceName?: string;
      iconUrl?: string;
      matched?: boolean;
      error?: string;
    }>;
  };

  backend: {
    /** Return the actual desktop backend URL selected by the Electron main process. */
    getBaseURL: () => Promise<string>;
    /* Implementation note. */
    restart: () => Promise<{ ok: boolean; reason?: string }>;
    /** Lazily install a heavy optional capability group (browser/vision/code-intel…). */
    ensureOptionalDeps: (
      group: string,
    ) => Promise<{ ok: boolean; reason?: string }>;
  };

  /** OS notifications raised by the main process. Clicking one restores and
   * focuses the window, then emits ``notification:clicked`` with the
   * payload's ``href`` / ``threadId``. Optional: shells built before it
   * existed lack it. */
  notifications?: {
    isSupported: () => Promise<boolean>;
    show: (payload: DesktopNotificationPayload) => Promise<{
      ok: boolean;
      id?: string;
      reason?: "invalid" | "unsupported" | "forbidden";
    }>;
  };

  window: {
    // Resize the native shell to match the selected device preview.
    setDeviceBounds: (
      mode: DevicePreset,
      width?: number,
      height?: number,
    ) => Promise<{ ok: boolean; mode?: DevicePreset; reason?: string }>;
    // Update the native title bar overlay colors.
    setTitleBarOverlay: (opts: {
      color: string;
      symbolColor: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    /** Desktop organizer overlay: when enabled, transparent empty areas pass
     * mouse events through to the real Windows desktop. */
    setMousePassthrough: (
      enabled: boolean,
    ) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>;
    /** Open DevTools for the host renderer (used by the preview panel's
     * inspector button so the user can examine runtime errors). */
    openDevTools: () => Promise<{ ok: boolean; error?: string }>;
    /** Query the native window state so the custom title bar can leave the
     * correct macOS traffic-light inset. */
    isFullScreen: () => Promise<{ ok: boolean; fullScreen?: boolean }>;
  };

  /* Implementation note. */
  bridge: {
    // Active browser tab bridge used by the Electron main process.
    setActiveTab: (webContentsId: number | null) => void;
  };

  pet: {
    /** Start the Godot desktop pet sidecar process. */
    start: () => Promise<{
      ok: boolean;
      reason?: string;
      alreadyRunning?: boolean;
    }>;
    /** Stop the Godot desktop pet sidecar process. */
    stop: () => Promise<{ ok: boolean }>;
    isRunning: () => Promise<{ ok: boolean; running: boolean }>;
    /** Map an agent run state to a pet event and send it. */
    sendEvent: (
      state:
        | "idle"
        | "thinking"
        | "working"
        | "waiting_user"
        | "success"
        | "error",
    ) => Promise<{ ok: boolean; running?: boolean; reason?: string }>;
    /** Send a raw agent event type (e.g. "agent.thinking"). */
    sendRaw: (
      type: string,
      extra?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; running?: boolean; reason?: string }>;
  };

  on: (
    channel:
      | "app:update-downloaded"
      | "app:deep-link"
      | "browser:open-tab"
      | "browser:tab-crashed"
      | "browser:keyboard-shortcut"
      | "browser:download-event"
      | "browser:ask-selection"
      | "browser:webview-pointer"
      | "browser:password-offer"
      | "browser:extension-actions-changed"
      | "browser:open-extensions"
      | "browser:focus-webcontents"
      | "browser:close-webcontents"
      | "desktop:organize-now"
      | "desktop:items-changed"
      | "backend:bootstrap-progress"
      | "window:fullscreen-changed"
      | "notification:clicked",
    listener: (...args: unknown[]) => void,
  ) => () => void;
}

declare global {
  interface Window {
    echo?: EchoElectronAPI;
    __ECHO_DESKTOP__?: boolean;
  }

  // Implementation note.
  // Implementation note.
  // Implementation note.
  namespace JSX {
    interface IntrinsicElements {
      webview: Omit<
        React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>,
        "allowpopups"
      > & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        useragent?: string;
        preload?: string;
        httpreferrer?: string;
        disablewebsecurity?: string;
        nodeintegration?: string;
        plugins?: string;
        webpreferences?: string;
      };
    }
  }
}

export {};
