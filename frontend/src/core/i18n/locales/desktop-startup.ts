/**
 * Copy for the desktop app's startup gate
 * (components/workspace/backend-bootstrap-overlay.tsx), shown while the
 * local service that ships with the app starts. People see "ECHO AI" and
 * "本机服务", never "后端".
 */

export interface DesktopStartupCopy {
  title: string;
  detail: string;
}

const zhCN: DesktopStartupCopy = {
  title: "正在启动 ECHO AI…",
  detail: "本机服务正在启动，通常只需几秒，不需要下载任何内容。",
};

const enUS: DesktopStartupCopy = {
  title: "Starting ECHO AI…",
  detail:
    "The local service is starting. This usually takes a few seconds and downloads nothing.",
};

const jaJP: DesktopStartupCopy = {
  title: "ECHO AI を起動しています…",
  detail:
    "ローカルサービスを起動しています。通常は数秒で終わり、ダウンロードは不要です。",
};

const koKR: DesktopStartupCopy = {
  title: "ECHO AI를 시작하는 중…",
  detail:
    "로컬 서비스를 시작하고 있습니다. 보통 몇 초면 끝나며 다운로드는 필요 없습니다.",
};

export function desktopStartupCopy(locale: string): DesktopStartupCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
