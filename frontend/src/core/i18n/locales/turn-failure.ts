/**
 * Copy for execution failures that are translated from raw runtime errors
 * (core/threads/errors.ts), for the setup actions a turn offers when no
 * model can run it (components/workspace/messages/model-setup-actions.tsx),
 * and for the composer's first-run line
 * (components/workspace/chat-input-box/first-model-hint.tsx).
 *
 * Nothing here promises a free model: OpenCode Zen's free tier refuses
 * every client but OpenCode's own app, so ECHO AI cannot use it.
 */

export interface TurnFailureCopy {
  modelUnavailable: string;
  freeTierNeedsOpencode: string;
  noModel: string;
  /** The failure card's heading for ``noModel`` and the composer hint. */
  noModelTitle: string;
  /** The rest of the composer's first-run line, after ``noModelTitle``. */
  noModelHint: string;
  toolCatalogTooLarge: string;
  setup: {
    connectOpencode: string;
    addModel: string;
  };
}

const zhCN: TurnFailureCopy = {
  modelUnavailable: "所选模型当前不可用，请在输入框选择其他模型后重试。",
  freeTierNeedsOpencode:
    "OpenCode 的免费模型只对它自己的客户端开放，ECHO AI 无法使用。请添加一个模型，或连接 OpenCode Zen / Go。",
  noModel: "还没有可用的模型。添加一个模型后，重新发送即可。",
  noModelTitle: "先连接一个模型",
  noModelHint: "Echo 需要一个模型才能回答。",
  toolCatalogTooLarge:
    "当前任务加载的工具过多，已超过执行接口上限。请减少启用的插件或工具后重试。",
  setup: {
    connectOpencode: "连接 OpenCode",
    addModel: "添加模型",
  },
};

const enUS: TurnFailureCopy = {
  modelUnavailable:
    "The selected model is unavailable. Pick another model in the composer and try again.",
  freeTierNeedsOpencode:
    "OpenCode's free models only work in OpenCode's own app, so ECHO AI cannot use them. Add a model, or connect OpenCode Zen / Go.",
  noModel: "No model is available yet. Add a model, then send again.",
  noModelTitle: "Connect a model first",
  noModelHint: "Echo needs one to answer.",
  toolCatalogTooLarge:
    "This task loaded more tools than the execution API allows. Turn off some plugins or tools and try again.",
  setup: {
    connectOpencode: "Connect OpenCode",
    addModel: "Add a model",
  },
};

const jaJP: TurnFailureCopy = {
  modelUnavailable:
    "選択したモデルは現在利用できません。入力欄で別のモデルを選んでもう一度お試しください。",
  freeTierNeedsOpencode:
    "OpenCode の無料モデルは OpenCode 自身のアプリでしか使えないため、ECHO AI では利用できません。モデルを追加するか、OpenCode Zen / Go を接続してください。",
  noModel:
    "利用できるモデルがまだありません。モデルを追加してから、もう一度送信してください。",
  noModelTitle: "まずモデルを接続してください",
  noModelHint: "Echo が応答するにはモデルが必要です。",
  toolCatalogTooLarge:
    "このタスクで読み込んだツールが実行 API の上限を超えています。プラグインやツールを減らしてもう一度お試しください。",
  setup: {
    connectOpencode: "OpenCode を接続",
    addModel: "モデルを追加",
  },
};

const koKR: TurnFailureCopy = {
  modelUnavailable:
    "선택한 모델을 지금 사용할 수 없습니다. 입력창에서 다른 모델을 고른 뒤 다시 시도하세요.",
  freeTierNeedsOpencode:
    "OpenCode 무료 모델은 OpenCode 자체 앱에서만 쓸 수 있어 ECHO AI에서는 사용할 수 없습니다. 모델을 추가하거나 OpenCode Zen / Go를 연결하세요.",
  noModel:
    "아직 사용할 수 있는 모델이 없습니다. 모델을 추가한 뒤 다시 보내세요.",
  noModelTitle: "먼저 모델을 연결하세요",
  noModelHint: "Echo가 답하려면 모델이 필요합니다.",
  toolCatalogTooLarge:
    "이 작업이 불러온 도구가 실행 API 한도를 넘었습니다. 플러그인이나 도구를 줄인 뒤 다시 시도하세요.",
  setup: {
    connectOpencode: "OpenCode 연결",
    addModel: "모델 추가",
  },
};

export function turnFailureCopy(locale: string): TurnFailureCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
