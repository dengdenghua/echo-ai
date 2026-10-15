import { useEffect } from "react";

/** Where Settings → 模型 should land when something asks it to set up a model. */
type SetupTarget = "custom" | "opencode";

let pendingSetup: SetupTarget | null = null;
export const CUSTOM_MODEL_SETUP_EVENT = "echo:add-custom-model";

function requestSetup(target: SetupTarget) {
  pendingSetup = target;
  window.dispatchEvent(
    new CustomEvent("echo:open-settings", { detail: { tab: "models" } }),
  );
  window.dispatchEvent(new Event(CUSTOM_MODEL_SETUP_EVENT));
}

/** Settings → 模型, with the form for the user's own API open. */
export function openCustomModelSetup() {
  requestSetup("custom");
}

/**
 * Settings → 模型 at OpenCode's Zen / Go connection, where the API Key goes.
 * Zen's free models answer only with a key.
 */
export function openOpencodeSetup() {
  requestSetup("opencode");
}

export function consumeModelSetup(): SetupTarget | null {
  const pending = pendingSetup;
  pendingSetup = null;
  return pending;
}

/** Runs the matching handler for a setup request, now and while mounted. */
export function useModelSetupRequests(
  onAddModel: () => void,
  onOpenOpencode: () => void,
) {
  useEffect(() => {
    const handle = () => {
      const target = consumeModelSetup();
      if (target === "custom") onAddModel();
      if (target === "opencode") onOpenOpencode();
    };
    handle();
    window.addEventListener(CUSTOM_MODEL_SETUP_EVENT, handle);
    return () => window.removeEventListener(CUSTOM_MODEL_SETUP_EVENT, handle);
  }, [onAddModel, onOpenOpencode]);
}
