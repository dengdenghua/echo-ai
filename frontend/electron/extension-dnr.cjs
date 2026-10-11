"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { WebContentsView } = require("electron");

const BOOTSTRAP_QUERY = "__echo-dnr-bootstrap";

/** Use Chromium's rule compiler and matcher, including its permission checks. */
function createNativeDnrHost({ session, preferencesPath }) {
  const controllers = new Map();
  let disposed = false;
  let preferences = { version: 1, extensions: {} };
  let preferencesError = null;
  try {
    if (fs.existsSync(preferencesPath)) {
      preferences = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
      if (
        preferences?.version !== 1 ||
        !preferences.extensions ||
        Array.isArray(preferences.extensions) ||
        typeof preferences.extensions !== "object" ||
        Object.values(preferences.extensions).some(
          (entry) =>
            typeof entry?.version !== "string" ||
            (entry.purged !== undefined && typeof entry.purged !== "boolean") ||
            !Array.isArray(entry.enabledRulesetIds) ||
            entry.enabledRulesetIds.some((id) => typeof id !== "string"),
        )
      )
        throw new Error("Invalid extension DNR preferences");
    }
  } catch (error) {
    preferencesError = new Error("Cannot load extension DNR preferences", {
      cause: error,
    });
  }

  function persist(next) {
    const temporary = `${preferencesPath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(temporary, preferencesPath);
      preferences = next;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function save(id, version, enabledRulesetIds) {
    persist({
      ...preferences,
      extensions: {
        ...preferences.extensions,
        [id]: { version, enabledRulesetIds },
      },
    });
  }

  async function nativeCall(controller, method, args = []) {
    if (
      disposed ||
      controller.closed ||
      controller.view.webContents.isDestroyed()
    )
      throw new Error("Extension DNR context is closed");
    const parameters = [...args];
    while (parameters.length && parameters.at(-1) === undefined)
      parameters.pop();
    return controller.view.webContents.executeJavaScript(`(async () => {
      const api = chrome.declarativeNetRequest;
      const method = ${JSON.stringify(method)};
      if (!api || !Object.hasOwn(api, method) || typeof api[method] !== "function")
        throw new Error("DNR method is unavailable: " + method);
      return await api[method](...${JSON.stringify(parameters)});
    })()`);
  }

  function ensure(extension) {
    if (disposed) throw new Error("Extension DNR host is closed");
    if (preferencesError) throw preferencesError;
    if (!extension) throw new Error("Extension is not loaded");
    if (controllers.has(extension.id)) return controllers.get(extension.id);
    const controller = {
      view: new WebContentsView({
        webPreferences: { session, sandbox: true, contextIsolation: true },
      }),
      closed: false,
      ready: null,
      tail: Promise.resolve(),
    };
    controllers.set(extension.id, controller);
    controller.ready = (async () => {
      await controller.view.webContents.loadURL(
        `chrome-extension://${extension.id}/manifest.json?${BOOTSTRAP_QUERY}`,
      );
      const saved = preferences.extensions[extension.id];
      if (saved?.purged) {
        // Electron unloads an extension without uninstalling Chromium's rule
        // files. A later installation of the same ID starts with fresh rules.
        for (const [get, update] of [
          ["getDynamicRules", "updateDynamicRules"],
          ["getSessionRules", "updateSessionRules"],
        ]) {
          const rules = await nativeCall(controller, get);
          if (rules.length)
            await nativeCall(controller, update, [
              { removeRuleIds: rules.map((rule) => rule.id) },
            ]);
        }
      }
      const resources =
        extension.manifest?.declarative_net_request?.rule_resources || [];
      if (!resources.length) {
        if (saved?.purged) save(extension.id, extension.version, []);
        return;
      }
      const ids = resources.map((resource) => resource.id);
      const enabled =
        saved?.version === extension.version
          ? saved.enabledRulesetIds.filter((id) => ids.includes(id))
          : resources
              .filter((resource) => resource.enabled)
              .map((resource) => resource.id);
      // Unpacked Electron loads do not initialize manifest defaults. The
      // native API indexes the declared files and applies the complete rules.
      await nativeCall(controller, "updateEnabledRulesets", [
        {
          enableRulesetIds: enabled,
          disableRulesetIds: ids.filter((id) => !enabled.includes(id)),
        },
      ]);
      save(
        extension.id,
        extension.version,
        await nativeCall(controller, "getEnabledRulesets"),
      );
    })();
    // Callers receive initialization errors; keep an early worker invocation
    // from producing an unhandled rejection before the installer awaits it.
    controller.ready.catch(() => {});
    return controller;
  }

  async function prepare(extension) {
    const permissions = extension.manifest?.permissions || [];
    if (
      permissions.includes("declarativeNetRequest") ||
      permissions.includes("declarativeNetRequestWithHostAccess") ||
      extension.manifest?.declarative_net_request?.rule_resources?.length
    )
      await ensure(extension).ready;
  }

  async function invoke(extension, method, args) {
    const controller = ensure(extension);
    const operation = controller.tail.then(async () => {
      await controller.ready;
      const result = await nativeCall(controller, method, args);
      if (method === "updateEnabledRulesets")
        save(
          extension.id,
          extension.version,
          await nativeCall(controller, "getEnabledRulesets"),
        );
      return result;
    });
    controller.tail = operation.catch(() => {});
    return operation;
  }

  function forget(id, { purge = false } = {}) {
    const controller = controllers.get(id);
    controllers.delete(id);
    if (controller) {
      controller.closed = true;
      if (!controller.view.webContents.isDestroyed())
        controller.view.webContents.close();
    }
    if (purge && (controller || Object.hasOwn(preferences.extensions, id))) {
      persist({
        ...preferences,
        extensions: {
          ...preferences.extensions,
          [id]: { version: "", enabledRulesetIds: [], purged: true },
        },
      });
    }
  }

  function dispose() {
    disposed = true;
    for (const id of [...controllers.keys()]) forget(id);
  }

  return { prepare, invoke, forget, dispose };
}

module.exports = { createNativeDnrHost, BOOTSTRAP_QUERY };
