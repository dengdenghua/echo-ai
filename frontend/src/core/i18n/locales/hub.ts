/**
 * Copy for HUB (components/workspace/agents): the section tabs, 智能体, 应用
 * and its workbench app cards, the plugin directory header, and the restore
 * and uninstall dialogs. Kept as its own typed module, like
 * execution-engine.ts, so every locale has every key.
 */

export type HubSceneId =
  | "white-ghost"
  | "product-lab"
  | "investment-room"
  | "growth-studio"
  | "automation-cell";

export interface HubScene {
  title: string;
  description: string;
}

export interface HubCopy {
  tabs: { agents: string; applications: string; skills: string };
  search: {
    agents: string;
    skills: string;
    applications: string;
    clear: string;
  };
  agents: {
    connectExternal: string;
    smartTeam: string;
    add: string;
    createMember: string;
    externalTitle: string;
    externalDescription: string;
    directory: string;
    scenesLoading: string;
    scenesUnavailable: string;
    all: string;
    count: (count: number) => string;
    /** Featured team scenes, by scenario id. */
    scenes: Record<HubSceneId, HubScene>;
  };
  apps: {
    center: string;
    heading: string;
    statusUnread: (detail: string) => string;
    retry: string;
    noMatch: (query: string) => string;
    clearSearch: string;
    builtIn: string;
    installed: (name: string) => string;
    installedRestored: (name: string) => string;
    updated: (name: string) => string;
    uninstalledKept: (name: string) => string;
    uninstalledTrashed: (name: string) => string;
    rolledBack: (name: string) => string;
    installUndone: (name: string) => string;
    enabled: (name: string) => string;
    disabled: (name: string) => string;
  };
  plugins: {
    featuredHeading: string;
    allHeading: string;
    featuredHint: string;
    allHint: string;
    viewLabel: string;
    featured: string;
    all: string;
    installed: string;
  };
  restore: {
    title: (name: string) => string;
    description: string;
    kept: string;
    safety: string;
    fresh: string;
    confirm: string;
  };
  uninstall: {
    title: (name: string) => string;
    description: string;
    keep: string;
    keepHint: string;
    trash: string;
    trashHint: string;
    cancel: string;
    confirm: string;
  };
  card: {
    broken: string;
    incompatible: string;
    repair: string;
    update: string;
    clickTo: (verb: string) => string;
    adminTo: (verb: string) => string;
    updateAvailable: string;
    disabledClick: string;
    disabledAdmin: string;
    recoverable: string;
    removeFromSidebarOf: (name: string) => string;
    restoreOf: (name: string) => string;
    installOf: (name: string) => string;
    statusUnread: string;
    remove: string;
    installing: string;
    restore: string;
    install: string;
    manageOf: (name: string) => string;
    removeFromSidebar: string;
    pinToSidebar: string;
    disableApp: string;
    enableApp: string;
    installUpdate: string;
    reinstallRepair: string;
    reinstall: string;
    rollback: string;
    undoInstall: string;
    uninstall: string;
    adminOnly: string;
    adminOnlyHint: string;
  };
}

