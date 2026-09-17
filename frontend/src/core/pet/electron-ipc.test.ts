import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

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
        return handler({ sender: "renderer" }, ...args);
      },
    },
  };
  runInNewContext(
    readFileSync(resolve("electron/preload.cjs"), "utf8"),
    { require: () => electron, process: desktopProcess },
  );
  if (!api) throw new Error("Preload did not expose the desktop API");
  return { api, petSidecar, ensureOptionalDeps, backendProgress };
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

  it("does not install dependencies in development mode", async () => {
    const { api, ensureOptionalDeps } = bridge({ packaged: false });
    await expect(
      api.backend.ensureOptionalDeps("browser"),
    ).resolves.toMatchObject({ ok: false });
    expect(ensureOptionalDeps).not.toHaveBeenCalled();
  });
});
