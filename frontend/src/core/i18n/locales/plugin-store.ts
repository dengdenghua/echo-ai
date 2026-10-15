/**
 * Copy for ECHO AI's bundled add-on plugins in the HUB 应用 tab: plugins that
 * ship with the app but are installed on demand instead of loading at startup.
 */

export interface PluginStoreEntryCopy {
  name: string;
  description: string;
}

export interface PluginStoreCopy {
  sectionTitle: string;
  sectionHint: string;
  install: string;
  enable: string;
  disable: string;
  uninstall: string;
  manage: (plugin: string) => string;
  installPlugin: (plugin: string) => string;
  notInstalled: string;
  active: (version: string) => string;
  disabled: string;
  failed: string;
  adminOnly: string;
  installed: (plugin: string) => string;
  unavailable: string;
  /** Short store copy per plugin id; the manifest text is the fallback. */
  plugins: Record<string, PluginStoreEntryCopy>;
}

const zhCN: PluginStoreCopy = {
  sectionTitle: "扩展插件",
  sectionHint:
    "随 ECHO AI 提供，但不在启动时加载。用到时在这里安装，装好立即可用，重启后保持启用；卸载会保留你的数据。",
  install: "安装",
  enable: "启用",
  disable: "停用",
  uninstall: "卸载（保留数据）",
  manage: (plugin) => `管理${plugin}`,
  installPlugin: (plugin) => `安装${plugin}`,
  notInstalled: "未安装",
  active: (version) => `已安装 · v${version}`,
  disabled: "已停用",
  failed: "已安装，但没能启动",
  adminOnly: "由管理员安装",
  installed: (plugin) => `${plugin}已安装，现在就能用`,
  unavailable: "暂时读不到插件状态",
  plugins: {
    clip_studio: {
      name: "AI 剪辑工坊",
      description: "多轨视频剪辑、字幕与成片导出，设计画布的剪辑节点用它",
    },
    director_stage: {
      name: "3D 导演台",
      description: "角色、场景、机位与运镜预演，设计画布的 3D 节点用它",
    },
    comfyui_bridge: {
      name: "ComfyUI 工作流桥接",
      description: "让智能体读取、修改并运行本机的 ComfyUI 工作流",
    },
    mx2025_viewer: {
      name: "MX技术小筑",
      description: "MX技术小筑本地连接器：对话分组、消息采集与云端同步",
    },
    whale_eye: {
      name: "鲸鱼之眼",
      description: "把截图和图片转成文字描述，让纯文本模型也能看懂",
    },
    github: {
      name: "GitHub",
      description: "用本机 gh 命令行摘要 PR、分诊 issue、创建 PR",
    },
    project_wiki: {
      name: "项目 Wiki 接口",
      description: "向智能体和外部工具提供项目 Wiki 的生成与存储约定",
    },
    paper_trading_replica: {
      name: "模拟炒股 · 复刻版",
      description: "仍在打磨的复刻版交易页，使用模拟炒股的行情与交易后端",
    },
  },
};

const enUS: PluginStoreCopy = {
  sectionTitle: "Add-on plugins",
  sectionHint:
    "Included with ECHO AI but not loaded at startup. Install one here when you need it: it is ready right away, stays on after restarts, and uninstalling keeps your data.",
  install: "Install",
  enable: "Enable",
  disable: "Disable",
  uninstall: "Uninstall (keep data)",
  manage: (plugin) => `Manage ${plugin}`,
  installPlugin: (plugin) => `Install ${plugin}`,
  notInstalled: "Not installed",
  active: (version) => `Installed · v${version}`,
  disabled: "Disabled",
  failed: "Installed, but it did not start",
  adminOnly: "Installed by an admin",
  installed: (plugin) => `${plugin} is installed and ready`,
  unavailable: "Plugin status is unavailable right now",
  plugins: {
    clip_studio: {
      name: "AI Clip Studio",
      description:
        "Multi-track video editing, captions and video export; the design canvas's clip node uses it",
    },
    director_stage: {
      name: "3D Director Stage",
      description:
        "Characters, scenes, cameras and shot previews; the design canvas's 3D node uses it",
    },
    comfyui_bridge: {
      name: "ComfyUI Bridge",
      description:
        "Lets agents read, edit and run your local ComfyUI workflows",
    },
    mx2025_viewer: {
      name: "MX技术小筑",
      description:
        "Local connector for the MX技术小筑 site: conversation groups, message capture and cloud sync",
    },
    whale_eye: {
      name: "Whale Eye",
      description:
        "Describes screenshots and images in words so text-only models can use them",
    },
    github: {
      name: "GitHub",
      description:
        "Summarize PRs, triage issues and open PRs with the local gh CLI",
    },
    project_wiki: {
      name: "Project Wiki API",
      description:
        "Gives agents and external tools the project Wiki generation and storage contract",
    },
    paper_trading_replica: {
      name: "Paper Trading · Replica",
      description:
        "A replica trading page, still being polished, on the Paper Trading quote and trading backend",
    },
  },
};