const zhCN: HubCopy = {
  tabs: { agents: "智能体", applications: "应用", skills: "技能" },
  search: {
    agents: "搜索智能体…",
    skills: "搜索技能名称、用途或标签…",
    applications: "搜索应用与插件…",
    clear: "清空搜索",
  },
  agents: {
    connectExternal: "连接外部智能体",
    smartTeam: "智能组队",
    add: "添加",
    createMember: "创建 AI 成员",
    externalTitle: "外部智能体",
    externalDescription:
      "连接运行在其他平台的智能体，让它们参与智能体协作。支持 A2A 协议。",
    directory: "智能体目录",
    scenesLoading: "正在加载精选场景",
    scenesUnavailable: "精选场景暂时不可用",
    all: "全部智能体",
    count: (count) => `${count} 位`,
    scenes: {
      "white-ghost": {
        title: "白幽灵行动组",
        description: "完整主角团协同，适合复杂任务、跨工具执行与现场决策。",
      },
      "product-lab": {
        title: "产品研发冲刺",
        description: "从需求拆解、架构实现到桌面验收，组成一支小型交付团队。",
      },
      "investment-room": {
        title: "投研决策室",
        description: "聚合市场研究、信息验证与商业判断，形成可执行的投资结论。",
      },
      "growth-studio": {
        title: "品牌增长工作室",
        description: "把用户洞察、内容创意与商业转化串成一条完整增长链路。",
      },
      "automation-cell": {
        title: "自动化执行中枢",
        description: "代码、桌面和流程三线并行，适合批量操作与长链路任务。",
      },
    },
  },
  apps: {
    center: "应用中心",
    heading: "应用",
    statusUnread: (detail) => `应用安装状态未读取：${detail}`,
    retry: "重试",
    noMatch: (query) => `没有与“${query}”匹配的应用。`,
    clearSearch: "清除搜索",
    builtIn: "内置",
    installed: (name) => `${name}已安装`,
    installedRestored: (name) => `${name}已安装，作品已恢复`,
    updated: (name) => `${name}已更新`,
    uninstalledKept: (name) => `${name}已卸载，作品已保留`,
    uninstalledTrashed: (name) => `${name}已卸载，作品已移入可恢复回收站`,
    rolledBack: (name) => `${name}已回退到上一个版本`,
    installUndone: (name) => `${name}的最近安装已撤销`,
    enabled: (name) => `${name}已启用`,
    disabled: (name) => `${name}已停用`,
  },
  plugins: {
    featuredHeading: "推荐插件",
    allHeading: "插件",
    featuredHint: "精选内置能力，安装后即可为对话、创作和工程任务补充工具。",
    allHint: "插件、连接器与 MCP；安装状态直接显示在各项中。",
    viewLabel: "插件目录视图",
    featured: "推荐",
    all: "全部",
    installed: "已安装",
  },
  restore: {
    title: (name) => `恢复${name}作品`,
    description:
      "检测到此前卸载时保存的作品。应用代码会重新下载，作品是否恢复由你决定。",
    kept: "可恢复内容已保留",
    safety: "恢复操作不会覆盖现有作品；若目标位置已有新数据，系统会安全中止。",
    fresh: "全新安装",
    confirm: "安装并恢复作品",
  },
  uninstall: {
    title: (name) => `卸载${name}`,
    description:
      "应用代码、MCP 与应用技能会立即撤销。请选择作品数据的处理方式。",
    keep: "保留作品（推荐）",
    keepHint: "以后重新安装即可继续使用现有项目。",
    trash: "移入可恢复回收站",
    trashHint: "不永久删除；重新安装时可以恢复。",
    cancel: "取消",
    confirm: "确认卸载",
  },
  card: {
    broken: "安装损坏",
    incompatible: "版本不兼容",
    repair: "修复",
    update: "更新",
    clickTo: (verb) => `点击${verb}`,
    adminTo: (verb) => `需管理员${verb}`,
    updateAvailable: "有可用更新",
    disabledClick: "已停用 · 点击重新启用",
    disabledAdmin: "已停用 · 需管理员启用",
    recoverable: "有可恢复的作品",
    removeFromSidebarOf: (name) => `从侧栏移除${name}`,
    restoreOf: (name) => `恢复${name}`,
    installOf: (name) => `安装${name}`,
    statusUnread: "状态未读取",
    remove: "移除",
    installing: "安装中",
    restore: "恢复",
    install: "安装",
    manageOf: (name) => `管理${name}`,
    removeFromSidebar: "从侧栏移除",
    pinToSidebar: "固定到侧栏",
    disableApp: "停用应用",
    enableApp: "启用应用",
    installUpdate: "安装可用更新",
    reinstallRepair: "重新安装修复",
    reinstall: "重新安装",
    rollback: "回退上个版本",
    undoInstall: "撤销最近安装",
    uninstall: "卸载",
    adminOnly: "由管理员安装",
    adminOnlyHint: "工作台由本机管理员安装和管理，需要时请联系管理员。",
  },
};

