import type { components } from "@/core/api/openapi-types";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { getRemoteExecutionId } from "@/core/execution-location";

type PickDirectoryResponse = components["schemas"]["FsPickDirectoryResponse"];

export async function pickLocalDirectory(
  defaultPath = "",
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  options.signal?.throwIfAborted();
  if (getRemoteExecutionId()) {
    // The native dialog belongs to this computer, not the selected runtime.
    // The shared workspace picker falls back to remote /api/fs/tree browsing.
    throw new Error(
      "Choose a remote folder using the directory browser or path input",
    );
  }
  if (window.echo?.dialog?.open) {
    const result = await window.echo.dialog.open({
      title: "选择工作区文件夹",
      buttonLabel: "选取",
      message: "请选择一个文件夹作为工作区",
      properties: ["openDirectory", "createDirectory"],
      defaultPath,
    });
    options.signal?.throwIfAborted();
    return result.canceled ? null : result.filePaths[0] || null;
  }

  const params = new URLSearchParams();
  if (defaultPath) params.set("default_path", defaultPath);
  const query = params.toString();
  const response = await fetch(
    `${getBackendBaseURL()}/api/fs/pick-directory${query ? `?${query}` : ""}`,
    {
      headers: authHeaders(),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Folder picker request failed (${response.status})`);
  }

  const result = (await response.json()) as PickDirectoryResponse;
  if (result.error) throw new Error(result.error);
  if (result.canceled || !result.path) return null;
  return result.path;
}
