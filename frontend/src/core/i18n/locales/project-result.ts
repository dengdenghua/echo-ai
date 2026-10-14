/**
 * Copy for the Project OS receipt card that replaces a persisted project run
 * receipt in chat (components/workspace/messages/project-result-content.tsx).
 * The receipt text itself is parsed, not displayed, and stays untranslated.
 */

export interface ProjectResultCopy {
  regionLabel: string;
  status: {
    done: string;
    blocked: string;
    running: string;
    pending: string;
  };
  tasksDone: (done: number, total: number) => string;
  statusUpdated: string;
  hint: {
    done: string;
    blocked: string;
    running: string;
  };
  finalFiles: (count: number) => string;
  viewAllResults: string;
  viewResults: string;
  viewProject: string;
  details: string;
}

const zhCN: ProjectResultCopy = {
  regionLabel: "项目执行结果",
  status: {
    done: "已完成",
    blocked: "需要处理",
    running: "进行中",
    pending: "待启动",
  },
  tasksDone: (done, total) => `${done}/${total} 项任务完成`,
  statusUpdated: "项目状态已更新",
  hint: {
    done: "可查看成果与执行记录",
    blocked: "打开项目查看阻塞原因与恢复操作",
    running: "可在项目中查看当前进展",
  },
  finalFiles: (count) => `当前对话的最终成果 · ${count} 个文件`,
  viewAllResults: "查看全部成果",
  viewResults: "查看成果",
  viewProject: "查看项目",
  details: "执行详情与复盘",
};

const enUS: ProjectResultCopy = {
  regionLabel: "Project run result",
  status: {
    done: "Done",
    blocked: "Needs attention",
    running: "In progress",
    pending: "Not started",
  },
  tasksDone: (done, total) => `${done}/${total} tasks done`,
  statusUpdated: "Project status updated",
  hint: {
    done: "View the results and run history",
    blocked: "Open the project to see what's blocking it and how to recover",
    running: "Track progress in the project",
  },
  finalFiles: (count) =>
    `Final results from this conversation · ${count === 1 ? "1 file" : `${count} files`}`,
  viewAllResults: "View all results",
  viewResults: "View results",
  viewProject: "View project",
  details: "Run details and retrospective",
};

const jaJP: ProjectResultCopy = {
  regionLabel: "プロジェクトの実行結果",
  status: {
    done: "完了",
    blocked: "対応が必要",
    running: "進行中",
    pending: "未開始",
  },
  tasksDone: (done, total) => `${done}/${total} 件のタスクが完了`,
  statusUpdated: "プロジェクトの状態を更新しました",
  hint: {
    done: "成果と実行記録を確認できます",
    blocked: "プロジェクトを開いて、ブロックの原因と復旧手順を確認してください",
    running: "プロジェクトで現在の進捗を確認できます",
  },
  finalFiles: (count) => `この会話の最終成果 · ${count} 件のファイル`,
  viewAllResults: "すべての成果を表示",
  viewResults: "成果を表示",
  viewProject: "プロジェクトを表示",
  details: "実行の詳細と振り返り",
};

const koKR: ProjectResultCopy = {
  regionLabel: "프로젝트 실행 결과",
  status: {
    done: "완료",
    blocked: "조치 필요",
    running: "진행 중",
    pending: "시작 전",
  },
  tasksDone: (done, total) => `작업 ${done}/${total}개 완료`,
  statusUpdated: "프로젝트 상태가 업데이트됨",
  hint: {
    done: "결과와 실행 기록을 볼 수 있습니다",
    blocked: "프로젝트를 열어 차단 원인과 복구 방법을 확인하세요",
    running: "프로젝트에서 현재 진행 상황을 볼 수 있습니다",
  },
  finalFiles: (count) => `이 대화의 최종 결과 · 파일 ${count}개`,
  viewAllResults: "모든 결과 보기",
  viewResults: "결과 보기",
  viewProject: "프로젝트 보기",
  details: "실행 세부 정보 및 회고",
};

export function projectResultCopy(locale: string): ProjectResultCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
