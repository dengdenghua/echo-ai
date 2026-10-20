/**
 * Copy for the desktop app's startup gate
 * (components/workspace/backend-bootstrap-overlay.tsx), shown while the
 * local service that ships with the app starts. People see "ECHO AI" and
 * "本机服务", never "后端".
 */

export interface DesktopStartupCopy {
  title: string;
  detail: string;
  slowDetail: string;
  retry: string;
  checking: string;
  workspaceTitle: string;
  workspaceDetail: string;
}

const zhCN: DesktopStartupCopy = {
  title: "正在启动 ECHO AI…",
  detail: "本机服务准备中，就绪后会自动连接。",
  slowDetail: "启动比平时稍久，仍在自动连接。",
  retry: "重试连接",
  checking: "正在检查…",
  workspaceTitle: "正在准备工作区",
  workspaceDetail: "你的会话即将就绪",
};

const enUS: DesktopStartupCopy = {
  title: "Starting ECHO AI…",
  detail:
    "Preparing the local service. It will connect automatically when ready.",
  slowDetail: "Startup is taking longer. Still connecting automatically.",
  retry: "Retry connection",
  checking: "Checking…",
  workspaceTitle: "Preparing your workspace",
  workspaceDetail: "Your conversations will be ready soon",
};

const jaJP: DesktopStartupCopy = {
  title: "ECHO AI を起動しています…",
  detail: "ローカルサービスを準備中です。準備が整うと自動的に接続します。",
  slowDetail: "起動に時間がかかっています。自動接続を続けています。",
  retry: "接続を再試行",
  checking: "確認中…",
  workspaceTitle: "ワークスペースを準備中",
  workspaceDetail: "まもなく会話を利用できます",
};

const koKR: DesktopStartupCopy = {
  title: "ECHO AI를 시작하는 중…",
  detail: "로컬 서비스를 준비 중입니다. 준비되면 자동으로 연결됩니다.",
  slowDetail: "시작이 지연되고 있습니다. 자동 연결을 계속하고 있습니다.",
  retry: "연결 다시 시도",
  checking: "확인 중…",
  workspaceTitle: "작업 공간 준비 중",
  workspaceDetail: "곧 대화를 이용할 수 있습니다",
};

export function desktopStartupCopy(locale: string): DesktopStartupCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