const enUS: HubCopy = {
  tabs: { agents: "Agents", applications: "Apps", skills: "Skills" },
  search: {
    agents: "Search agents…",
    skills: "Search skills by name, purpose or tag…",
    applications: "Search apps and plugins…",
    clear: "Clear search",
  },
  agents: {
    connectExternal: "Connect external agent",
    smartTeam: "Smart team",
    add: "Add",
    createMember: "Create AI member",
    externalTitle: "External agents",
    externalDescription:
      "Connect agents running on other platforms so they can join agent collaboration. Supports the A2A protocol.",
    directory: "Agent directory",
    scenesLoading: "Loading featured scenes",
    scenesUnavailable: "Featured scenes are unavailable right now",
    all: "All agents",
    count: (count) => `${count}`,
    scenes: {
      "white-ghost": {
        title: "White Ghost Task Force",
        description:
          "The full core cast working together, for complex tasks, cross-tool execution and on-the-spot decisions.",
      },
      "product-lab": {
        title: "Product sprint",
        description:
          "From breaking down requirements and building the architecture to desktop acceptance: a small delivery team.",
      },
      "investment-room": {
        title: "Investment research room",
        description:
          "Market research, fact-checking and business judgment combined into investment conclusions you can act on.",
      },
      "growth-studio": {
        title: "Brand growth studio",
        description:
          "User insight, creative content and conversion joined into one complete growth path.",
      },
      "automation-cell": {
        title: "Automation hub",
        description:
          "Code, desktop and workflow lanes in parallel, for batch operations and long task chains.",
      },
    },
  },
  apps: {
    center: "App center",
    heading: "Apps",
    statusUnread: (detail) => `App install status could not be read: ${detail}`,
    retry: "Retry",
    noMatch: (query) => `No apps match “${query}”.`,
    clearSearch: "Clear search",
    builtIn: "Built in",
    installed: (name) => `${name} installed`,
    installedRestored: (name) => `${name} installed and its work restored`,
    updated: (name) => `${name} updated`,
    uninstalledKept: (name) => `${name} uninstalled; its work was kept`,
    uninstalledTrashed: (name) =>
      `${name} uninstalled; its work moved to the recoverable trash`,
    rolledBack: (name) => `${name} rolled back to the previous version`,
    installUndone: (name) => `${name}'s latest install was undone`,
    enabled: (name) => `${name} enabled`,
    disabled: (name) => `${name} disabled`,
  },
  plugins: {
    featuredHeading: "Featured plugins",
    allHeading: "Plugins",
    featuredHint:
      "Hand-picked built-in capabilities that add tools to chats, creative work and engineering tasks.",
    allHint: "Plugins, connectors and MCP; each shows whether it is installed.",
    viewLabel: "Plugin directory view",
    featured: "Featured",
    all: "All",
    installed: "Installed",
  },
  restore: {
    title: (name) => `Restore ${name} work`,
    description:
      "Work saved when this app was uninstalled was found. The app's code is downloaded again; you decide whether to restore the work.",
    kept: "Recoverable work was kept",
    safety:
      "Restoring never overwrites existing work; if the target already has new data, it stops safely.",
    fresh: "Fresh install",
    confirm: "Install and restore work",
  },
  uninstall: {
    title: (name) => `Uninstall ${name}`,
    description:
      "The app's code, MCP and app skills are removed right away. Choose what happens to its work.",
    keep: "Keep work (recommended)",
    keepHint: "Reinstall later to keep using existing projects.",
    trash: "Move to recoverable trash",
    trashHint: "Not deleted permanently; reinstalling can restore it.",
    cancel: "Cancel",
    confirm: "Uninstall",
  },
  card: {
    broken: "Install broken",
    incompatible: "Version incompatible",
    repair: "repair",
    update: "update",
    clickTo: (verb) => `click to ${verb}`,
    adminTo: (verb) => `an admin must ${verb}`,
    updateAvailable: "Update available",
    disabledClick: "Disabled · click to enable again",
    disabledAdmin: "Disabled · an admin must enable it",
    recoverable: "Has recoverable work",
    removeFromSidebarOf: (name) => `Remove ${name} from the sidebar`,
    restoreOf: (name) => `Restore ${name}`,
    installOf: (name) => `Install ${name}`,
    statusUnread: "Status unread",
    remove: "Remove",
    installing: "Installing",
    restore: "Restore",
    install: "Install",
    manageOf: (name) => `Manage ${name}`,
    removeFromSidebar: "Remove from sidebar",
    pinToSidebar: "Pin to sidebar",
    disableApp: "Disable app",
    enableApp: "Enable app",
    installUpdate: "Install update",
    reinstallRepair: "Reinstall to repair",
    reinstall: "Reinstall",
    rollback: "Roll back to previous version",
    undoInstall: "Undo latest install",
    uninstall: "Uninstall",
    adminOnly: "Installed by an admin",
    adminOnlyHint:
      "Workbench apps are installed and managed by this computer's admin. Contact them if you need one.",
  },
};

