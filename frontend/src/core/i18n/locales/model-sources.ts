export function modelSourceCopy(locale: string) {
  return locale.startsWith("zh")
    ? {
        official: "CodeBuddy 官方积分",
        modelSourceLabel: "模型来源",
        codebuddySettingsDescription: "官方账号授权与积分用量",
        subscription: "Codex 订阅",
        api: "Codex API",
        manage: "管理模型与账号",
        failed: "保存模型选择失败，请重试",
        loading: "正在读取模型",
        unavailable: "部分模型来源暂不可用",
        default: "默认模型",
        noModels: "暂无可选模型",
        codebuddyEmpty:
          "未能读取 CodeBuddy 官方模型，请在“管理模型与账号”中刷新连接。",
      }
    : {
        official: "CodeBuddy credits",
        modelSourceLabel: "Model source",
        codebuddySettingsDescription:
          "Official account authorization and credits",
        subscription: "Codex subscription",
        api: "Codex API",
        manage: "Manage models and accounts",
        failed: "Could not save this selection. Retry.",
        loading: "Loading models",
        unavailable: "Some model sources are unavailable",
        default: "Default model",
        noModels: "No models available",
        codebuddyEmpty:
          "Could not load CodeBuddy official models. Refresh the connection in Manage models and accounts.",
      };
}

export function codeBuddyConnectionCopy(locale: string) {
  return locale.startsWith("zh")
    ? {
        description:
          "使用 CodeBuddy 中国站官方账号与积分。本机 CLI 登录后，Echo 自动沿用授权，无需复制令牌。",
        authorization: "本机授权",
        checking: "正在检测 CLI…",
        unavailable: "无法读取连接状态",
        detected: "已检测到官方 CLI",
        callFailed: "最近调用失败，请检查授权与用量",
        loginHint: "授权是否有效，以实际调用为准；安装就绪不代表已登录。",
        opening: "正在打开…",
        signIn: "登录 / 重新授权",
        refresh: "刷新连接状态",
        loginOpened:
          "已打开官方 CLI。输入 /login，选择中国站完成登录，然后返回此处刷新。",
        loginFailed: "无法打开登录窗口",
        adminHint: "本机账号授权由实例管理员管理。",
        platformHint:
          "此平台暂不支持从 Echo 打开登录窗口，请按官方登录说明在本机 CLI 登录。",
        creditsTitle: "剩余积分与套餐",
        creditsDescription:
          "在官方个人中心查看可用积分、套餐额度和消耗明细。当前 Echo 接入未同步积分余额，不会把 Token 数当成剩余积分。",
        viewCredits: "查看剩余积分",
        signInGuide: "官方登录说明",
        verified: (model?: string | null) =>
          `最近调用通过${model ? ` · ${model}` : ""}`,
        modelCount: (count: number | string) => `可选官方模型：${count} 个`,
      }
    : {
        description:
          "Uses the official CodeBuddy China account and credits. Echo reuses the local CLI login; no token import is needed.",
        authorization: "Local authorization",
        checking: "Checking CLI…",
        unavailable: "Connection status unavailable",
        detected: "Official CLI detected",
        callFailed: "Recent call failed; check login and usage",
        loginHint:
          "Login validity is confirmed by an actual call, not CLI installation.",
        opening: "Opening…",
        signIn: "Sign in / Reauthorize",
        refresh: "Refresh connection",
        loginOpened:
          "The official CLI is open. Enter /login, choose the Chinese site, then return and refresh.",
        loginFailed: "Could not open the login window",
        adminHint: "The instance administrator manages the machine account.",
        platformHint:
          "Open the CLI on this platform and follow the official sign-in guide.",
        creditsTitle: "Remaining credits and plan",
        creditsDescription:
          "View credits, plan allowances and usage history in the official account center. Echo does not currently sync the balance or estimate credits from token counts.",
        viewCredits: "View remaining credits",
        signInGuide: "Official sign-in guide",
        verified: (_model?: string | null) => "Recent call verified",
        modelCount: (count: number | string) => `Official models: ${count}`,
      };
}
