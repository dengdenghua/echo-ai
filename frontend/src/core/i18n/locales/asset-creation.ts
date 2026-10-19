import type { Locale } from "../locale";

export type CreationKind = "skill" | "app" | "plugin";

const copy = {
  "zh-CN": {
    skill: "生成技能",
    app: "生成应用",
    plugin: "生成插件",
    plugins: "插件",
    myApps: "我的应用",
    open: "打开",
    retry: "刷新",
    empty: "描述你需要的工具，生成一个可以打开交互的应用。",
    error: "无法读取我的应用，请重试。",
    reviewTask: "应用请求使用 AI 能力",
    cancel: "取消",
    prompt: "请先使用指定创建技能，根据我的需求生成并验证结果。",
  },
  "en-US": {
    skill: "Create skill",
    app: "Create app",
    plugin: "Create plugin",
    plugins: "Plugins",
    myApps: "My apps",
    open: "Open",
    retry: "Refresh",
    empty: "Describe a tool to create an interactive app you can open.",
    error: "Could not load your apps. Please try again.",
    reviewTask: "App requests AI capabilities",
    cancel: "Cancel",
    prompt:
      "Use the specified creator skill to build and validate what I need.",
  },
  "ja-JP": {
    skill: "スキルを作成",
    app: "アプリを作成",
    plugin: "プラグインを作成",
    plugins: "プラグイン",
    myApps: "マイアプリ",
    open: "開く",
    retry: "更新",
    empty: "必要なツールを説明して、操作できるアプリを作成します。",
    error: "アプリを読み込めませんでした。再試行してください。",
    reviewTask: "アプリからの AI 利用リクエスト",
    cancel: "キャンセル",
    prompt: "指定した作成スキルを使い、要件に合わせて生成し検証してください。",
  },
  "ko-KR": {
    skill: "스킬 만들기",
    app: "앱 만들기",
    plugin: "플러그인 만들기",
    plugins: "플러그인",
    myApps: "내 앱",
    open: "열기",
    retry: "새로 고침",
    empty: "필요한 도구를 설명하여 직접 사용할 수 있는 앱을 만드세요.",
    error: "앱을 불러오지 못했습니다. 다시 시도하세요.",
    reviewTask: "앱의 AI 기능 사용 요청",
    cancel: "취소",
    prompt: "지정된 생성 스킬로 요구 사항에 맞는 결과를 만들고 검증하세요.",
  },
};

export function creationCopy(locale: Locale) {
  return copy[locale] ?? copy["en-US"];
}

export function creationRoute(kind: CreationKind, locale: Locale): string {
  const prompt = `$${kind}-creator\n${creationCopy(locale).prompt}`;
  return `/workspace/realtime/new?prompt=${encodeURIComponent(prompt)}`;
}
