/**
 * Copy for installing execution engines (Codex, OpenCode) from the store:
 * the HUB 应用 「执行引擎」 group and the install row in the composer's
 * engine menu.
 */

export type EngineInstallErrorCode =
  | "download_failed"
  | "disk_full"
  | "busy"
  | "install_failed"
  | "unsupported_platform";

export interface EngineStoreCopy {
  sectionTitle: string;
  sectionHint: string;
  descriptions: Record<"codex" | "opencode", string>;
  install: string;
  update: string;
  uninstall: string;
  manage: (engine: string) => string;
  installEngine: (engine: string) => string;
  size: (megabytes: number) => string;
  ready: (version: string) => string;
  bundled: (version: string) => string;
  configured: string;
  system: string;
  notInstalled: string;
  updateAvailable: (version: string) => string;
  unsupported: string;
  downloading: (percent: number, source: string) => string;
  unpacking: string;
  sources: Record<"mirror" | "upstream", string>;
  errors: Record<EngineInstallErrorCode, string>;
  adminOnly: string;
  /** The engine menu's row for an engine this computer does not have yet. */
  menuInstall: (megabytes: number) => string;
  installed: (engine: string) => string;
  unavailable: string;
}

const zhCN: EngineStoreCopy = {
  sectionTitle: "执行引擎",
  sectionHint:
    "Codex 和 OpenCode 不随安装包附带，用到时在这里下载。先从 ai.echo-age.com 下载，失败时改用官方源；两边都要与官方发布的校验值一致才会安装。",
  descriptions: {
    codex: "OpenAI 的编程智能体，擅长改代码、跑命令",
    opencode: "开源编程智能体，可直接用官方免费模型",
  },
  install: "安装",
  update: "更新",
  uninstall: "卸载",
  manage: (engine) => `管理${engine}`,
  installEngine: (engine) => `安装${engine}`,
  size: (megabytes) => `约 ${megabytes} MB`,
  ready: (version) => `已安装 · ${version}`,
  bundled: (version) => `随应用提供 · ${version}`,
  configured: "使用配置里指定的程序",
  system: "使用这台电脑上已有的程序",
  notInstalled: "未安装",
  updateAvailable: (version) => `需要更新到 ${version}`,
  unsupported: "这台电脑的系统暂不支持",
  downloading: (percent, source) => `正在从${source}下载 ${percent}%`,
  unpacking: "正在安装…",
  sources: { mirror: " Echo 镜像", upstream: "官方源" },
  errors: {
    download_failed:
      "下载失败：Echo 镜像和官方源都没有下载到校验一致的安装包，请检查网络后重试。",
    disk_full: "磁盘空间不足，清理一些空间后再试。",
    busy: "引擎正在运行或正在安装，先结束使用它的任务再试。",
    install_failed: "安装没有完成，请重试。",
    unsupported_platform: "这台电脑的系统暂不支持这个引擎。",
  },
  adminOnly: "由管理员安装",
  menuInstall: (megabytes) => `还没安装 · 点击安装（约 ${megabytes} MB）`,
  installed: (engine) => `${engine} 已安装，可以使用了`,
  unavailable: "暂时读不到引擎状态",
};

const enUS: EngineStoreCopy = {
  sectionTitle: "Execution engines",
  sectionHint:
    "Codex and OpenCode are not part of the installer; download them here when you need them. Downloads come from ai.echo-age.com, or the official source if that fails, and must match the officially published checksum before they are installed.",
  descriptions: {
    codex: "OpenAI's coding agent for editing code and running commands",
    opencode: "Open-source coding agent with official free models",
  },
  install: "Install",
  update: "Update",
  uninstall: "Uninstall",
  manage: (engine) => `Manage ${engine}`,
  installEngine: (engine) => `Install ${engine}`,
  size: (megabytes) => `About ${megabytes} MB`,
  ready: (version) => `Installed · ${version}`,
  bundled: (version) => `Included with the app · ${version}`,
  configured: "Uses the program set in the configuration",
  system: "Uses the program already on this computer",
  notInstalled: "Not installed",
  updateAvailable: (version) => `Needs an update to ${version}`,
  unsupported: "Not available for this computer's system yet",
  downloading: (percent, source) => `Downloading from ${source} · ${percent}%`,
  unpacking: "Installing…",
  sources: { mirror: "the Echo mirror", upstream: "the official source" },
  errors: {
    download_failed:
      "The download failed: neither the Echo mirror nor the official source delivered a package that matches its checksum. Check the network and try again.",
    disk_full: "Not enough disk space. Free some space and try again.",
    busy: "The engine is running or being installed. Finish the tasks that use it and try again.",
    install_failed: "The installation did not finish. Try again.",
    unsupported_platform:
      "This engine is not available for this computer's system yet.",
  },
  adminOnly: "Installed by an admin",
  menuInstall: (megabytes) =>
    `Not installed · click to install (about ${megabytes} MB)`,
  installed: (engine) => `${engine} is installed and ready`,
  unavailable: "Engine status is unavailable right now",
};

