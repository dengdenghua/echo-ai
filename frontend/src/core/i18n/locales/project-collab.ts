/**
 * Copy for long-project collaboration in chat: the expanded parallel
 * collaborator card (inline-subagent-card-expansion.tsx) and the landmark
 * cards that decorate decision/sandbox/broadcast/merge messages
 * (project-collaboration-landmark.tsx).
 *
 * The Chinese markers those messages start with (``[项目决策固化]`` and
 * friends) are a stored data protocol and live as constants next to the
 * parser, not here. This module only holds what the user reads.
 */

export interface ProjectCollabCopy {
  collaboratorFallback: string;
  expansion: {
    perspectiveBadge: string;
    filesTouched: (count: number) => string;
    iterations: (count: number) => string;
    taskGoal: string;
    errorLabel: string;
    working: string;
    publish: string;
    published: string;
    publishHint: string;
    publishedToast: (name: string) => string;
    recordDecision: string;
    decisionRecorded: string;
    decisionHint: string;
    decisionToast: (name: string) => string;
    /** Text written after the decision marker when adopting a deliverable. */
    decisionAdopted: (name: string) => string;
    /** Text written after the decision marker when only a goal exists. */
    decisionGoal: (name: string) => string;
    sandbox: string;
    sandboxHint: string;
    sandboxToast: (name: string) => string;
    /** Line written after the sandbox marker in the new thread's prompt. */
    sandboxPromptIntro: string;
    followUp: string;
    followUpHint: string;
    followUpUnavailableHint: string;
    followUpToast: (name: string) => string;
    awaitingConfirmation: string;
    viewDetails: string;
    sendUnconfirmed: string;
    resultUnknown: string;
    openWorkbench: string;
    openWorkbenchHint: string;
  };
  landmark: {
    decisionTitle: string;
    decisionBadge: string;
    decisionTag: string;
    sandboxTitle: string;
    sandboxBadge: string;
    broadcastTitle: string;
    broadcastBadge: string;
    broadcastDelivery: (name: string) => string;
    broadcastProgress: (name: string) => string;
    mergeTitle: string;
    mergeBadge: string;
    mergeTag: string;
    copyDecision: string;
    copySandbox: string;
    copyMerge: string;
    copyBroadcast: string;
    enterSandbox: string;
    enteringSandbox: string;
  };
}

const zhCN: ProjectCollabCopy = {
  collaboratorFallback: "并列协作者",
  expansion: {
    perspectiveBadge: "我的第一视角 · 并列协作者",
    filesTouched: (count) => `修改了 ${count} 个文件`,
    iterations: (count) => `${count} 轮迭代`,
    taskGoal: "任务目标：",
    errorLabel: "遇到错误：",
    working: "并列协作者正在后台并行推进中，随时可查看执行画面或发送指令…",
    publish: "同步至群公共",
    published: "已同步至群公共",
    publishHint: "将该并列协作者产出的阶段性结果，一键发布到全群公共主对话中",
    publishedToast: (name) => `已将【${name}】的工作成果同步发布至群公共`,
    recordDecision: "固化为决策",
    decisionRecorded: "已固化为决策",
    decisionHint:
      "将该协作者的交付成果作为决策记录发布到当前项目对话，收到保存回执后确认",
    decisionToast: (name) => `已将【${name}】的成果固化为长项目核心决策`,
    decisionAdopted: (name) => `采纳并列协作者【${name}】交付成果：`,
    decisionGoal: (name) => `确立并列协作者【${name}】推进目标：`,
    sandbox: "推演沙盒",
    sandboxHint:
      "开辟独立推演沙盒，进行多方案 POC 隔离验证，避免污染长项目主干",
    sandboxToast: (name) => `已为【${name}】开辟独立的方案推演沙盒`,
    sandboxPromptIntro: "针对前序长项目任务展开独立概念验证（POC）与方案推演：",
    followUp: "定向追问",
    followUpHint: "在主输入框定向 @该协作者 发起追问",
    followUpUnavailableHint: "此记录没有可续接的会话，请打开工作台查看。",
    followUpToast: (name) => `已将针对【${name}】的对话装填入主输入框`,
    awaitingConfirmation: "等待确认…",
    viewDetails: "查看详情",
    sendUnconfirmed: "未确认发送，请检查输入框草稿后重试。",
    resultUnknown: "结果尚未确认，请先检查对话记录，避免重复提交。",
    openWorkbench: "在大屏工作台查看完整流",
    openWorkbenchHint: "在右侧工作台大屏查看完整的工具调用流与执行画面",
  },
  landmark: {
    decisionTitle: "项目核心决策固化",
    decisionBadge: "已沉淀至事实库",
    decisionTag: "规则已纳管",
    sandboxTitle: "方案推演沙盒",
    sandboxBadge: "POC 隔离验证",
    broadcastTitle: "协作者阶段成果广播",
    broadcastBadge: "已同步至群公共",
    broadcastDelivery: (name) => `来自并列协作者【${name}】的阶段交付：`,
    broadcastProgress: (name) => `并列协作者【${name}】正在推进：`,
    mergeTitle: "沙盒推演结论合入主干",
    mergeBadge: "已合入主项目",
    mergeTag: "进化证据已归档",
    copyDecision: "复制决策内容",
    copySandbox: "复制推演内容",
    copyMerge: "复制推演结论",
    copyBroadcast: "复制成果",
    enterSandbox: "进入推演沙盒",
    enteringSandbox: "正在进入方案推演沙盒分支",
  },
};

