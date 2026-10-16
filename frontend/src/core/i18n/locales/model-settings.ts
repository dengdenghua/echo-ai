/**
 * Copy for the model settings page
 * (components/workspace/settings/model-settings-page.tsx) and the sections
 * it renders from settings/model-settings/.
 */

export interface ModelSettingsPageCopy {
  overviewTitle: string;
  overviewSubtitle: string;
  currentDefault: string;
  noDefault: string;
  configuredModels: string;
  configuredSummary: (connections: number, models: number) => string;
  connectionsTitle: string;
  connectionsSubtitle: string;
  gateway: string;
  gatewayConnected: string;
  gatewayDisconnected: string;
  gatewayChecking: string;
  addApiModel: string;
  scanLocalModels: string;
  addConnection: string;
  formAdvancedTitle: string;
  formAdvancedSubtitle: string;
  codexTitle: string;
  codexSubtitle: string;
  visionTitle: string;
  visionSubtitle: string;
  advancedTitle: string;
  advancedSubtitle: string;
  advancedBadge: string;
  sameOriginProxy: string;
  compatDetails: string;
  compatMatrixTitle: string;
  compatMatrixDescription: string;
  compatProfileCount: (count: number) => string;
  compatProfilesLoading: string;
  compatProfilesUnavailable: string;
  compatScore: (score: string) => string;
  compatFallbacks: (count: number) => string;
  compatNormalize: (values: string) => string;
  compatDrops: (values: string) => string;
  compatRetries: (values: string) => string;
  compatRemaining: (count: number) => string;
  configuredDiagnosticsTitle: string;
  configuredDiagnosticsSubtitle: string;
  connectionToolsTitle: string;
  connectionToolsSubtitle: string;
  localToolsTitle: string;
  localToolsSubtitle: string;
  mixToolsTitle: string;
  mixToolsSubtitle: string;
  providerToolsTitle: string;
  providerToolsSubtitle: string;
  deletingDefault: (replacement: string | null) => string;
  deletedAndSwitched: (replacement: string) => string;
  deletedAndReset: string;
  retryLoad: string;
  showAll: string;
}

const MODEL_SETTINGS_PAGE_COPY: Record<
  "zh" | "en" | "ja" | "ko",
  ModelSettingsPageCopy
