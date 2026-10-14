import { normalizeLocale, type Locale } from "../locale";

interface Copy {
  title: string;
  description: string;
  branch: string;
  head: string;
  create: string;
  existing: string;
  current: string;
  open: string;
  checking: string;
  retry: string;
  unavailable: string;
  locked: string;
}

const copies: Record<Locale, Copy> = {
  "en-US": {
    title: "Isolated tasks · Worktrees",
    description:
      "Start a task in a separate directory using committed files from the selected branch. Pending edits stay in the current workspace.",
    branch: "Starting branch",
    head: "Current commit (HEAD)",
    create: "Create and open task",
    existing: "Existing workspaces",
    current: "Current",
    open: "Open new task",
    checking: "Checking Git project…",
    retry: "Refresh workspaces",
    unavailable:
      "Workspaces unavailable. Refresh before attempting another creation.",
    locked: "Locked",
  },
  "zh-CN": {
    title: "隔离任务 · Worktrees",
    description:
      "从所选分支的已提交文件创建独立任务目录。待提交修改保留在当前工作区。",
    branch: "起始分支",
    head: "当前提交（HEAD）",
    create: "创建并打开新任务",
    existing: "已有工作区",
    current: "当前",
    open: "打开新任务",
    checking: "检查 Git 项目…",
    retry: "刷新工作区",
    unavailable: "工作区不可用。再次创建前请刷新列表。",
    locked: "已锁定",
  },
  "ja-JP": {
    title: "独立タスク · Worktrees",
    description:
      "選択したブランチのコミット済みファイルから別の作業ディレクトリを作成します。未コミットの変更は現在の作業領域に残ります。",
    branch: "開始ブランチ",
    head: "現在のコミット（HEAD）",
    create: "作成してタスクを開く",
    existing: "既存の作業領域",
    current: "現在",
    open: "新しいタスクを開く",
    checking: "Git プロジェクトを確認中…",
    retry: "作業領域を更新",
    unavailable:
      "作業領域を取得できません。再作成する前に一覧を更新してください。",
    locked: "ロック中",
  },
  "ko-KR": {
    title: "독립 작업 · Worktrees",
    description:
      "선택한 브랜치의 커밋된 파일로 별도 작업 디렉터리를 만듭니다. 커밋하지 않은 변경 사항은 현재 작업 공간에 유지됩니다.",
    branch: "시작 브랜치",
    head: "현재 커밋 (HEAD)",
    create: "만들고 작업 열기",
    existing: "기존 작업 공간",
    current: "현재",
    open: "새 작업 열기",
    checking: "Git 프로젝트 확인 중…",
    retry: "작업 공간 새로 고침",
    unavailable:
      "작업 공간을 불러올 수 없습니다. 다시 만들기 전에 목록을 새로 고침하세요.",
    locked: "잠김",
  },
};

export function worktreeCopy(locale: string) {
  return copies[normalizeLocale(locale)];
}
