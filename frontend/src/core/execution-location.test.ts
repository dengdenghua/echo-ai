import { afterEach, expect, it } from "vitest";
import {
  executionLocationURL,
  executionStorageKey,
  getRemoteExecutionId,
} from "./execution-location";
import {
  getLocalSettings,
  saveLocalSettings,
  getThreadModelName,
  saveThreadModelName,
} from "./settings/local";
import { loadComposerDraft, saveComposerDraft } from "./threads/composer-draft";

const original = window.location;
function location(url: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}
afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: original,
  });
  localStorage.clear();
});

it("accepts registered ids, never endpoint URLs or injected path segments", () => {
  location("http://localhost/?echoRemote=host-123#/workspace/realtime/new");
  expect(getRemoteExecutionId()).toBe("host-123");
  expect(executionStorageKey("echo:recentWorkdirs")).toBe(
    "echo.remote.host-123:echo:recentWorkdirs",
  );
  location(
    "http://localhost/?echoRemote=https%3A%2F%2Fevil.test#/workspace/realtime/new",
  );
  expect(getRemoteExecutionId()).toBeNull();
  location("http://localhost/?echoRemote=..%2Fhost#/workspace/realtime/new");
  expect(getRemoteExecutionId()).toBeNull();
});

it("switches to a fresh task without carrying local project ids, paths or prompts", () => {
  location(
    "http://localhost/ui/?echoBackend=http%3A%2F%2Flocalhost%3A8310&workspace_path=%2Fprivate&project_id=local&prompt=secret#/workspace/realtime/local-thread?workspace_path=%2Fprivate&project_id=local&prompt=secret",
  );
  const remote = new URL(executionLocationURL("host-123"));
  expect(remote.pathname).toBe("/ui/");
  expect(remote.searchParams.get("echoRemote")).toBe("host-123");
  expect(remote.searchParams.get("echoBackend")).toBe("http://localhost:8310");
  expect(remote.hash).toBe("#/workspace/realtime/new");
  expect(remote.searchParams.has("workspace_path")).toBe(false);
  expect(remote.searchParams.has("project_id")).toBe(false);
  expect(remote.searchParams.has("prompt")).toBe(false);
  location(remote.href);
  expect(
    new URL(executionLocationURL(null)).searchParams.has("echoRemote"),
  ).toBe(false);
});

it("isolates workspace defaults, model overrides and drafts between machines", () => {
  location("http://localhost/#/workspace/realtime/new");
  saveLocalSettings({
    ...getLocalSettings(),
    personal_space: {
      ...getLocalSettings().personal_space,
      default_folder: "/local/private",
    },
  });
  saveThreadModelName("same-thread", "local-model");
  saveComposerDraft("__new__", "local draft");
  location("http://localhost/?echoRemote=host-a#/workspace/realtime/new");
  expect(getLocalSettings().personal_space.default_folder).toBe("");
  expect(getThreadModelName("same-thread")).toBeUndefined();
  expect(loadComposerDraft("__new__")).toBeNull();
  saveThreadModelName("same-thread", "remote-model");
  saveComposerDraft("__new__", "remote draft");
  location("http://localhost/?echoRemote=host-b#/workspace/realtime/new");
  expect(loadComposerDraft("__new__")).toBeNull();
  location("http://localhost/#/workspace/realtime/new");
  expect(getLocalSettings().personal_space.default_folder).toBe(
    "/local/private",
  );
  expect(getThreadModelName("same-thread")).toBe("local-model");
  expect(loadComposerDraft("__new__")).toBe("local draft");
});
