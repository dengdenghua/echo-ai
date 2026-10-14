/**
 * Copy for the clarification questionnaire an agent posts when it needs
 * several answers (components/workspace/clarification-questionnaire.tsx).
 * Answer labels end up in the user's reply, so they follow the UI language.
 */

export interface QuestionnaireCopy {
  defaultTitle: string;
  confirmAnswers: string;
  allQuestions: string;
  stepOf: (step: number, total: number) => string;
  oneByOne: string;
  viewAll: string;
  edit: string;
  editQuestion: (index: number) => string;
  multipleHint: string;
  singleHint: string;
  freeTextHint: string;
  /** The option that hands the decision back to the agent… */
  undecidedOption: string;
  /** …and how that choice reads in the submitted reply. */
  undecidedAnswer: string;
  unanswered: string;
  answerSeparator: string;
  noteFor: (title: string) => string;
  footerHint: string;
  back: string;
  notSure: string;
  preview: string;
  next: string;
  submit: string;
  openLarge: string;
  startOrContinue: string;
  collapse: string;
  continueFilling: string;
  submitted: string;
  pagedSummary: (total: number) => string;
  dialogPaged: (total: number) => string;
  dialogSingle: string;
}

const zhCN: QuestionnaireCopy = {
  defaultTitle: "完善需求",
  confirmAnswers: "确认回答",
  allQuestions: "查看全部问题",
  stepOf: (step, total) => `第 ${step} / ${total} 题`,
  oneByOne: "逐题填写",
  viewAll: "查看全部",
  edit: "修改",
  editQuestion: (index) => `修改第 ${index} 题`,
  multipleHint: "（可多选）",
  singleHint: "（单选）",
  freeTextHint: "（填写）",
  undecidedOption: "还没想好，让 AI 建议",
  undecidedAnswer: "还没想好，请给我建议",
  unanswered: "暂未回答",
  answerSeparator: "；",
  noteFor: (title) => `补充回答：${title}`,
  footerHint: "可先回答一部分，也可直接在对话中补充。不会自动提交或立项。",
  back: "上一步",
  notSure: "暂不确定",
  preview: "预览回答",
  next: "下一步",
  submit: "提交回答",
  openLarge: "放大填写",
  startOrContinue: "开始 / 继续填写",
  collapse: "收起",
  continueFilling: "继续填写",
  submitted: "回答已提交",
  pagedSummary: (total) =>
    `共 ${total} 题 · 逐题填写，最后统一确认。关闭后保留草稿。`,
  dialogPaged: (total) => `共 ${total} 题 · 逐题填写需求`,
  dialogSingle: "请核对或修改需求问卷",
};

const enUS: QuestionnaireCopy = {
  defaultTitle: "Clarify the request",
  confirmAnswers: "Confirm answers",
  allQuestions: "All questions",
  stepOf: (step, total) => `Question ${step} of ${total}`,
  oneByOne: "One at a time",
  viewAll: "View all",
  edit: "Edit",
  editQuestion: (index) => `Edit question ${index}`,
  multipleHint: " (choose any)",
  singleHint: " (choose one)",
  freeTextHint: " (write in)",
  undecidedOption: "Not sure yet — let the AI suggest",
  undecidedAnswer: "Not sure yet, please suggest",
  unanswered: "Not answered",
  answerSeparator: "; ",
  noteFor: (title) => `Additional answer: ${title}`,
  footerHint:
    "Answer some now or add details in the chat. Nothing is submitted or turned into a project automatically.",
  back: "Back",
  notSure: "Not sure",
  preview: "Review answers",
  next: "Next",
  submit: "Submit answers",
  openLarge: "Open larger",
  startOrContinue: "Start / continue",
  collapse: "Collapse",
  continueFilling: "Continue",
  submitted: "Answers submitted",
  pagedSummary: (total) =>
    `${total} questions · answer one at a time and confirm at the end. Your draft is kept if you close it.`,
  dialogPaged: (total) => `${total} questions · one at a time`,
  dialogSingle: "Check or edit the questionnaire",
};

const jaJP: QuestionnaireCopy = {
  defaultTitle: "要件の確認",
  confirmAnswers: "回答を確認",
  allQuestions: "すべての質問",
  stepOf: (step, total) => `質問 ${step} / ${total}`,
  oneByOne: "1 問ずつ回答",
  viewAll: "すべて表示",
  edit: "修正",
  editQuestion: (index) => `質問 ${index} を修正`,
  multipleHint: "（複数選択可）",
  singleHint: "（1 つ選択）",
  freeTextHint: "（記入）",
  undecidedOption: "まだ決めていない — AI に提案してもらう",
  undecidedAnswer: "まだ決めていません。提案してください",
  unanswered: "未回答",
  answerSeparator: "、",
  noteFor: (title) => `補足回答：${title}`,
  footerHint:
    "一部だけ回答しても、会話で補足しても構いません。自動で送信やプロジェクト化はされません。",
  back: "戻る",
  notSure: "わからない",
  preview: "回答をプレビュー",
  next: "次へ",
  submit: "回答を送信",
  openLarge: "大きく開く",
  startOrContinue: "開始 / 続きから",
  collapse: "折りたたむ",
  continueFilling: "続けて回答",
  submitted: "回答を送信しました",
  pagedSummary: (total) =>
    `全 ${total} 問 · 1 問ずつ回答し、最後にまとめて確認します。閉じても下書きは残ります。`,
  dialogPaged: (total) => `全 ${total} 問 · 1 問ずつ回答`,
  dialogSingle: "質問票を確認または修正してください",
};

const koKR: QuestionnaireCopy = {
  defaultTitle: "요구 사항 확인",
  confirmAnswers: "답변 확인",
  allQuestions: "전체 질문",
  stepOf: (step, total) => `질문 ${step} / ${total}`,
  oneByOne: "한 문항씩",
  viewAll: "전체 보기",
  edit: "수정",
  editQuestion: (index) => `질문 ${index} 수정`,
  multipleHint: " (여러 개 선택)",
  singleHint: " (하나 선택)",
  freeTextHint: " (직접 입력)",
  undecidedOption: "아직 모르겠어요 — AI에게 제안받기",
  undecidedAnswer: "아직 정하지 못했어요. 제안해 주세요",
  unanswered: "답변 없음",
  answerSeparator: "; ",
  noteFor: (title) => `추가 답변: ${title}`,
  footerHint:
    "일부만 답하거나 대화에서 보충해도 됩니다. 자동으로 제출하거나 프로젝트로 만들지 않습니다.",
  back: "이전",
  notSure: "잘 모르겠어요",
  preview: "답변 미리보기",
  next: "다음",
  submit: "답변 제출",
  openLarge: "크게 열기",
  startOrContinue: "시작 / 이어서",
  collapse: "접기",
  continueFilling: "이어서 답하기",
  submitted: "답변을 제출했습니다",
  pagedSummary: (total) =>
    `총 ${total}문항 · 한 문항씩 답한 뒤 마지막에 확인합니다. 닫아도 초안은 남습니다.`,
  dialogPaged: (total) => `총 ${total}문항 · 한 문항씩`,
  dialogSingle: "질문지를 확인하거나 수정하세요",
};

export function questionnaireCopy(locale: string): QuestionnaireCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