const enUS: ProjectCollabCopy = {
  collaboratorFallback: "Parallel collaborator",
  expansion: {
    perspectiveBadge: "My view · Parallel collaborator",
    filesTouched: (count) =>
      count === 1 ? "1 file changed" : `${count} files changed`,
    iterations: (count) =>
      count === 1 ? "1 iteration" : `${count} iterations`,
    taskGoal: "Goal: ",
    errorLabel: "Error: ",
    working:
      "Working in parallel in the background. View the run or send instructions anytime…",
    publish: "Share with group",
    published: "Shared with group",
    publishHint:
      "Post this collaborator's interim results to the group's main conversation",
    publishedToast: (name) => `Shared ${name}'s work with the group`,
    recordDecision: "Record as decision",
    decisionRecorded: "Recorded as decision",
    decisionHint:
      "Post this collaborator's deliverable as a decision record in this conversation and confirm after it is saved",
    decisionToast: (name) =>
      `Recorded ${name}'s results as a core project decision`,
    decisionAdopted: (name) =>
      `Adopted the deliverable from collaborator ${name}:`,
    decisionGoal: (name) => `Set the goal for collaborator ${name}:`,
    sandbox: "Sandbox",
    sandboxHint:
      "Open an isolated sandbox to try alternative POCs without touching the main project",
    sandboxToast: (name) => `Opened a separate sandbox for ${name}`,
    sandboxPromptIntro:
      "Run an independent proof of concept (POC) and explore options for the earlier project task:",
    followUp: "Follow up",
    followUpHint:
      "@mention this collaborator in the main composer to follow up",
    followUpUnavailableHint:
      "No continuable session is available. Open the workbench for details.",
    followUpToast: (name) => `Added @${name} to the main composer`,
    awaitingConfirmation: "Awaiting confirmation…",
    viewDetails: "View details",
    sendUnconfirmed:
      "Sending was not confirmed. Check the composer draft before retrying.",
    resultUnknown:
      "Result is unknown. Check the conversation before submitting again.",
    openWorkbench: "View the full run in the workbench",
    openWorkbenchHint:
      "Open the full tool-call stream and run view in the workbench on the right",
  },
  landmark: {
    decisionTitle: "Core project decision",
    decisionBadge: "Saved to fact base",
    decisionTag: "Rules managed",
    sandboxTitle: "Solution sandbox",
    sandboxBadge: "Isolated POC",
    broadcastTitle: "Collaborator update",
    broadcastBadge: "Shared with group",
    broadcastDelivery: (name) => `Interim delivery from ${name}:`,
    broadcastProgress: (name) => `${name} is working on:`,
    mergeTitle: "Sandbox conclusion merged into the main project",
    mergeBadge: "Merged into main project",
    mergeTag: "Evolution evidence archived",
    copyDecision: "Copy decision",
    copySandbox: "Copy sandbox brief",
    copyMerge: "Copy conclusion",
    copyBroadcast: "Copy results",
    enterSandbox: "Open sandbox",
    enteringSandbox: "Opening the sandbox branch",
  },
};

