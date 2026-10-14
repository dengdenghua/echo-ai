import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import commands from "./extension-commands.cjs";

const extension = (id, commands) => ({ id, manifest: { commands } });
const probe = extension("probe", { run: { suggested_key: "Ctrl+Shift+Y" } });
const input = { type: "keyDown", key: "Y", control: true, shift: true };

describe("extension command assignment and delivery", () => {
  it("matches exact modifiers and platform-specific suggestions", () => {
    expect(commands.commandForInput([probe], input, "win32").name).toBe("run");
    expect(
      commands.commandForInput([probe], { ...input, alt: true }, "win32"),
    ).toBeNull();
    expect(
      commands.commandForInput([probe], { ...input, type: "keyUp" }, "win32"),
    ).toBeNull();
    expect(
      commands.commandForInput(
        [probe],
        { ...input, isAutoRepeat: true },
        "win32",
      ),
    ).toBeNull();
    expect(commands.shortcutKey("Ctrl+Y", "darwin")).toBe(
      commands.shortcutKey("Command+Y", "darwin"),
    );
    expect(commands.shortcutKey("MacCtrl+Y", "darwin")).not.toBe(
      commands.shortcutKey("Ctrl+Y", "darwin"),
    );
  });

  it("reports collisions, global commands and reserved keys as unbound", () => {
    const rows = commands.commandAssignments(
      [
        probe,
        extension("other", {
          collision: { suggested_key: "Ctrl+Shift+Y" },
          global: { suggested_key: "Ctrl+Shift+5", global: true },
          reserved: { suggested_key: "Ctrl+L" },
          altgr: { suggested_key: "Ctrl+Alt+Y" },
        }),
      ],
      "win32",
    );
    expect(rows.map((row) => row.shortcut)).toEqual([
      "Ctrl+Shift+Y",
      "",
      "",
      "",
      "",
    ]);
    expect(commands.commandAssignments([], "win32")).toEqual([]);
  });

  it("dispatches only from an eligible tab and routes action commands separately", () => {
    const contents = Object.assign(new EventEmitter(), { id: 42 });
    const dispatch = vi.fn();
    const clickAction = vi.fn();
    let eligible = false;
    let installed = [probe];
    commands.watchCommands(contents, {
      eligible: () => eligible,
      extensions: () => installed,
      dispatch,
      clickAction,
      tab: () => ({ id: 42 }),
    });
    const event = { preventDefault: vi.fn() };
    const currentInput =
      process.platform === "darwin"
        ? { ...input, control: false, meta: true }
        : input;
    contents.emit("before-input-event", event, currentInput);
    expect(dispatch).not.toHaveBeenCalled();
    eligible = true;
    contents.emit("before-input-event", event, currentInput);
    expect(dispatch).toHaveBeenCalledWith(
      "probe",
      "commands.onCommand",
      ["run", { id: 42 }],
      { wake: true },
    );
    installed = [
      extension("action", {
        _execute_action: { suggested_key: "Ctrl+Shift+Y" },
      }),
    ];
    contents.emit("before-input-event", event, currentInput);
    expect(clickAction).toHaveBeenCalledWith("action", 42);
    expect(dispatch).toHaveBeenCalledTimes(1);
    installed = [];
    contents.emit("before-input-event", event, currentInput);
    expect(clickAction).toHaveBeenCalledTimes(1);
  });
});
