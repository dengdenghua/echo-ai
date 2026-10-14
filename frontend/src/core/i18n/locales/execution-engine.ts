/**
 * Copy for the execution-engine picker and badge
 * (components/workspace/execution-engine-picker.tsx).
 *
 * Kept as its own typed module, like work-location.ts, so every locale gets
 * the same keys and Japanese/Korean users no longer fall back to English.
 */

export type ExecutionEngineReason =
  | "checking"
  | "disabled"
  | "tools_unavailable"
  | "executable_unavailable"
  | "not_installed"
  | "model_incompatible"
  | "account_required"
  | "account_unavailable"
  | "workspace_required"
  | "configuration_unavailable";

export interface ExecutionEngineCopy {
  title: string;
  auto: string;
  legacyNative: string;
  /** Why Codex cannot run right now, keyed by the backend's reason code. */
  reasons: Record<ExecutionEngineReason, string>;
  opencodeCheckSetup: string;
  /** Appended to the trigger's accessible name while the selection is unavailable. */
  unavailableSuffix: (reason: string) => string;
  selectedUnavailable: (engine: string, reason: string) => string;
  legacyNotice: string;
  autoDescription: (current?: string) => string;
  opencodeDescription: string;
  codexDescription: string;
  executedBy: (engine: string) => string;
  /** Freshness of the engine's last real chat call (engineVerificationLabel). */
  verification: { verified: string; failed: string; configured: string };
  /** A sent message the selected engine could not start (turn error
   * ``execution_unavailable``), keyed by the backend's reason code. */
  turnBlocked: {
    reasons: Partial<Record<ExecutionEngineReason, string>>;
    codexFallback: string;
    switchEngine: string;
    opencode: string;
  };
}

const zhCN: ExecutionEngineCopy = {
  title: "执行引擎",
  auto: "自动",
  legacyNative: "原生兼容模式",
  reasons: {
    checking: "正在检查 Codex 配置",
    disabled: "Codex 引擎未启用",
    tools_unavailable: "共享工具尚未就绪",
    executable_unavailable: "需要安装或配置 Codex",
    not_installed: "Codex 还没安装",
    model_incompatible: "选取后，在输入框选择订阅或 API 模型",
    account_required: "需要在模型设置中连接 Codex 账号",
    account_unavailable: "请检查 Codex 账号设置",
    workspace_required: "需要先选择工作目录",
    configuration_unavailable: "暂时无法读取 Codex 配置",
  },
  opencodeCheckSetup: "请检查 OpenCode 安装和模型配置",
  unavailableSuffix: (reason) => `（不可用：${reason}）`,
  selectedUnavailable: (engine, reason) =>
    `当前选择的 ${engine} 暂不可用：${reason}`,
  legacyNotice: "此会话保留了旧版原生配置，可切换到下方执行引擎。",
  autoDescription: (current) =>
    `按任务自动选择${current ? ` · 当前 ${current}` : ""}`,
  opencodeDescription: "使用 OpenCode 身份，支持官方免费模型",
  codexDescription: "使用 Codex 身份执行当前任务",
  executedBy: (engine) => `实际执行引擎：${engine}`,
  verification: {
    verified: "最近会话调用通过",
    failed: "最近会话调用失败，可重试",
    configured: "配置就绪，尚无近期调用验证",
  },
  turnBlocked: {
    reasons: {
      model_incompatible:
        "Codex 还没有可运行的模型。点「打开模型设置」登录 ChatGPT 账号，或在输入框的模型菜单里换一个可用模型。",
      account_required:
        "Codex 还没有连接账号。点「打开模型设置」登录 ChatGPT 账号。",
      account_unavailable:
        "Codex 账号凭据暂不可用。点「打开模型设置」重新连接账号。",
      executable_unavailable: "这台电脑上没有可用的 Codex，请检查安装。",
      not_installed:
        "这台电脑还没安装 Codex：在执行引擎菜单里点 Codex 安装，或到 HUB「应用」的执行引擎里安装。",
      disabled: "Codex 引擎尚未启用。",
      tools_unavailable: "执行工具尚未就绪，请稍后重试。",
      workspace_required: "Codex 需要一个工作目录，请先选择工作位置。",
      configuration_unavailable: "暂时无法读取 Codex 配置，请稍后重试。",
    },
    codexFallback: "Codex 暂时无法运行这条消息。",
    switchEngine: "也可以把执行引擎换成 OpenCode，用它的免费模型继续。",
    opencode: "OpenCode 暂时无法运行这条消息，请检查 OpenCode 安装和模型配置。",
  },
};

