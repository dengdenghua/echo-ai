/**
 * Copy for execution failures that are translated from raw runtime errors
 * (core/threads/errors.ts), for the setup actions a turn offers when no
 * model can run it (components/workspace/messages/model-setup-actions.tsx),
 * and for the composer's first-run line
 * (components/workspace/chat-input-box/first-model-hint.tsx).
 *
 * OpenCode Zen has free models, but they answer only with an OpenCode Zen
 * API Key; every mention says so instead of promising them without setup.
 */

export interface TurnFailureCopy {
  modelUnavailable: string;
  /** A Zen free model ran on an engine other than OpenCode. */
  freeTierNeedsOpencode: string;
  /** A Zen free model was asked without an OpenCode Zen API Key. */
  freeModelNeedsKey: string;
  noModel: string;
  /** The failure card's heading for ``noModel`` and the composer hint. */
  noModelTitle: string;
  /** The rest of the composer's first-run line, after ``noModelTitle``. */
  noModelHint: string;
  toolCatalogTooLarge: string;
  /** Codex's account sign-in has expired or cannot be read. */
  codexSignIn: string;
  setup: {
    connectOpencode: string;
    /** Tooltip on 连接 OpenCode: what the key unlocks. */
    connectOpencodeHint: string;
    addModel: string;
  };
}

const zhCN: TurnFailureCopy = {
  modelUnavailable: "所选模型当前不可用，请在输入框选择其他模型后重试。",
  freeTierNeedsOpencode:
    "当前 Zen 免费模型仅支持 OpenCode 引擎，请在输入框切换引擎后重试。",
  freeModelNeedsKey: "先在设置里连接 OpenCode Zen（免费，需要 API Key）。",
  noModel:
    "还没有可用的模型：连接 OpenCode Zen 使用免费模型（需要 API Key），或添加自己的模型。",
  noModelTitle: "先连接一个模型",
  noModelHint:
    "OpenCode Zen 有免费模型（需要 API Key），也可以添加自己的模型。",
  toolCatalogTooLarge:
    "当前任务加载的工具过多，已超过执行接口上限。请减少启用的插件或工具后重试。",
  codexSignIn:
    "Codex 的 ChatGPT 登录已失效或无法读取。请在设置 → 模型里重新登录，或换一个执行引擎。",
  setup: {
    connectOpencode: "连接 OpenCode",
    connectOpencodeHint: "免费模型，需连接 OpenCode Zen 并填入 API Key",
    addModel: "添加模型",
  },
};

const enUS: TurnFailureCopy = {
  modelUnavailable:
    "The selected model is unavailable. Pick another model in the composer and try again.",
  freeTierNeedsOpencode:
    "Zen free models only run on the OpenCode engine. Switch the engine in the composer and try again.",
  freeModelNeedsKey:
    "Connect OpenCode Zen in Settings first (free, needs an API key).",
  noModel:
    "No model is available yet: connect OpenCode Zen for free models (needs an API key), or add your own model.",
  noModelTitle: "Connect a model first",
  noModelHint:
    "OpenCode Zen has free models (needs an API key), or add your own.",
  toolCatalogTooLarge:
    "This task loaded more tools than the execution API allows. Turn off some plugins or tools and try again.",
  codexSignIn:
    "Codex's ChatGPT sign-in has expired or can't be read. Sign in again in Settings → Models, or pick another engine.",
  setup: {
    connectOpencode: "Connect OpenCode",
    connectOpencodeHint: "Free models; needs an OpenCode Zen API key",
    addModel: "Add a model",
  },
};

const jaJP: TurnFailureCopy = {
  modelUnavailable:
    "選択したモデルは現在利用できません。入力欄で別のモデルを選んでもう一度お試しください。",
  freeTierNeedsOpencode:
    "Zen の無料モデルは OpenCode エンジンでのみ動作します。入力欄でエンジンを切り替えてもう一度お試しください。",
  freeModelNeedsKey:
    "先に設定で OpenCode Zen を接続してください（無料、API キーが必要です）。",
  noModel:
    "利用できるモデルがまだありません。OpenCode Zen を接続して無料モデルを使うか（API キーが必要）、独自のモデルを追加してください。",
  noModelTitle: "まずモデルを接続してください",
  noModelHint:
    "OpenCode Zen には無料モデルがあります（API キーが必要）。独自のモデルも追加できます。",
  toolCatalogTooLarge:
    "このタスクで読み込んだツールが実行 API の上限を超えています。プラグインやツールを減らしてもう一度お試しください。",
  codexSignIn:
    "Codex の ChatGPT ログインが期限切れか、読み取れません。設定 → モデルで再ログインするか、別のエンジンを選んでください。",
  setup: {
    connectOpencode: "OpenCode を接続",
    connectOpencodeHint: "無料モデル。OpenCode Zen の API キーが必要です",
    addModel: "モデルを追加",
  },
};

const koKR: TurnFailureCopy = {
  modelUnavailable:
    "선택한 모델을 지금 사용할 수 없습니다. 입력창에서 다른 모델을 고른 뒤 다시 시도하세요.",
  freeTierNeedsOpencode:
    "Zen 무료 모델은 OpenCode 엔진에서만 동작합니다. 입력창에서 엔진을 바꾼 뒤 다시 시도하세요.",
  freeModelNeedsKey:
    "먼저 설정에서 OpenCode Zen을 연결하세요(무료, API 키 필요).",
  noModel:
    "아직 사용할 수 있는 모델이 없습니다. OpenCode Zen을 연결해 무료 모델을 쓰거나(API 키 필요) 직접 모델을 추가하세요.",
  noModelTitle: "먼저 모델을 연결하세요",
  noModelHint:
    "OpenCode Zen에는 무료 모델이 있습니다(API 키 필요). 직접 모델을 추가할 수도 있습니다.",
  toolCatalogTooLarge:
    "이 작업이 불러온 도구가 실행 API 한도를 넘었습니다. 플러그인이나 도구를 줄인 뒤 다시 시도하세요.",
  codexSignIn:
    "Codex의 ChatGPT 로그인이 만료되었거나 읽을 수 없습니다. 설정 → 모델에서 다시 로그인하거나 다른 엔진을 고르세요.",
  setup: {
    connectOpencode: "OpenCode 연결",
    connectOpencodeHint: "무료 모델, OpenCode Zen API 키 필요",
    addModel: "모델 추가",
  },
};

export function turnFailureCopy(locale: string): TurnFailureCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
