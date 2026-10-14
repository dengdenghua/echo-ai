/**
 * Starter prompts under the new-conversation welcome
 * (components/workspace/welcome.tsx). A chip fills the composer; the user
 * finishes the sentence and sends.
 */

export type StarterId = "daily" | "code" | "data" | "doc";

export interface WelcomeStartersCopy {
  /** Group label for screen readers. */
  label: string;
  prompts: Record<StarterId, string>;
}

const zhCN: WelcomeStartersCopy = {
  label: "从一个例子开始",
  prompts: {
    daily: "帮我把下面的内容整理成要点清单，并标出需要跟进的事项：",
    code: "在当前文件夹里帮我实现：",
    data: "分析这份数据，找出关键趋势并画成图表：",
    doc: "帮我起草一份文档，主题是：",
  },
};

const enUS: WelcomeStartersCopy = {
  label: "Start from an example",
  prompts: {
    daily:
      "Turn the following into a list of key points and flag anything that needs follow-up:",
    code: "In the current folder, implement:",
    data: "Analyze this data, find the key trends and chart them:",
    doc: "Draft a document about:",
  },
};

const jaJP: WelcomeStartersCopy = {
  label: "例から始める",
  prompts: {
    daily:
      "次の内容を要点リストにまとめ、フォローが必要な項目に印を付けてください：",
    code: "現在のフォルダで次を実装してください：",
    data: "このデータを分析して主な傾向を見つけ、グラフにしてください：",
    doc: "次のテーマで文書の下書きを作ってください：",
  },
};

const koKR: WelcomeStartersCopy = {
  label: "예시로 시작하기",
  prompts: {
    daily:
      "아래 내용을 핵심 목록으로 정리하고 후속 조치가 필요한 항목을 표시해 주세요:",
    code: "현재 폴더에서 다음을 구현해 주세요:",
    data: "이 데이터를 분석해 주요 추세를 찾고 차트로 그려 주세요:",
    doc: "다음 주제로 문서 초안을 써 주세요:",
  },
};

export function welcomeStartersCopy(locale: string): WelcomeStartersCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