const enUS: ExecutionEngineCopy = {
  title: "Execution engine",
  auto: "Auto",
  legacyNative: "Legacy native mode",
  reasons: {
    checking: "Checking Codex configuration",
    disabled: "Codex is disabled",
    tools_unavailable: "Shared tools are not ready",
    executable_unavailable: "Install or configure Codex",
    not_installed: "Codex is not installed yet",
    model_incompatible:
      "Select this engine, then choose a subscription or API model",
    account_required: "Connect a Codex account in model settings",
    account_unavailable: "Check Codex account settings",
    workspace_required: "Select a workspace first",
    configuration_unavailable: "Codex configuration is unavailable",
  },
  opencodeCheckSetup: "Check the OpenCode installation and model configuration",
  unavailableSuffix: (reason) => ` (unavailable: ${reason})`,
  selectedUnavailable: (engine, reason) =>
    `${engine} is unavailable: ${reason}`,
  legacyNotice:
    "This session retains a legacy native setting. Choose an engine below to switch.",
  autoDescription: (current) =>
    `Choose per task${current ? ` · currently ${current}` : ""}`,
  opencodeDescription:
    "Use the OpenCode identity with official free or connected Zen models",
  codexDescription: "Run this task with the Codex identity",
  executedBy: (engine) => `Executed by ${engine}`,
  verification: {
    verified: "Recent session call verified",
    failed: "Recent session call failed; retry available",
    configured: "Configured; no recent call verification",
  },
  turnBlocked: {
    reasons: {
      model_incompatible:
        "Codex has no model it can run yet. Open model settings to sign in with ChatGPT, or pick another available model in the composer's model menu.",
      account_required:
        "Codex is not connected to an account. Open model settings to sign in with ChatGPT.",
      account_unavailable:
        "Codex account credentials are unavailable. Open model settings to reconnect the account.",
      executable_unavailable:
        "Codex is not available on this computer. Check the installation.",
      not_installed:
        "Codex is not installed on this computer yet. Click Codex in the execution engine menu to install it, or install it under HUB Apps · Execution engines.",
      disabled: "The Codex engine is disabled.",
      tools_unavailable:
        "Execution tools are not ready yet. Try again shortly.",
      workspace_required:
        "Codex needs a working directory. Choose a work location first.",
      configuration_unavailable:
        "The Codex configuration cannot be read right now. Try again shortly.",
    },
    codexFallback: "Codex cannot run this message right now.",
    switchEngine:
      " You can also switch the execution engine to OpenCode and continue with its free models.",
    opencode:
      "OpenCode cannot run this message right now. Check the OpenCode installation and model configuration.",
  },
};

const jaJP: ExecutionEngineCopy = {
  title: "実行エンジン",
  auto: "自動",
  legacyNative: "旧ネイティブ互換モード",
  reasons: {
    checking: "Codex の設定を確認しています",
    disabled: "Codex エンジンは無効です",
    tools_unavailable: "共有ツールの準備ができていません",
    executable_unavailable: "Codex のインストールまたは設定が必要です",
    not_installed: "Codex はまだインストールされていません",
    model_incompatible:
      "選択後、入力欄でサブスクリプションまたは API モデルを選んでください",
    account_required: "モデル設定で Codex アカウントを接続してください",
    account_unavailable: "Codex アカウントの設定を確認してください",
    workspace_required: "先に作業ディレクトリを選択してください",
    configuration_unavailable: "Codex の設定を読み込めません",
  },
  opencodeCheckSetup: "OpenCode のインストールとモデル設定を確認してください",
  unavailableSuffix: (reason) => `（利用不可：${reason}）`,
  selectedUnavailable: (engine, reason) =>
    `選択中の ${engine} は利用できません：${reason}`,
  legacyNotice:
    "このセッションには旧ネイティブ設定が残っています。下の実行エンジンに切り替えられます。",
  autoDescription: (current) =>
    `タスクごとに自動選択${current ? ` · 現在 ${current}` : ""}`,
  opencodeDescription: "OpenCode の ID で実行します。公式の無料モデルに対応",
  codexDescription: "このタスクを Codex の ID で実行します",
  executedBy: (engine) => `実行エンジン：${engine}`,
  verification: {
    verified: "最近のセッション呼び出しは成功しました",
    failed: "最近のセッション呼び出しは失敗しました。再試行できます",
    configured: "設定済み。最近の呼び出し検証はまだありません",
  },
  turnBlocked: {
    reasons: {
      model_incompatible:
        "Codex で実行できるモデルがまだありません。「モデル設定を開く」から ChatGPT にログインするか、入力欄のモデルメニューで利用できるモデルを選んでください。",
      account_required:
        "Codex にアカウントが接続されていません。「モデル設定を開く」から ChatGPT にログインしてください。",
      account_unavailable:
        "Codex のアカウント認証情報を利用できません。「モデル設定を開く」から再接続してください。",
      executable_unavailable:
        "このコンピューターで Codex を利用できません。インストールを確認してください。",
      not_installed:
        "このコンピューターにはまだ Codex がインストールされていません。実行エンジンのメニューで Codex をクリックするか、HUB の「アプリ」の実行エンジンからインストールしてください。",
      disabled: "Codex エンジンは無効です。",
      tools_unavailable:
        "実行ツールの準備ができていません。しばらくしてから再試行してください。",
      workspace_required:
        "Codex には作業ディレクトリが必要です。先に作業場所を選んでください。",
      configuration_unavailable:
        "Codex の設定を読み込めません。しばらくしてから再試行してください。",
    },
    codexFallback: "Codex は現在このメッセージを実行できません。",
    switchEngine:
      "実行エンジンを OpenCode に切り替えて、無料モデルで続けることもできます。",
    opencode:
      "OpenCode は現在このメッセージを実行できません。OpenCode のインストールとモデル設定を確認してください。",
  },
};

