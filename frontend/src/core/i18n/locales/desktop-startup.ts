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
  failedTitle: string;
  failedDetail: string;
  restart: string;
  unavailableTitle: string;
  unavailableDetail: string;
}

const zhCN: DesktopStartupCopy = {
  title: "正在启动 ECHO AI…",
  detail: "本机服务准备中，就绪后会自动连接。",
  slowDetail: "启动比平时稍久，仍在自动连接。",
  retry: "重试连接",
  checking: "正在检查…",
  failedTitle: "ECHO AI 服务未能继续运行",
  failedDetail: "可以重新启动本机服务后继续连接。",
  restart: "重新启动服务",
  unavailableTitle: "暂时无法连接 ECHO AI 服务",
  unavailableDetail: "正在自动重试连接，请检查服务是否可用。",
};

const enUS: DesktopStartupCopy = {
  title: "Starting ECHO AI…",
  detail:
    "Preparing the local service. It will connect automatically when ready.",
  slowDetail: "Startup is taking longer. Still connecting automatically.",
  retry: "Retry connection",
  checking: "Checking…",
  failedTitle: "The ECHO AI service stopped",
  failedDetail: "Restart the local service to reconnect.",
  restart: "Restart service",
  unavailableTitle: "Cannot connect to ECHO AI right now",
  unavailableDetail: "Retrying automatically. Please check the service connection.",
};

const jaJP: DesktopStartupCopy = {
  title: "ECHO AI を起動しています…",
  detail: "ローカルサービスを準備中です。準備が整うと自動的に接続します。",
  slowDetail: "起動に時間がかかっています。自動接続を続けています。",
  retry: "接続を再試行",
  checking: "確認中…",
  failedTitle: "ECHO AI サービスが停止しました",
  failedDetail: "ローカルサービスを再起動して接続できます。",
  restart: "サービスを再起動",
  unavailableTitle: "ECHO AI に接続できません",
  unavailableDetail: "自動的に再接続しています。サービスの接続を確認してください。",
};

const koKR: DesktopStartupCopy = {
  title: "ECHO AI를 시작하는 중…",
  detail: "로컬 서비스를 준비 중입니다. 준비되면 자동으로 연결됩니다.",
  slowDetail: "시작이 지연되고 있습니다. 자동 연결을 계속하고 있습니다.",
  retry: "연결 다시 시도",
  checking: "확인 중…",
  failedTitle: "ECHO AI 서비스가 중지되었습니다",
  failedDetail: "로컬 서비스를 다시 시작하여 연결할 수 있습니다.",
  restart: "서비스 다시 시작",
  unavailableTitle: "ECHO AI에 연결할 수 없습니다",
  unavailableDetail: "자동으로 재연결 중입니다. 서비스 연결을 확인해 주세요.",
};

export function desktopStartupCopy(locale: string): DesktopStartupCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