const jaJP: HubCopy = {
  tabs: { agents: "エージェント", applications: "アプリ", skills: "スキル" },
  search: {
    agents: "エージェントを検索…",
    skills: "スキル名・用途・タグで検索…",
    applications: "アプリとプラグインを検索…",
    clear: "検索をクリア",
  },
  agents: {
    connectExternal: "外部エージェントを接続",
    smartTeam: "スマートチーム",
    add: "追加",
    createMember: "AI メンバーを作成",
    externalTitle: "外部エージェント",
    externalDescription:
      "他のプラットフォームで動くエージェントを接続し、エージェント協働に参加させます。A2A プロトコルに対応しています。",
    directory: "エージェント一覧",
    scenesLoading: "おすすめシーンを読み込み中",
    scenesUnavailable: "おすすめシーンは現在利用できません",
    all: "すべてのエージェント",
    count: (count) => `${count} 人`,
    scenes: {
      "white-ghost": {
        title: "ホワイトゴースト作戦班",
        description:
          "主要メンバー全員で協働。複雑なタスク、ツールをまたぐ実行、その場の判断に向いています。",
      },
      "product-lab": {
        title: "プロダクト開発スプリント",
        description:
          "要件分解からアーキテクチャ実装、デスクトップでの検収まで担う小さなデリバリーチーム。",
      },
      "investment-room": {
        title: "投資リサーチルーム",
        description:
          "市場調査・情報検証・ビジネス判断をまとめ、実行可能な投資結論を導きます。",
      },
      "growth-studio": {
        title: "ブランド成長スタジオ",
        description:
          "ユーザー洞察・コンテンツ制作・コンバージョンを一つの成長ラインにつなげます。",
      },
      "automation-cell": {
        title: "自動化実行ハブ",
        description:
          "コード・デスクトップ・ワークフローを並行して進め、一括操作や長い処理に向いています。",
      },
    },
  },
  apps: {
    center: "アプリセンター",
    heading: "アプリ",
    statusUnread: (detail) =>
      `アプリのインストール状態を読み込めません：${detail}`,
    retry: "再試行",
    noMatch: (query) => `「${query}」に一致するアプリはありません。`,
    clearSearch: "検索をクリア",
    builtIn: "内蔵",
    installed: (name) => `${name} をインストールしました`,
    installedRestored: (name) => `${name} をインストールし、作品を復元しました`,
    updated: (name) => `${name} を更新しました`,
    uninstalledKept: (name) =>
      `${name} をアンインストールしました。作品は保持されています`,
    uninstalledTrashed: (name) =>
      `${name} をアンインストールしました。作品は復元可能なごみ箱に移動しました`,
    rolledBack: (name) => `${name} を前のバージョンに戻しました`,
    installUndone: (name) => `${name} の直近のインストールを取り消しました`,
    enabled: (name) => `${name} を有効にしました`,
    disabled: (name) => `${name} を無効にしました`,
  },
  plugins: {
    featuredHeading: "おすすめプラグイン",
    allHeading: "プラグイン",
    featuredHint:
      "厳選した内蔵機能。インストールすると会話・制作・エンジニアリングにツールが加わります。",
    allHint:
      "プラグイン・コネクタ・MCP。インストール状態は各項目に表示されます。",
    viewLabel: "プラグイン一覧の表示",
    featured: "おすすめ",
    all: "すべて",
    installed: "インストール済み",
  },
  restore: {
    title: (name) => `${name} の作品を復元`,
    description:
      "以前アンインストールしたときに保存した作品が見つかりました。アプリのコードは再ダウンロードされ、作品を復元するかはあなたが決めます。",
    kept: "復元可能な内容は保持されています",
    safety:
      "復元で既存の作品は上書きされません。復元先に新しいデータがある場合は安全に中止します。",
    fresh: "新規インストール",
    confirm: "インストールして作品を復元",
  },
  uninstall: {
    title: (name) => `${name} をアンインストール`,
    description:
      "アプリのコード、MCP、アプリのスキルはすぐに削除されます。作品データの扱いを選んでください。",
    keep: "作品を保持（推奨）",
    keepHint: "後で再インストールすれば既存のプロジェクトを引き続き使えます。",
    trash: "復元可能なごみ箱に移動",
    trashHint: "完全には削除されず、再インストール時に復元できます。",
    cancel: "キャンセル",
    confirm: "アンインストール",
  },
  card: {
    broken: "インストールが破損",
    incompatible: "バージョン非互換",
    repair: "修復",
    update: "更新",
    clickTo: (verb) => `クリックして${verb}`,
    adminTo: (verb) => `管理者による${verb}が必要`,
    updateAvailable: "更新があります",
    disabledClick: "無効 · クリックして再度有効化",
    disabledAdmin: "無効 · 管理者による有効化が必要",
    recoverable: "復元可能な作品があります",
    removeFromSidebarOf: (name) => `${name} をサイドバーから外す`,
    restoreOf: (name) => `${name} を復元`,
    installOf: (name) => `${name} をインストール`,
    statusUnread: "状態を読み込めません",
    remove: "外す",
    installing: "インストール中",
    restore: "復元",
    install: "インストール",
    manageOf: (name) => `${name} を管理`,
    removeFromSidebar: "サイドバーから外す",
    pinToSidebar: "サイドバーに固定",
    disableApp: "アプリを無効化",
    enableApp: "アプリを有効化",
    installUpdate: "更新をインストール",
    reinstallRepair: "再インストールして修復",
    reinstall: "再インストール",
    rollback: "前のバージョンに戻す",
    undoInstall: "直近のインストールを取り消す",
    uninstall: "アンインストール",
    adminOnly: "管理者がインストール",
    adminOnlyHint:
      "ワークベンチはこのコンピューターの管理者がインストール・管理します。必要な場合は管理者に連絡してください。",
  },
};

