import { EchoAPIError } from "../api/client";

export function threadDeleteErrorMessage(error: unknown): string {
  if (!(error instanceof EchoAPIError))
    return "删除未完成，请检查网络后重试。对话已保留。";
  const detail = error.detail;
  const code =
    detail && typeof detail === "object" && "code" in detail
      ? detail.code
      : null;
  switch (code) {
    case "THREAD_PROJECT_BOUND":
      return "这条对话仍关联项目，暂时无法删除。关闭项目能力不会解散工作群；对话和群聊数据已保留。";
    case "THREAD_TURN_ACTIVE":
      return "这条对话正在执行任务，请先停止任务或等待完成，再删除。";
    case "THREAD_ASYNC_WORK_ACTIVE":
      return "这条对话还有后台协作任务，请先停止任务或等待完成，再删除。";
    case "THREAD_ROOM_LINKED":
    case "THREAD_GROUP_LINKED":
      return "这条对话仍关联协作工作群，当前版本尚不支持直接删除关联群聊。移除项目不会解散工作群；对话和群聊数据已保留。";
  }
  if (
    typeof detail === "string" &&
    detail.includes("managed thread workspace")
  ) {
    return "工作目录归属校验未通过，暂时无法删除。对话和文件已保留，请检查工作目录配置。";
  }
  if (error.status === 401) return "登录已失效，请重新登录后删除。";
  if (error.status === 403) return "当前账号没有删除这条对话的权限。";
  if (error.status === 404)
    return "对话已不存在或当前账号无法访问，列表已刷新。";
  return "删除未完成，请稍后重试。对话已保留。";
}

/** Translate known execution failures, including wrappers in saved history. */
export function publicExecutionErrorMessage(message: string): string {
  if (/model is unavailable|model_unavailable|model_not_found/i.test(message)) {
    return "所选模型当前不可用，请在输入框选择其他模型后重试。";
  }
  if (/free tier can only be used in opencode/i.test(message)) {
    return "当前 Zen 免费模型仅支持 OpenCode 引擎，请在输入框切换引擎后重试。";
  }
  if (message.includes("Responses tool catalog is too large")) {
    return "当前任务加载的工具过多，已超过执行接口上限。请减少启用的插件或工具后重试。";
  }
  return message;
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }

    const nestedError = Reflect.get(error, "error");
    if (nestedError instanceof Error && nestedError.message.trim()) {
      return nestedError.message;
    }
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError;
    }
  }

  return null;
}

export function getStreamErrorMessage(
  error: unknown,
  streamEndpointUnavailableMessage: string,
): string {
  const message = readErrorMessage(error);
  if (!message) {
    return "Request failed.";
  }

  if (/^Stream failed:\s*(404|503)\b/i.test(message)) {
    return streamEndpointUnavailableMessage;
  }

  return publicExecutionErrorMessage(message);
}
