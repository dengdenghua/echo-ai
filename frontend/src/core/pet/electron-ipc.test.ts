import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const requireElectronModule = createRequire(import.meta.url);
const { createAttentionNotifications } = requireElectronModule(
  resolve("electron/attention-notifications.cjs"),
) as {
  createAttentionNotifications: (deps: Record<string, unknown>) => {
    registerIpc: (ipcMain: unknown) => void;
  };
};

class FakeNotification {
  static isSupported = () => true;
  static shown: FakeNotification[] = [];
  private handlers = new Map<string, () => void>();
  constructor(public options: Record<string, unknown>) {
    FakeNotification.shown.push(this);
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, handler);
    return this;
  }
  emit(event: string) {
    this.handlers.get(event)?.();
  }
  show() {}
  close() {}
}

// Run the actual preload and IPC registration, without booting Electron,
// launching a backend, or sending UDP to a real pet process.
function bridge({ packaged = true, disabled = false } = {}) {
  const source = ts.createSourceFile(
    "main.cjs",
    readFileSync(resolve("electron/main.cjs"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const registration = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "registerIpc",
  );
  if (!registration) throw new Error("Missing desktop IPC registration");
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const petSidecar = {
    petEventForAgentState: vi.fn((state: string) =>
      state === "working" ? { type: "agent.working", intensity: 0.8 } : null,
    ),
    sendPetEvent: vi.fn(() => true),
    isPetRunning: vi.fn(() => true),
  };
  const ensureOptionalDeps = vi.fn().mockResolvedValue(undefined);
  const backendProgress = vi.fn();
  const desktopProcess = {
    platform: "win32",
    argv: [],
    env: { ECHO_PET_DISABLED: disabled ? "1" : "0" },
  };
  const rendererContents = { isDestroyed: () => false, send: vi.fn() };
  const mainWindow = {
    webContents: rendererContents,
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  FakeNotification.shown = [];
  runInNewContext(`${registration.getText(source)}; registerIpc();`, {
    ipcMain: {
      handle: (
        channel: string,
        handler: (...args: unknown[]) => Promise<unknown>,
      ) => handlers.set(channel, handler),
      on: vi.fn(),
    },
    app: { isPackaged: packaged },
    process: desktopProcess,
    petSidecar,
    ensureOptionalDeps,
    backendProgress,
    createAttentionNotifications,
    Notification: FakeNotification,
    BrowserWindow: { fromWebContents: () => mainWindow },
    mainWindow,
    auxiliaryWindows: new Map(),
  });
  let api: Window["echo"];
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name: string, value: Window["echo"]) => {
        if (name === "echo") api = value;
      },
    },
    ipcRenderer: {
      sendSync: () => "http://127.0.0.1:8310",
      invoke: (channel: string, ...args: unknown[]) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
        return handler({ sender: rendererContents }, ...args);
      },
    },
  };
  runInNewContext(
    readFileSync(resolve("electron/preload.cjs"), "utf8"),
    { require: () => electron, process: desktopProcess },
  );
  if (!api) throw new Error("Preload did not expose the desktop API");
  return {
    api,
    petSidecar,
    ensureOptionalDeps,
    backendProgress,
    mainWindow,
    rendererContents,
  };
}

describe("desktop preload to main IPC", () => {
  it("delivers agent state to the pet mapper", async () => {
    const { api, petSidecar } = bridge();
    await expect(api.pet.sendEvent("working")).resolves.toEqual({
      ok: true,
      running: true,
    });
    expect(petSidecar.petEventForAgentState).toHaveBeenCalledWith("working");
    expect(petSidecar.sendPetEvent).toHaveBeenCalledWith("agent.working", {
      intensity: 0.8,
    });
  });

  it("preserves the raw event type and payload", async () => {
    const { api, petSidecar } = bridge();
    const payload = { intensity: 0.5 };
    await api.pet.sendRaw("agent.thinking", payload);
    expect(petSidecar.sendPetEvent).toHaveBeenCalledWith(
      "agent.thinking",
      payload,
    );
  });

  it("preserves the optional dependency group", async () => {
    const { api, ensureOptionalDeps, backendProgress } = bridge();
    await expect(api.backend.ensureOptionalDeps("browser")).resolves.toEqual({
      ok: true,
    });
    expect(ensureOptionalDeps).toHaveBeenCalledWith("browser", backendProgress);
  });

  it("does not send pet events when the pet is disabled", async () => {
    const { api, petSidecar } = bridge({ disabled: true });
    await expect(api.pet.sendEvent("working")).resolves.toEqual({
      ok: false,
      reason: "pet disabled",
    });
    expect(petSidecar.sendPetEvent).not.toHaveBeenCalled();
  });

  it("raises attention notifications in main and routes clicks back", async () => {
    const { api, mainWindow, rendererContents } = bridge();
    // The fake ipcRenderer returns handler results as-is; await both shapes.
    expect(await api.notifications?.isSupported()).toBe(true);
    expect(
      await api.notifications?.show({
        title: "任务已完成",
        body: "周报",
        tag: "echo-attention:t1",
        href: "/workspace/realtime/t1",
        threadId: "t1",
      }),
    ).toEqual({ ok: true, id: "echo-attention:t1" });
    const [note] = FakeNotification.shown;
    expect(note?.options).toEqual({
      title: "任务已完成",
      body: "周报",
      silent: false,
    });
    note?.emit("click");
    expect(mainWindow.focus).toHaveBeenCalled();
    expect(rendererContents.send).toHaveBeenCalledWith("notification:clicked", {
      href: "/workspace/realtime/t1",
      threadId: "t1",
      tag: "echo-attention:t1",
    });
  });

  it("does not install dependencies in development mode", async () => {
    const { api, ensureOptionalDeps } = bridge({ packaged: false });
    await expect(
      api.backend.ensureOptionalDeps("browser"),
    ).resolves.toMatchObject({ ok: false });
    expect(ensureOptionalDeps).not.toHaveBeenCalled();
  });
});