> = {
  zh: {
    overviewTitle: "默认模型",
    overviewSubtitle: "新对话默认使用，可在对话中单独切换。",
    currentDefault: "对话默认模型",
    noDefault: "未设置",
    configuredModels: "已接入 API 资源",
    configuredSummary: (connections, models) =>
      `${connections} 个连接 · ${models} 个模型`,
    connectionsTitle: "已连接的服务",
    connectionsSubtitle: "Key 与服务地址在这里统一管理。",
    gateway: "模型网关",
    gatewayConnected: "已连接",
    gatewayDisconnected: "未连接",
    gatewayChecking: "检查中",
    addApiModel: "接入 API 模型",
    scanLocalModels: "扫描本地模型",
    addConnection: "添加连接",
    formAdvancedTitle: "高级选项",
    formAdvancedSubtitle: "显示名称、协议与模型能力",
    codexTitle: "Codex 授权",
    codexSubtitle: "登录与管理 ChatGPT / Codex 账号",
    visionTitle: "本地图片理解",
    visionSubtitle: "管理图片与视频检索模型",
    advancedTitle: "高级设置",
    advancedSubtitle: "本地图片理解、自动路由与连接诊断",
    advancedBadge: "高级",
    sameOriginProxy: "同源代理",
    compatDetails: "查看兼容处理规则",
    compatMatrixTitle: "OpenAI 兼容配置矩阵",
    compatMatrixDescription:
      "内置的 OpenAI 兼容提供方预检矩阵。无需配置 API Key，即可查看请求归一化规则和失败后的兼容重试策略。",
    compatProfileCount: (count) => `${count} 个配置`,
    compatProfilesLoading: "正在加载兼容配置",
    compatProfilesUnavailable: "兼容配置目录暂不可用",
    compatScore: (score) => `兼容分 ${score}`,
    compatFallbacks: (count) => `${count} 次回退`,
    compatNormalize: (values) => `归一化：${values}`,
    compatDrops: (values) => `移除：${values}`,
    compatRetries: (values) => `重试：${values}`,
    compatRemaining: (count) => `后端目录中还有 ${count} 个配置。`,
    configuredDiagnosticsTitle: "已接入连接的兼容详情",
    configuredDiagnosticsSubtitle:
      "仅在排查提供方兼容问题时需要查看，不影响日常选择和使用模型。",
    connectionToolsTitle: "连接与网关诊断",
    connectionToolsSubtitle: "检查网关状态和已接入连接的兼容处理。",
    localToolsTitle: "本地模型推荐",
    localToolsSubtitle: "按当前设备能力查看可运行模型和下载建议。",
    mixToolsTitle: "多模型协同",
    mixToolsSubtitle: "配置多个模型共同起草和汇总答案。",
    providerToolsTitle: "提供方兼容矩阵",
    providerToolsSubtitle: "查看内置提供方的请求归一化与回退规则。",
    deletingDefault: (replacement) =>
      replacement
        ? `这是当前默认模型。删除后将自动切换到“${replacement}”。`
        : "这是当前默认模型。删除后将恢复为自动选择可用模型。",
    deletedAndSwitched: (replacement) =>
      `模型已删除，默认模型已切换到“${replacement}”。`,
    deletedAndReset: "模型已删除，默认模型已恢复为自动选择。",
    retryLoad: "重新加载",
    showAll: "查看全部",
  },
  en: {
    overviewTitle: "Default model",
    overviewSubtitle:
      "Used for new chats. You can switch models in each conversation.",
    currentDefault: "Chat default model",
    noDefault: "Not set",
    configuredModels: "API model connections",
    configuredSummary: (connections, models) =>
      `${connections} connection${connections === 1 ? "" : "s"} · ${models} model${models === 1 ? "" : "s"}`,
    connectionsTitle: "Connected services",
    connectionsSubtitle: "Manage keys and service addresses in one place.",
    gateway: "Model gateway",
    gatewayConnected: "Connected",
    gatewayDisconnected: "Disconnected",
    gatewayChecking: "Checking",
    addApiModel: "Add API model",
    scanLocalModels: "Scan local models",
    addConnection: "Add connection",
    formAdvancedTitle: "Advanced options",
    formAdvancedSubtitle: "Display name, protocol, and model capabilities",
    codexTitle: "Codex authorization",
    codexSubtitle: "Sign in and manage your ChatGPT / Codex account",
    visionTitle: "Local image understanding",
    visionSubtitle: "Manage the image and video search model",
    advancedTitle: "Advanced settings",
    advancedSubtitle:
      "Local image understanding, routing, and connection diagnostics",
    advancedBadge: "Advanced",
    sameOriginProxy: "Same-origin proxy",
    compatDetails: "View compatibility rules",
    compatMatrixTitle: "OpenAI-compatible profile matrix",
    compatMatrixDescription:
      "Built-in preflight matrix for OpenAI-compatible providers. Review request normalization and compatibility retries before configuring an API key.",
    compatProfileCount: (count) => `${count} profile${count === 1 ? "" : "s"}`,
    compatProfilesLoading: "Loading compatibility profiles",
    compatProfilesUnavailable: "Compatibility profile catalog unavailable",
    compatScore: (score) => `Compatibility ${score}`,
    compatFallbacks: (count) => `${count} fallback${count === 1 ? "" : "s"}`,
    compatNormalize: (values) => `Normalize: ${values}`,
    compatDrops: (values) => `Remove: ${values}`,
    compatRetries: (values) => `Retry: ${values}`,
    compatRemaining: (count) =>
      `${count} more profile${count === 1 ? "" : "s"} in the backend catalog.`,
    configuredDiagnosticsTitle: "Connection compatibility details",
    configuredDiagnosticsSubtitle:
      "Use these details only when troubleshooting a provider compatibility issue.",
    connectionToolsTitle: "Connections and gateway",
    connectionToolsSubtitle:
      "Inspect gateway health and compatibility handling for configured connections.",
    localToolsTitle: "Local model recommendations",
    localToolsSubtitle:
      "Review models that fit this device and optional download suggestions.",
    mixToolsTitle: "Multi-model collaboration",
    mixToolsSubtitle:
      "Configure models that draft independently and aggregate a final answer.",
    providerToolsTitle: "Provider compatibility matrix",
    providerToolsSubtitle:
      "Review built-in request normalization and fallback rules by provider.",
    deletingDefault: (replacement) =>
      replacement
        ? `This is the current default. Deleting it will switch the default to “${replacement}”.`
        : "This is the current default. Deleting it will restore automatic model selection.",
    deletedAndSwitched: (replacement) =>
      `Model deleted. The default is now “${replacement}”.`,
    deletedAndReset:
      "Model deleted. The default has returned to automatic selection.",
    retryLoad: "Reload",
    showAll: "Show all",
  },
  ja: {
    overviewTitle: "既定のモデル",
    overviewSubtitle: "新しい会話で使用します。会話ごとに切り替えられます。",
    currentDefault: "現在の既定",
    noDefault: "未設定",
    configuredModels: "API モデル接続",
    configuredSummary: (connections, models) =>
      `${connections} 接続 · ${models} モデル`,
    connectionsTitle: "接続済みサービス",
    connectionsSubtitle: "キーとサービスのアドレスをここで一元管理します。",
    gateway: "モデルゲートウェイ",
    gatewayConnected: "接続済み",
    gatewayDisconnected: "未接続",
    gatewayChecking: "確認中",
    addApiModel: "API モデルを追加",
    scanLocalModels: "ローカルモデルをスキャン",
    addConnection: "接続を追加",
    formAdvancedTitle: "詳細オプション",
    formAdvancedSubtitle: "表示名、プロトコル、モデルの機能",
    codexTitle: "Codex 認証",
    codexSubtitle: "ChatGPT / Codex アカウントへのログインと管理",
    visionTitle: "ローカル画像理解",
    visionSubtitle: "画像・動画検索モデルの管理",
    advancedTitle: "詳細設定",
    advancedSubtitle: "ローカル画像理解、自動ルーティング、接続診断",
    advancedBadge: "上級",
    sameOriginProxy: "同一オリジンプロキシ",
    compatDetails: "互換処理ルールを表示",
    compatMatrixTitle: "OpenAI 互換プロファイル一覧",
    compatMatrixDescription:
      "OpenAI 互換プロバイダー向けの組み込み事前確認一覧です。API キーを設定する前に、リクエストの正規化と互換リトライを確認できます。",
    compatProfileCount: (count) => `${count} 件のプロファイル`,
    compatProfilesLoading: "互換プロファイルを読み込み中",
    compatProfilesUnavailable: "互換プロファイル一覧を利用できません",
    compatScore: (score) => `互換性 ${score}`,
    compatFallbacks: (count) => `${count} 回のフォールバック`,
    compatNormalize: (values) => `正規化：${values}`,
    compatDrops: (values) => `削除：${values}`,
    compatRetries: (values) => `再試行：${values}`,
    compatRemaining: (count) =>
      `バックエンドの一覧に残り ${count} 件あります。`,
    configuredDiagnosticsTitle: "設定済み接続の互換性詳細",
    configuredDiagnosticsSubtitle:
      "プロバイダー互換性の問題を調査するときだけ確認してください。",
    connectionToolsTitle: "接続とゲートウェイ診断",
    connectionToolsSubtitle:
      "ゲートウェイ状態と接続ごとの互換処理を確認します。",
    localToolsTitle: "ローカルモデルの推奨",
    localToolsSubtitle: "この端末で動作するモデルと取得候補を確認します。",
    mixToolsTitle: "複数モデル連携",
    mixToolsSubtitle: "複数モデルによる下書きと最終統合を設定します。",
    providerToolsTitle: "プロバイダー互換マトリクス",
    providerToolsSubtitle: "組み込みの正規化とフォールバック規則を確認します。",
    deletingDefault: (replacement) =>
      replacement
        ? `現在の既定モデルです。削除後は「${replacement}」へ自動的に切り替わります。`
        : "現在の既定モデルです。削除後は利用可能なモデルの自動選択に戻ります。",
    deletedAndSwitched: (replacement) =>
      `モデルを削除し、既定モデルを「${replacement}」に切り替えました。`,
    deletedAndReset: "モデルを削除し、既定モデルを自動選択に戻しました。",
    retryLoad: "再読み込み",
    // Untranslated so far: Japanese and Korean show the English label.
    showAll: "Show all",
  },
  ko: {
    overviewTitle: "기본 모델",
    overviewSubtitle:
      "새 대화에서 사용합니다. 대화별로 모델을 변경할 수 있습니다.",
    currentDefault: "현재 기본값",
    noDefault: "미설정",
    configuredModels: "API 모델 연결",
    configuredSummary: (connections, models) =>
      `연결 ${connections}개 · 모델 ${models}개`,
    connectionsTitle: "연결된 서비스",
    connectionsSubtitle: "키와 서비스 주소를 한곳에서 관리합니다.",
    gateway: "모델 게이트웨이",
    gatewayConnected: "연결됨",
    gatewayDisconnected: "연결 안 됨",
    gatewayChecking: "확인 중",
    addApiModel: "API 모델 추가",
    scanLocalModels: "로컬 모델 스캔",
    addConnection: "연결 추가",
    formAdvancedTitle: "고급 옵션",
    formAdvancedSubtitle: "표시 이름, 프로토콜 및 모델 기능",
    codexTitle: "Codex 인증",
    codexSubtitle: "ChatGPT / Codex 계정 로그인 및 관리",
    visionTitle: "로컬 이미지 이해",
    visionSubtitle: "이미지 및 동영상 검색 모델 관리",
    advancedTitle: "고급 설정",
    advancedSubtitle: "로컬 이미지 이해, 자동 라우팅 및 연결 진단",
    advancedBadge: "고급",
    sameOriginProxy: "동일 출처 프록시",
    compatDetails: "호환 처리 규칙 보기",
    compatMatrixTitle: "OpenAI 호환 프로필 목록",
    compatMatrixDescription:
      "OpenAI 호환 제공자를 위한 내장 사전 점검 목록입니다. API 키를 설정하기 전에 요청 정규화와 호환 재시도 규칙을 확인할 수 있습니다.",
    compatProfileCount: (count) => `프로필 ${count}개`,
    compatProfilesLoading: "호환 프로필 불러오는 중",
    compatProfilesUnavailable: "호환 프로필 목록을 사용할 수 없음",
    compatScore: (score) => `호환성 ${score}`,
    compatFallbacks: (count) => `대체 시도 ${count}회`,
    compatNormalize: (values) => `정규화: ${values}`,
    compatDrops: (values) => `제거: ${values}`,
    compatRetries: (values) => `재시도: ${values}`,
    compatRemaining: (count) => `백엔드 목록에 프로필 ${count}개 더 있음.`,
    configuredDiagnosticsTitle: "연결된 모델의 호환성 상세",
    configuredDiagnosticsSubtitle:
      "제공자 호환성 문제를 진단할 때만 확인하면 됩니다.",
    connectionToolsTitle: "연결 및 게이트웨이 진단",
    connectionToolsSubtitle: "게이트웨이 상태와 연결별 호환 처리를 확인합니다.",
    localToolsTitle: "로컬 모델 추천",
    localToolsSubtitle:
      "이 기기에서 실행 가능한 모델과 다운로드 제안을 확인합니다.",
    mixToolsTitle: "다중 모델 협업",
    mixToolsSubtitle: "여러 모델의 초안 작성과 최종 통합을 설정합니다.",
    providerToolsTitle: "제공자 호환성 매트릭스",
    providerToolsSubtitle: "내장 요청 정규화와 대체 규칙을 확인합니다.",
    deletingDefault: (replacement) =>
      replacement
        ? `현재 기본 모델입니다. 삭제하면 기본 모델이 “${replacement}”(으)로 자동 전환됩니다.`
        : "현재 기본 모델입니다. 삭제하면 사용 가능한 모델 자동 선택으로 돌아갑니다.",
    deletedAndSwitched: (replacement) =>
      `모델을 삭제했고 기본 모델을 “${replacement}”(으)로 전환했습니다.`,
    deletedAndReset: "모델을 삭제했고 기본 모델을 자동 선택으로 되돌렸습니다.",
    retryLoad: "다시 불러오기",
    showAll: "Show all",
  },
};

export function modelSettingsPageCopy(locale: string): ModelSettingsPageCopy {
  const lang = (locale || "en").slice(0, 2).toLowerCase();
  if (lang === "zh") return MODEL_SETTINGS_PAGE_COPY.zh;
  if (lang === "ja") return MODEL_SETTINGS_PAGE_COPY.ja;
  if (lang === "ko") return MODEL_SETTINGS_PAGE_COPY.ko;
  return MODEL_SETTINGS_PAGE_COPY.en;
}
