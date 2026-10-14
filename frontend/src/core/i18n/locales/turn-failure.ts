/**
 * Copy for execution failures that are translated from raw runtime errors
 * (core/threads/errors.ts) and for the setup actions a turn offers when no
 * model can run it (components/workspace/messages/model-setup-actions.tsx).
 */

export interface TurnFailureCopy {
  modelUnavailable: string;
  freeTierNeedsOpencode: string;
  noModel: string;
  /** The failure card's heading for ``noModel``. */
  noModelTitle: string;
  toolCatalogTooLarge: string;
  setup: {
    installOpencode: string;
    opencodeReady: string;
    signIn: string;
    addModel: string;
  };
}

const zhCN: TurnFailureCopy = {
  modelUnavailable: "所选模型当前不可用，请在输入框选择其他模型后重试。",
  freeTierNeedsOpencode:
    "当前 Zen 免费模型仅支持 OpenCode 引擎，请在输入框切换引擎后重试。",
  noModel:
    "还没有可用的模型：登录 Echo 账号使用官方模型，或安装 OpenCode 使用免费模型，也可以添加自己的模型。",
  noModelTitle: "先连接一个模型",
  toolCatalogTooLarge:
    "当前任务加载的工具过多，已超过执行接口上限。请减少启用的插件或工具后重试。",
  setup: {
    installOpencode: "安装 OpenCode（免费）",
    opencodeReady: "OpenCode 已就绪，重新发送即可",
    signIn: "登录 Echo 账号",
    addModel: "添加模型",
  },
};

const enUS: TurnFailureCopy = {
  modelUnavailable:
    "The selected model is unavailable. Pick another model in the composer and try again.",
  freeTierNeedsOpencode:
    "Zen free models only run on the OpenCode engine. Switch the engine in the composer and try again.",
  noModel:
    "No model is available yet: sign in to an Echo account for the official models, install OpenCode for free models, or add your own model.",
  noModelTitle: "Connect a model first",
  toolCatalogTooLarge:
    "This task loaded more tools than the execution API allows. Turn off some plugins or tools and try again.",
  setup: {
    installOpencode: "Install OpenCode (free)",
    opencodeReady: "OpenCode is ready. Send again",
    signIn: "Sign in to Echo",
    addModel: "Add a model",
  },
};

const jaJP: TurnFailureCopy = {
  modelUnavailable:
    "選択したモデルは現在利用できません。入力欄で別のモデルを選んでもう一度お試しください。",
  freeTierNeedsOpencode:
    "Zen の無料モデルは OpenCode エンジンでのみ動作します。入力欄でエンジンを切り替えてもう一度お試しください。",
  noModel:
    "利用できるモデルがまだありません。Echo アカウントにログインして公式モデルを使うか、OpenCode をインストールして無料モデルを使うか、独自のモデルを追加してください。",
  noModelTitle: "まずモデルを接続してください",
  toolCatalogTooLarge:
    "このタスクで読み込んだツールが実行 API の上限を超えています。プラグインやツールを減らしてもう一度お試しください。",
  setup: {
    installOpencode: "OpenCode をインストール（無料）",
    opencodeReady: "OpenCode の準備ができました。もう一度送信してください",
    signIn: "Echo にログイン",
    addModel: "モデルを追加",
  },
};

const koKR: TurnFailureCopy = {
  modelUnavailable:
    "선택한 모델을 지금 사용할 수 없습니다. 입력창에서 다른 모델을 고른 뒤 다시 시도하세요.",
  freeTierNeedsOpencode:
    "Zen 무료 모델은 OpenCode 엔진에서만 동작합니다. 입력창에서 엔진을 바꾼 뒤 다시 시도하세요.",
  noModel:
    "아직 사용할 수 있는 모델이 없습니다. Echo 계정에 로그인해 공식 모델을 쓰거나, OpenCode를 설치해 무료 모델을 쓰거나, 직접 모델을 추가하세요.",
  noModelTitle: "먼저 모델을 연결하세요",
  toolCatalogTooLarge:
    "이 작업이 불러온 도구가 실행 API 한도를 넘었습니다. 플러그인이나 도구를 줄인 뒤 다시 시도하세요.",
  setup: {
    installOpencode: "OpenCode 설치 (무료)",
    opencodeReady: "OpenCode가 준비됐습니다. 다시 보내세요",
    signIn: "Echo 로그인",
    addModel: "모델 추가",
  },
};

export function turnFailureCopy(locale: string): TurnFailureCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
