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
};

export function executionEngineCopy(locale: string): ExecutionEngineCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
