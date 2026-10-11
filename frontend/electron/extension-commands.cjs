"use strict";

const KEYS = {
  Comma: ",",
  Period: ".",
  Space: " ",
  Up: "arrowup",
  Down: "arrowdown",
  Left: "arrowleft",
  Right: "arrowright",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  Insert: "insert",
  Delete: "delete",
  MediaNextTrack: "medianexttrack",
  MediaPlayPause: "mediaplaypause",
  MediaPrevTrack: "mediaprevtrack",
  MediaStop: "mediastop",
};

function shortcutKey(shortcut, platform) {
  if (typeof shortcut !== "string" || !shortcut) return null;
  const parts = shortcut.split("+");
  const rawKey = parts.pop();
  const key = /^[A-Z0-9]$/.test(rawKey) ? rawKey.toLowerCase() : KEYS[rawKey];
  if (!key || new Set(parts).size !== parts.length) return null;
  const modifiers = { control: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    if (part === "Ctrl")
      modifiers[platform === "darwin" ? "meta" : "control"] = true;
    else if (part === "Alt" || (part === "Option" && platform === "darwin"))
      modifiers.alt = true;
    else if (part === "Shift") modifiers.shift = true;
    else if (part === "Command" && platform === "darwin") modifiers.meta = true;
    else if (part === "MacCtrl" && platform === "darwin")
      modifiers.control = true;
    else return null;
  }
  const media = rawKey.startsWith("Media");
  if (
    media
      ? parts.length
      : !(modifiers.control || modifiers.meta || modifiers.alt)
  )
    return null;
  if ((modifiers.control || modifiers.meta) && modifiers.alt) return null;
  // The app's navigation, editing and window shortcuts retain priority.
  if ((modifiers.control || modifiers.meta) && /^[LWTNRFO]$/.test(rawKey))
    return null;
  return [
    modifiers.control,
    modifiers.alt,
    modifiers.shift,
    modifiers.meta,
    key,
  ].join(":");
}

function commandAssignments(extensions, platform = process.platform) {
  const occupied = new Set();
  const rows = [];
  const platformName = { win32: "windows", darwin: "mac", linux: "linux" }[
    platform
  ];
  for (const extension of extensions) {
    for (const [name, command] of Object.entries(
      extension.manifest?.commands || {},
    )) {
      const suggested = command?.suggested_key;
      const shortcut =
        typeof suggested === "string"
          ? suggested
          : suggested?.[platformName] || suggested?.default || "";
      const key = command?.global ? null : shortcutKey(shortcut, platform);
      const assigned = !!key && !occupied.has(key);
      if (assigned) occupied.add(key);
      rows.push({
        extensionId: extension.id,
        name,
        description: command?.description || "",
        shortcut: assigned ? shortcut : "",
        key: assigned ? key : null,
      });
    }
  }
  return rows;
}

function commandForInput(extensions, input, platform = process.platform) {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing)
    return null;
  const key = [
    !!input.control,
    !!input.alt,
    !!input.shift,
    !!input.meta,
    String(input.key).toLowerCase(),
  ].join(":");
  return (
    commandAssignments(extensions, platform).find((row) => row.key === key) ||
    null
  );
}

function watchCommands(
  contents,
  { eligible, extensions, clickAction, dispatch, tab },
) {
  contents.on("before-input-event", (event, input) => {
    if (event.defaultPrevented || !eligible()) return;
    const command = commandForInput(extensions(), input);
    if (!command) return;
    event.preventDefault();
    if (
      [
        "_execute_action",
        "_execute_browser_action",
        "_execute_page_action",
      ].includes(command.name)
    ) {
      void clickAction(command.extensionId, contents.id);
    } else {
      void dispatch(
        command.extensionId,
        "commands.onCommand",
        [command.name, tab()],
        { wake: true },
      );
    }
  });
}

module.exports = {
  commandAssignments,
  commandForInput,
  shortcutKey,
  watchCommands,
};