const jaJP: PluginStoreCopy = {
  sectionTitle: "拡張プラグイン",
  sectionHint:
    "ECHO AI に含まれていますが、起動時には読み込みません。必要になったらここでインストールすると、すぐに使え、再起動後も有効のままです。アンインストールしてもデータは残ります。",
  install: "インストール",
  enable: "有効にする",
  disable: "無効にする",
  uninstall: "アンインストール（データは保持）",
  manage: (plugin) => `${plugin}を管理`,
  installPlugin: (plugin) => `${plugin}をインストール`,
  notInstalled: "未インストール",
  active: (version) => `インストール済み · v${version}`,
  disabled: "無効",
  failed: "インストール済みですが、起動できませんでした",
  adminOnly: "管理者がインストール",
  installed: (plugin) => `${plugin}をインストールしました。すぐに使えます`,
  unavailable: "現在プラグインの状態を読み取れません",
  plugins: {
    clip_studio: {
      name: "AI クリップスタジオ",
      description:
        "マルチトラック動画編集・字幕・動画書き出し。デザインキャンバスのクリップノードが使います",
    },
    director_stage: {
      name: "3D ディレクターステージ",
      description:
        "キャラクター・シーン・カメラとカメラワークの事前検証。デザインキャンバスの 3D ノードが使います",
    },
    comfyui_bridge: {
      name: "ComfyUI ブリッジ",
      description:
        "エージェントがローカルの ComfyUI ワークフローを読み取り・編集・実行できます",
    },
    mx2025_viewer: {
      name: "MX技术小筑",
      description:
        "MX技术小筑 サイトのローカルコネクタ：会話のグループ化、メッセージ収集、クラウド同期",
    },
    whale_eye: {
      name: "ホエールアイ",
      description:
        "スクリーンショットや画像を文章で説明し、テキスト専用モデルでも扱えるようにします",
    },
    github: {
      name: "GitHub",
      description:
        "ローカルの gh CLI で PR の要約、Issue の振り分け、PR の作成を行います",
    },
    project_wiki: {
      name: "プロジェクト Wiki API",
      description:
        "エージェントや外部ツールにプロジェクト Wiki の生成・保存仕様を提供します",
    },
    paper_trading_replica: {
      name: "模擬株取引・レプリカ版",
      description:
        "調整中のレプリカ取引ページ。模擬株取引の相場・取引バックエンドを使います",
    },
  },
};

const koKR: PluginStoreCopy = {
  sectionTitle: "확장 플러그인",
  sectionHint:
    "ECHO AI에 포함되어 있지만 시작할 때는 불러오지 않습니다. 필요할 때 여기서 설치하면 바로 쓸 수 있고 다시 시작해도 켜져 있습니다. 제거해도 데이터는 남습니다.",
  install: "설치",
  enable: "사용",
  disable: "사용 중지",
  uninstall: "제거(데이터 유지)",
  manage: (plugin) => `${plugin} 관리`,
  installPlugin: (plugin) => `${plugin} 설치`,
  notInstalled: "설치되지 않음",
  active: (version) => `설치됨 · v${version}`,
  disabled: "사용 중지됨",
  failed: "설치했지만 시작하지 못했습니다",
  adminOnly: "관리자가 설치",
  installed: (plugin) => `${plugin}을(를) 설치했습니다. 바로 쓸 수 있습니다`,
  unavailable: "지금은 플러그인 상태를 읽을 수 없습니다",
  plugins: {
    clip_studio: {
      name: "AI 클립 스튜디오",
      description:
        "멀티트랙 영상 편집, 자막, 영상 내보내기. 디자인 캔버스의 클립 노드가 사용합니다",
    },
    director_stage: {
      name: "3D 디렉터 스테이지",
      description:
        "캐릭터, 장면, 카메라와 카메라 워크 미리보기. 디자인 캔버스의 3D 노드가 사용합니다",
    },
    comfyui_bridge: {
      name: "ComfyUI 브리지",
      description:
        "에이전트가 로컬 ComfyUI 워크플로를 읽고 수정하고 실행할 수 있게 합니다",
    },
    mx2025_viewer: {
      name: "MX技术小筑",
      description:
        "MX技术小筑 사이트용 로컬 커넥터: 대화 그룹, 메시지 수집, 클라우드 동기화",
    },
    whale_eye: {
      name: "웨일 아이",
      description:
        "스크린샷과 이미지를 글로 설명해 텍스트 전용 모델도 쓸 수 있게 합니다",
    },
    github: {
      name: "GitHub",
      description: "로컬 gh CLI로 PR 요약, 이슈 분류, PR 생성을 합니다",
    },
    project_wiki: {
      name: "프로젝트 위키 API",
      description:
        "에이전트와 외부 도구에 프로젝트 위키 생성·저장 규약을 제공합니다",
    },
    paper_trading_replica: {
      name: "모의 주식 · 복각판",
      description:
        "다듬는 중인 복각판 거래 화면. 모의 주식의 시세·거래 백엔드를 사용합니다",
    },
  },
};

export function pluginStoreCopy(locale: string): PluginStoreCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