const jaJP: ProjectCollabCopy = {
  collaboratorFallback: "並列コラボレーター",
  expansion: {
    perspectiveBadge: "自分の視点 · 並列コラボレーター",
    filesTouched: (count) => `${count} 件のファイルを変更`,
    iterations: (count) => `${count} 回の反復`,
    taskGoal: "タスクの目標：",
    errorLabel: "エラー：",
    working:
      "バックグラウンドで並行して作業中です。いつでも実行画面を見たり指示を送ったりできます…",
    publish: "グループに共有",
    published: "グループに共有済み",
    publishHint:
      "このコラボレーターの途中成果をグループのメイン会話に投稿します",
    publishedToast: (name) => `${name} の成果をグループに共有しました`,
    recordDecision: "決定として記録",
    decisionRecorded: "決定として記録済み",
    decisionHint:
      "このコラボレーターの成果物を現在の会話に決定として投稿し、保存後に確認します",
    decisionToast: (name) =>
      `${name} の成果をプロジェクトの主要な決定として記録しました`,
    decisionAdopted: (name) => `並列コラボレーター「${name}」の成果物を採用：`,
    decisionGoal: (name) => `並列コラボレーター「${name}」の目標を確定：`,
    sandbox: "検証サンドボックス",
    sandboxHint:
      "独立したサンドボックスで複数案の POC を検証し、メインのプロジェクトには影響させません",
    sandboxToast: (name) => `${name} 用の独立したサンドボックスを開きました`,
    sandboxPromptIntro:
      "前のプロジェクトタスクについて、独立した概念実証（POC）と方案の検討を行ってください：",
    followUp: "直接質問",
    followUpHint:
      "メイン入力欄でこのコラボレーターを @メンションして質問します",
    followUpUnavailableHint:
      "継続できるセッションがありません。ワークベンチで詳細を確認してください。",
    followUpToast: (name) => `メイン入力欄に @${name} を入れました`,
    awaitingConfirmation: "確認待ち…",
    viewDetails: "詳細を表示",
    sendUnconfirmed:
      "送信を確認できませんでした。入力欄の下書きを確認して再試行してください。",
    resultUnknown:
      "結果を確認できません。重複送信を避けるため、会話履歴を確認してください。",
    openWorkbench: "ワークベンチで全体の流れを表示",
    openWorkbenchHint:
      "右側のワークベンチで、ツール呼び出しの流れと実行画面をすべて表示します",
  },
  landmark: {
    decisionTitle: "プロジェクトの主要な決定",
    decisionBadge: "ファクトベースに保存済み",
    decisionTag: "ルール管理下",
    sandboxTitle: "検証サンドボックス",
    sandboxBadge: "隔離された POC 検証",
    broadcastTitle: "コラボレーターの途中成果",
    broadcastBadge: "グループに共有済み",
    broadcastDelivery: (name) => `並列コラボレーター「${name}」の途中成果：`,
    broadcastProgress: (name) => `並列コラボレーター「${name}」が作業中：`,
    mergeTitle: "サンドボックスの結論をメインに統合",
    mergeBadge: "メインプロジェクトに統合済み",
    mergeTag: "進化の証拠をアーカイブ済み",
    copyDecision: "決定をコピー",
    copySandbox: "検証内容をコピー",
    copyMerge: "結論をコピー",
    copyBroadcast: "成果をコピー",
    enterSandbox: "サンドボックスを開く",
    enteringSandbox: "サンドボックスのブランチを開いています",
  },
};