const koKR: ExecutionEngineCopy = {
  title: "실행 엔진",
  auto: "자동",
  legacyNative: "기존 네이티브 호환 모드",
  reasons: {
    checking: "Codex 구성을 확인하는 중",
    disabled: "Codex 엔진이 비활성화되어 있습니다",
    tools_unavailable: "공유 도구가 아직 준비되지 않았습니다",
    executable_unavailable: "Codex를 설치하거나 구성해야 합니다",
    not_installed: "Codex가 아직 설치되지 않았습니다",
    model_incompatible: "선택한 뒤 입력창에서 구독 또는 API 모델을 고르세요",
    account_required: "모델 설정에서 Codex 계정을 연결하세요",
    account_unavailable: "Codex 계정 설정을 확인하세요",
    workspace_required: "먼저 작업 디렉터리를 선택하세요",
    configuration_unavailable: "Codex 구성을 읽을 수 없습니다",
  },
  opencodeCheckSetup: "OpenCode 설치와 모델 구성을 확인하세요",
  unavailableSuffix: (reason) => ` (사용 불가: ${reason})`,
  selectedUnavailable: (engine, reason) =>
    `선택한 ${engine}을(를) 사용할 수 없습니다: ${reason}`,
  legacyNotice:
    "이 세션에는 기존 네이티브 설정이 남아 있습니다. 아래 실행 엔진으로 전환할 수 있습니다.",
  autoDescription: (current) =>
    `작업마다 자동 선택${current ? ` · 현재 ${current}` : ""}`,
  opencodeDescription: "OpenCode ID로 실행하며 공식 무료 모델을 지원합니다",
  codexDescription: "이 작업을 Codex ID로 실행합니다",
  executedBy: (engine) => `실행 엔진: ${engine}`,
  verification: {
    verified: "최근 세션 호출 성공",
    failed: "최근 세션 호출 실패, 다시 시도할 수 있음",
    configured: "구성 완료, 최근 호출 검증 없음",
  },
  turnBlocked: {
    reasons: {
      model_incompatible:
        "Codex가 실행할 수 있는 모델이 아직 없습니다. 모델 설정을 열어 ChatGPT에 로그인하거나 입력창의 모델 메뉴에서 사용 가능한 모델을 선택하세요.",
      account_required:
        "Codex에 계정이 연결되어 있지 않습니다. 모델 설정을 열어 ChatGPT에 로그인하세요.",
      account_unavailable:
        "Codex 계정 자격 증명을 사용할 수 없습니다. 모델 설정을 열어 다시 연결하세요.",
      executable_unavailable:
        "이 컴퓨터에서 Codex를 사용할 수 없습니다. 설치를 확인하세요.",
      not_installed:
        "이 컴퓨터에는 아직 Codex가 설치되지 않았습니다. 실행 엔진 메뉴에서 Codex를 클릭하거나 HUB '앱'의 실행 엔진에서 설치하세요.",
      disabled: "Codex 엔진이 비활성화되어 있습니다.",
      tools_unavailable:
        "실행 도구가 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.",
      workspace_required:
        "Codex에는 작업 디렉터리가 필요합니다. 먼저 작업 위치를 선택하세요.",
      configuration_unavailable:
        "지금은 Codex 구성을 읽을 수 없습니다. 잠시 후 다시 시도하세요.",
    },
    codexFallback: "Codex가 지금 이 메시지를 실행할 수 없습니다.",
    switchEngine:
      " 실행 엔진을 OpenCode로 바꿔 무료 모델로 계속할 수도 있습니다.",
    opencode:
      "OpenCode가 지금 이 메시지를 실행할 수 없습니다. OpenCode 설치와 모델 구성을 확인하세요.",
  },
};

function isExecutionEngineReason(
  copy: ExecutionEngineCopy,
  reason: string,
): reason is ExecutionEngineReason {
  return Object.hasOwn(copy.reasons, reason);
}

/** Readable, actionable text for a turn the selected engine could not start.
 *
 * The backend reports ``execution_unavailable`` with the engine and a reason
 * code; its own message is English diagnostics, so the UI words it here.
 */
export function engineSelectionFailureMessage(
  copy: ExecutionEngineCopy,
  engine: string | undefined,
  reason: string | undefined,
  detail: string,
): string {
  if (engine === "opencode") {
    // OpenCode readiness reasons are already written for people (Chinese).
    return /\p{Script=Han}/u.test(detail) ? detail : copy.turnBlocked.opencode;
  }
  const known =
    reason && isExecutionEngineReason(copy, reason)
      ? copy.turnBlocked.reasons[reason]
      : undefined;
  return (
    (known ?? copy.turnBlocked.codexFallback) + copy.turnBlocked.switchEngine
  );
}

export function executionEngineCopy(locale: string): ExecutionEngineCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
