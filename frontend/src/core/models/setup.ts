let pendingCustomModelSetup = false;
export const CUSTOM_MODEL_SETUP_EVENT = "echo:add-custom-model";

export function openCustomModelSetup() {
  pendingCustomModelSetup = true;
  window.dispatchEvent(
    new CustomEvent("echo:open-settings", { detail: { tab: "models" } }),
  );
  window.dispatchEvent(new Event(CUSTOM_MODEL_SETUP_EVENT));
}

export function consumeCustomModelSetup() {
  const pending = pendingCustomModelSetup;
  pendingCustomModelSetup = false;
  return pending;
}
