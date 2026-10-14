import { apiGet } from "@/core/api/request";

export async function pickLocalDirectory(
  defaultPath = "",
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  options.signal?.throwIfAborted();
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

  const result = await apiGet("/api/fs/pick-directory", {
    query: { default_path: defaultPath || undefined },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    errorMessage: (failure) =>
      `Folder picker request failed (${failure.status})`,
  });
  if (result.error) throw new Error(result.error);
  if (result.canceled || !result.path) return null;
  return result.path;
}