const koKR: ProjectCollabCopy = {
  collaboratorFallback: "병렬 협업자",
  expansion: {
    perspectiveBadge: "내 시점 · 병렬 협업자",
    filesTouched: (count) => `파일 ${count}개 수정`,
    iterations: (count) => `반복 ${count}회`,
    taskGoal: "작업 목표: ",
    errorLabel: "오류: ",
    working:
      "백그라운드에서 병렬로 진행 중입니다. 언제든 실행 화면을 보거나 지시를 보낼 수 있습니다…",
    publish: "그룹에 공유",
    published: "그룹에 공유됨",
    publishHint: "이 협업자의 중간 결과를 그룹 메인 대화에 게시합니다",
    publishedToast: (name) => `${name}의 작업 결과를 그룹에 공유했습니다`,
    recordDecision: "결정으로 기록",
    decisionRecorded: "결정으로 기록됨",
    decisionHint:
      "이 협업자의 산출물을 현재 대화에 결정으로 게시하고 저장 후 확인합니다",
    decisionToast: (name) =>
      `${name}의 결과를 프로젝트 핵심 결정으로 기록했습니다`,
    decisionAdopted: (name) => `병렬 협업자 「${name}」의 산출물 채택:`,
    decisionGoal: (name) => `병렬 협업자 「${name}」의 목표 확정:`,
    sandbox: "검증 샌드박스",
    sandboxHint:
      "격리된 샌드박스에서 여러 방안의 POC를 검증해 메인 프로젝트에 영향을 주지 않습니다",
    sandboxToast: (name) => `${name} 전용 샌드박스를 열었습니다`,
    sandboxPromptIntro:
      "이전 프로젝트 작업에 대해 독립적인 개념 증명(POC)과 방안 검토를 진행하세요:",
    followUp: "직접 질문",
    followUpHint: "메인 입력창에서 이 협업자를 @멘션해 질문합니다",
    followUpUnavailableHint:
      "이어갈 세션이 없습니다. 워크벤치에서 세부 정보를 확인하세요.",
    followUpToast: (name) => `메인 입력창에 @${name} 멘션을 추가했습니다`,
    awaitingConfirmation: "확인 대기 중…",
    viewDetails: "상세 보기",
    sendUnconfirmed:
      "전송이 확인되지 않았습니다. 입력창 초안을 확인한 후 다시 시도하세요.",
    resultUnknown:
      "결과가 확인되지 않았습니다. 중복 제출을 피하려면 대화 기록을 확인하세요.",
    openWorkbench: "워크벤치에서 전체 흐름 보기",
    openWorkbenchHint:
      "오른쪽 워크벤치에서 전체 도구 호출 흐름과 실행 화면을 봅니다",
  },
  landmark: {
    decisionTitle: "프로젝트 핵심 결정",
    decisionBadge: "사실 저장소에 저장됨",
    decisionTag: "규칙 관리됨",
    sandboxTitle: "검증 샌드박스",
    sandboxBadge: "격리된 POC 검증",
    broadcastTitle: "협업자 단계 결과 공유",
    broadcastBadge: "그룹에 공유됨",
    broadcastDelivery: (name) => `병렬 협업자 「${name}」의 단계 결과:`,
    broadcastProgress: (name) => `병렬 협업자 「${name}」 진행 중:`,
    mergeTitle: "샌드박스 결론을 메인 프로젝트에 병합",
    mergeBadge: "메인 프로젝트에 병합됨",
    mergeTag: "진화 증거 보관됨",
    copyDecision: "결정 복사",
    copySandbox: "검증 내용 복사",
    copyMerge: "결론 복사",
    copyBroadcast: "결과 복사",
    enterSandbox: "샌드박스 열기",
    enteringSandbox: "샌드박스 브랜치를 여는 중",
  },
};

export function projectCollabCopy(locale: string): ProjectCollabCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