const jaJP: EngineStoreCopy = {
  sectionTitle: "実行エンジン",
  sectionHint:
    "Codex と OpenCode はインストーラーに含まれていません。必要なときにここからダウンロードします。ai.echo-age.com から取得し、失敗した場合は公式ソースを使います。公式に公開されたチェックサムと一致した場合のみインストールします。",
  descriptions: {
    codex:
      "コードの編集やコマンド実行が得意な OpenAI のコーディングエージェント",
    opencode:
      "公式の無料モデルを使えるオープンソースのコーディングエージェント",
  },
  install: "インストール",
  update: "更新",
  uninstall: "アンインストール",
  manage: (engine) => `${engine} を管理`,
  installEngine: (engine) => `${engine} をインストール`,
  size: (megabytes) => `約 ${megabytes} MB`,
  ready: (version) => `インストール済み · ${version}`,
  bundled: (version) => `アプリに同梱 · ${version}`,
  configured: "設定で指定したプログラムを使用",
  system: "このコンピューターにあるプログラムを使用",
  notInstalled: "未インストール",
  updateAvailable: (version) => `${version} への更新が必要です`,
  unsupported: "このコンピューターのシステムにはまだ対応していません",
  downloading: (percent, source) => `${source}からダウンロード中 ${percent}%`,
  unpacking: "インストール中…",
  sources: { mirror: " Echo ミラー", upstream: "公式ソース" },
  errors: {
    download_failed:
      "ダウンロードに失敗しました。Echo ミラーと公式ソースのどちらからもチェックサムが一致するパッケージを取得できませんでした。ネットワークを確認して再試行してください。",
    disk_full:
      "ディスクの空き容量が足りません。空きを作ってから再試行してください。",
    busy: "エンジンが実行中またはインストール中です。使用中のタスクを終えてから再試行してください。",
    install_failed: "インストールが完了しませんでした。再試行してください。",
    unsupported_platform:
      "このエンジンはこのコンピューターのシステムにまだ対応していません。",
  },
  adminOnly: "管理者がインストール",
  menuInstall: (megabytes) =>
    `未インストール · クリックしてインストール（約 ${megabytes} MB）`,
  installed: (engine) => `${engine} をインストールしました。使用できます`,
  unavailable: "エンジンの状態を読み込めません",
};

const koKR: EngineStoreCopy = {
  sectionTitle: "실행 엔진",
  sectionHint:
    "Codex와 OpenCode는 설치 파일에 포함되어 있지 않으며 필요할 때 여기서 내려받습니다. ai.echo-age.com에서 먼저 받고, 실패하면 공식 소스를 사용합니다. 공식 체크섬과 일치해야만 설치합니다.",
  descriptions: {
    codex: "코드 수정과 명령 실행에 강한 OpenAI의 코딩 에이전트",
    opencode: "공식 무료 모델을 쓸 수 있는 오픈 소스 코딩 에이전트",
  },
  install: "설치",
  update: "업데이트",
  uninstall: "제거",
  manage: (engine) => `${engine} 관리`,
  installEngine: (engine) => `${engine} 설치`,
  size: (megabytes) => `약 ${megabytes} MB`,
  ready: (version) => `설치됨 · ${version}`,
  bundled: (version) => `앱에 포함 · ${version}`,
  configured: "구성에서 지정한 프로그램 사용",
  system: "이 컴퓨터에 있는 프로그램 사용",
  notInstalled: "설치되지 않음",
  updateAvailable: (version) => `${version}(으)로 업데이트 필요`,
  unsupported: "이 컴퓨터의 시스템은 아직 지원하지 않습니다",
  downloading: (percent, source) => `${source}에서 내려받는 중 ${percent}%`,
  unpacking: "설치하는 중…",
  sources: { mirror: " Echo 미러", upstream: "공식 소스" },
  errors: {
    download_failed:
      "다운로드에 실패했습니다. Echo 미러와 공식 소스 모두에서 체크섬이 일치하는 패키지를 받지 못했습니다. 네트워크를 확인하고 다시 시도하세요.",
    disk_full: "디스크 공간이 부족합니다. 공간을 확보한 뒤 다시 시도하세요.",
    busy: "엔진이 실행 중이거나 설치 중입니다. 사용 중인 작업을 끝낸 뒤 다시 시도하세요.",
    install_failed: "설치를 완료하지 못했습니다. 다시 시도하세요.",
    unsupported_platform:
      "이 엔진은 이 컴퓨터의 시스템을 아직 지원하지 않습니다.",
  },
  adminOnly: "관리자가 설치",
  menuInstall: (megabytes) =>
    `설치되지 않음 · 클릭하여 설치(약 ${megabytes} MB)`,
  installed: (engine) => `${engine}이(가) 설치되어 사용할 수 있습니다`,
  unavailable: "지금은 엔진 상태를 읽을 수 없습니다",
};

export function engineStoreCopy(locale: string): EngineStoreCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