const koKR: HubCopy = {
  tabs: { agents: "에이전트", applications: "앱", skills: "스킬" },
  search: {
    agents: "에이전트 검색…",
    skills: "스킬 이름, 용도 또는 태그로 검색…",
    applications: "앱과 플러그인 검색…",
    clear: "검색 지우기",
  },
  agents: {
    connectExternal: "외부 에이전트 연결",
    smartTeam: "스마트 팀",
    add: "추가",
    createMember: "AI 구성원 만들기",
    externalTitle: "외부 에이전트",
    externalDescription:
      "다른 플랫폼에서 실행되는 에이전트를 연결해 에이전트 협업에 참여시킵니다. A2A 프로토콜을 지원합니다.",
    directory: "에이전트 목록",
    scenesLoading: "추천 시나리오를 불러오는 중",
    scenesUnavailable: "지금은 추천 시나리오를 사용할 수 없습니다",
    all: "모든 에이전트",
    count: (count) => `${count}명`,
    scenes: {
      "white-ghost": {
        title: "화이트 고스트 작전팀",
        description:
          "주요 멤버 전원이 협업합니다. 복잡한 작업, 도구를 넘나드는 실행, 현장 판단에 적합합니다.",
      },
      "product-lab": {
        title: "제품 개발 스프린트",
        description:
          "요구사항 분해부터 아키텍처 구현, 데스크톱 검수까지 맡는 소규모 딜리버리 팀입니다.",
      },
      "investment-room": {
        title: "투자 리서치 룸",
        description:
          "시장 조사, 정보 검증, 비즈니스 판단을 모아 실행 가능한 투자 결론을 만듭니다.",
      },
      "growth-studio": {
        title: "브랜드 성장 스튜디오",
        description:
          "사용자 인사이트, 콘텐츠 제작, 전환을 하나의 완전한 성장 경로로 잇습니다.",
      },
      "automation-cell": {
        title: "자동화 실행 허브",
        description:
          "코드, 데스크톱, 워크플로를 병렬로 진행해 일괄 작업과 긴 작업 흐름에 적합합니다.",
      },
    },
  },
  apps: {
    center: "앱 센터",
    heading: "앱",
    statusUnread: (detail) => `앱 설치 상태를 읽을 수 없습니다: ${detail}`,
    retry: "다시 시도",
    noMatch: (query) => `“${query}”와(과) 일치하는 앱이 없습니다.`,
    clearSearch: "검색 지우기",
    builtIn: "기본 제공",
    installed: (name) => `${name} 설치됨`,
    installedRestored: (name) => `${name} 설치 및 작업물 복원 완료`,
    updated: (name) => `${name} 업데이트됨`,
    uninstalledKept: (name) => `${name} 제거됨, 작업물은 보존됨`,
    uninstalledTrashed: (name) =>
      `${name} 제거됨, 작업물은 복원 가능한 휴지통으로 이동됨`,
    rolledBack: (name) => `${name}을(를) 이전 버전으로 되돌렸습니다`,
    installUndone: (name) => `${name}의 최근 설치를 취소했습니다`,
    enabled: (name) => `${name} 사용함`,
    disabled: (name) => `${name} 사용 중지됨`,
  },
  plugins: {
    featuredHeading: "추천 플러그인",
    allHeading: "플러그인",
    featuredHint:
      "엄선한 기본 기능입니다. 설치하면 대화, 창작, 엔지니어링 작업에 도구가 추가됩니다.",
    allHint: "플러그인, 커넥터, MCP. 설치 상태가 각 항목에 표시됩니다.",
    viewLabel: "플러그인 목록 보기",
    featured: "추천",
    all: "전체",
    installed: "설치됨",
  },
  restore: {
    title: (name) => `${name} 작업물 복원`,
    description:
      "이전에 제거할 때 저장한 작업물이 있습니다. 앱 코드는 다시 내려받으며, 작업물 복원 여부는 직접 결정합니다.",
    kept: "복원 가능한 내용이 보존되어 있습니다",
    safety:
      "복원은 기존 작업물을 덮어쓰지 않습니다. 대상 위치에 새 데이터가 있으면 안전하게 중단합니다.",
    fresh: "새로 설치",
    confirm: "설치하고 작업물 복원",
  },
  uninstall: {
    title: (name) => `${name} 제거`,
    description:
      "앱 코드, MCP, 앱 스킬은 즉시 제거됩니다. 작업물 데이터 처리 방식을 선택하세요.",
    keep: "작업물 보존(권장)",
    keepHint: "나중에 다시 설치하면 기존 프로젝트를 계속 사용할 수 있습니다.",
    trash: "복원 가능한 휴지통으로 이동",
    trashHint: "영구 삭제하지 않으며, 다시 설치할 때 복원할 수 있습니다.",
    cancel: "취소",
    confirm: "제거",
  },
  card: {
    broken: "설치 손상",
    incompatible: "버전 호환 안 됨",
    repair: "복구",
    update: "업데이트",
    clickTo: (verb) => `클릭하여 ${verb}`,
    adminTo: (verb) => `관리자 ${verb} 필요`,
    updateAvailable: "업데이트 있음",
    disabledClick: "사용 중지됨 · 클릭하여 다시 사용",
    disabledAdmin: "사용 중지됨 · 관리자 사용 설정 필요",
    recoverable: "복원 가능한 작업물 있음",
    removeFromSidebarOf: (name) => `사이드바에서 ${name} 제거`,
    restoreOf: (name) => `${name} 복원`,
    installOf: (name) => `${name} 설치`,
    statusUnread: "상태 읽기 실패",
    remove: "제거",
    installing: "설치 중",
    restore: "복원",
    install: "설치",
    manageOf: (name) => `${name} 관리`,
    removeFromSidebar: "사이드바에서 제거",
    pinToSidebar: "사이드바에 고정",
    disableApp: "앱 사용 중지",
    enableApp: "앱 사용",
    installUpdate: "업데이트 설치",
    reinstallRepair: "다시 설치하여 복구",
    reinstall: "다시 설치",
    rollback: "이전 버전으로 되돌리기",
    undoInstall: "최근 설치 취소",
    uninstall: "제거",
    adminOnly: "관리자가 설치",
    adminOnlyHint:
      "워크벤치는 이 컴퓨터의 관리자가 설치하고 관리합니다. 필요하면 관리자에게 문의하세요.",
  },
};

export function hubCopy(locale: string): HubCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
