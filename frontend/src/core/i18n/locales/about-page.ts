// Copy for the /about page sections below the hero (case studies, skills,
// sandbox, what's new, community). Typed: a missing translation is a type
// error. File paths, commands and product names stay as they are.

interface AboutFeature {
  label: string;
  title: string;
  description: string;
}

export interface AboutPageCopy {
  caseStudies: {
    title: string;
    subtitle: string;
    /** Tooltip on a card: it starts a new chat with the case's prompt. */
    tryPrompt: string;
    items: { title: string; prompt: string }[];
  };
  skills: {
    title: string;
    lead: string;
    extend: string;
    clickToPlay: string;
    clickToPause: string;
    playPause: string;
    userRequest: string;
    foundSkills: string;
    researching: string;
    building: string;
    deploying: string;
    loading: (path: string) => string;
    foundTopic: (path: string) => string;
    generating: (file: string) => string;
    executing: (command: string) => string;
    liveAt: (host: string) => string;
    askAnything: string;
  };
  sandbox: {
    title: string;
    subtitle: string;
    eyebrow: string;
    /** Text around the "All-in-One Sandbox" link. */
    recommendBefore: string;
    recommendAfter: string;
    tags: string[];
  };
  whatsNew: {
    title: string;
    subtitle: string;
    features: AboutFeature[];
  };
  community: {
    title: string;
    subtitle: string;
    contribute: string;
  };
}

export const aboutPageEnUS: AboutPageCopy = {
  caseStudies: {
    title: "Case Studies",
    subtitle: "See how Echo is used in the wild",
    tryPrompt: "Start a chat with this prompt",
    items: [
      {
        title: "Forecast 2026 Agent Trends and Opportunities",
        prompt:
          "Create a webpage with a Deep Research report forecasting the agent technology trends and opportunities in 2026.",
      },
      {
        title: 'Generate a Video Based On the Novel "Pride and Prejudice"',
        prompt:
          'Search the specific scene from the novel "Pride and Prejudice", then generate a video as well as a reference image based on the scenes.',
      },
      {
        title: "Doraemon Explains the MoE Architecture",
        prompt:
          "Generate a Doraemon comic strip explaining the MoE architecture to the teenagers who are interested in AI.",
      },
      {
        title: "An Exploratory Data Analysis of the Titanic Dataset",
        prompt:
          "Explore the Titanic dataset and identify the key factors that influenced survival rates with visualizations and insights.",
      },
      {
        title: "Watch Y Combinator's Video then Conduct a Deep Research",
        prompt:
          "Watch the given Y Combinator's YouTube video and conduct a deep research on the YC's tips for technical startup founders.",
      },
      {
        title: "Collect and Summarize Dr. Fei Fei Li's Podcasts",
        prompt:
          "Collect all the podcast appearances of Dr. Fei Fei Li in the last 6 months, then summarize them into a comprehensive report.",
      },
    ],
  },
  skills: {
    title: "Agent Skills",
    lead: "Agent Skills are loaded progressively — only what's needed, when it's needed.",
    extend:
      "Extend EchoOS with your own skill files, or use our built-in library.",
    clickToPlay: "Click to play",
    clickToPause: "Click to pause",
    playPause: "Play / Pause",
    userRequest: "Research mRNA delivery, build a landing page, deploy to Vercel",
    foundSkills: "Found 3 skills",
    researching: "Researching...",
    building: "Building...",
    deploying: "Deploying...",
    loading: (path) => `Loading ${path}...`,
    foundTopic: (path) => `Found biotech related topic, loading ${path}...`,
    generating: (file) => `Generating ${file}...`,
    executing: (command) => `Executing ${command}`,
    liveAt: (host) => `Live at ${host}`,
    askAnything: "Ask Echo anything...",
  },
  sandbox: {
    title: "Agent Runtime Environment",
    subtitle:
      'We give Echo a "computer", which can execute commands, manage files, and run long tasks — all in a secure Docker-based sandbox',
    eyebrow: "Open-source",
    recommendBefore: "We recommend using ",
    recommendAfter:
      " that combines Browser, Shell, File, MCP and VSCode Server in a single Docker container.",
    tags: ["Isolated", "Safe", "Persistent", "Mountable FS", "Long-running"],
  },
  whatsNew: {
    title: "What's New in Echo",
    subtitle:
      "Echo is evolving into a social, full-stack intelligent character platform powered by EchoOS",
    features: [
      {
        label: "Context Engineering",
        title: "Long/Short-term Memory",
        description: "Now the agent can better understand you",
      },
      {
        label: "Long Task Running",
        title: "Planning and Sub-tasking",
        description:
          "Plans ahead, reasons through complexity, then executes sequentially or in parallel",
      },
      {
        label: "Extensible",
        title: "Skills and Tools",
        description:
          "Plug, play, or even swap built-in tools. Build the agent you want.",
      },
      {
        label: "Persistent",
        title: "Sandbox with File System",
        description: "Read, write, run — like a real computer",
      },
      {
        label: "Flexible",
        title: "Multi-Model Support",
        description: "Doubao, DeepSeek, OpenAI, Gemini, etc.",
      },
      {
        label: "Free",
        title: "Open Source",
        description: "Apache-2.0 license, self-hosted, full control",
      },
    ],
  },
  community: {
    title: "Join the Community",
    subtitle:
      "Contribute brilliant ideas to shape the future of Echo. Collaborate, innovate, and make an impact.",
    contribute: "Contribute Now",
  },
};

export const aboutPageZhCN: AboutPageCopy = {
  caseStudies: {
    title: "应用案例",
    subtitle: "看看大家都用 Echo 做些什么",
    tryPrompt: "用这个提示开始新对话",
    items: [
      {
        title: "预测 2026 年智能体趋势与机会",
        prompt: "做一份深度研究报告网页，预测 2026 年智能体技术的趋势与机会。",
      },
      {
        title: "根据小说《傲慢与偏见》生成视频",
        prompt:
          "找出小说《傲慢与偏见》中的特定场景，再根据场景生成一段视频和一张参考图。",
      },
      {
        title: "哆啦 A 梦讲解 MoE 架构",
        prompt: "画一组哆啦 A 梦漫画，给对 AI 感兴趣的青少年讲解 MoE 架构。",
      },
      {
        title: "泰坦尼克号数据集探索性分析",
        prompt:
          "分析泰坦尼克号数据集，找出影响生还率的关键因素，并给出可视化图表和结论。",
      },
      {
        title: "看完 Y Combinator 的视频再做深度研究",
        prompt:
          "看完给定的 Y Combinator YouTube 视频，深入研究 YC 给技术型创业者的建议。",
      },
      {
        title: "收集并总结李飞飞博士的播客",
        prompt: "收集李飞飞博士近 6 个月参加的所有播客，整理成一份完整的总结报告。",
      },
    ],
  },
  skills: {
    title: "智能体技能",
    lead: "技能按需逐步加载——只在需要时载入需要的部分。",
    extend: "可以用自己的技能文件扩展 EchoOS，也可以直接使用内置技能库。",
    clickToPlay: "点击播放",
    clickToPause: "点击暂停",
    playPause: "播放 / 暂停",
    userRequest: "调研 mRNA 递送技术，做一个落地页，并部署到 Vercel",
    foundSkills: "找到 3 个技能",
    researching: "调研中…",
    building: "构建中…",
    deploying: "部署中…",
    loading: (path) => `正在加载 ${path}…`,
    foundTopic: (path) => `发现生物技术相关主题，正在加载 ${path}…`,
    generating: (file) => `正在生成 ${file}…`,
    executing: (command) => `正在执行 ${command}`,
    liveAt: (host) => `已上线：${host}`,
    askAnything: "问 Echo 任何问题…",
  },
  sandbox: {
    title: "智能体运行环境",
    subtitle:
      "我们给了 Echo 一台“电脑”：可以执行命令、管理文件、运行长任务——全部在基于 Docker 的安全沙箱中进行。",
    eyebrow: "开源",
    recommendBefore: "推荐使用 ",
    recommendAfter:
      "，它把浏览器、Shell、文件、MCP 和 VS Code Server 集成在一个 Docker 容器里。",
    tags: ["隔离", "安全", "持久化", "可挂载文件系统", "长时间运行"],
  },
  whatsNew: {
    title: "Echo 新功能",
    subtitle: "Echo 正在成长为一个由 EchoOS 驱动、可社交的全栈智能角色平台",
    features: [
      {
        label: "上下文工程",
        title: "长短期记忆",
        description: "智能体更懂你",
      },
      {
        label: "长任务",
        title: "规划与子任务",
        description: "先规划、再推理复杂问题，然后顺序或并行执行",
      },
      {
        label: "可扩展",
        title: "技能与工具",
        description: "即插即用，内置工具也能替换。打造你想要的智能体。",
      },
      {
        label: "持久化",
        title: "带文件系统的沙箱",
        description: "读、写、运行——就像一台真正的电脑",
      },
      {
        label: "灵活",
        title: "多模型支持",
        description: "豆包、DeepSeek、OpenAI、Gemini 等",
      },
      {
        label: "免费",
        title: "开源",
        description: "Apache-2.0 许可，自主部署，完全可控",
      },
    ],
  },
  community: {
    title: "加入社区",
    subtitle: "贡献你的好点子，一起塑造 Echo 的未来。协作、创新，留下你的影响。",
    contribute: "立即参与贡献",
  },
};

export const aboutPageJaJP: AboutPageCopy = {
  caseStudies: {
    title: "活用事例",
    subtitle: "Echo の実際の使われ方",
    tryPrompt: "このプロンプトで新しいチャットを開始",
    items: [
      {
        title: "2026年のAIエージェントの動向と機会を予測",
        prompt:
          "2026年のAIエージェント技術の動向と機会を予測するディープリサーチレポートをWebページにまとめて。",
      },
      {
        title: "小説『高慢と偏見』をもとに動画を生成",
        prompt:
          "小説『高慢と偏見』の特定の場面を探し、その場面をもとに動画と参考画像を生成して。",
      },
      {
        title: "ドラえもんが MoE アーキテクチャを解説",
        prompt:
          "AIに興味のある10代向けに、MoE アーキテクチャを解説するドラえもんの漫画を作って。",
      },
      {
        title: "タイタニック号データセットの探索的データ分析",
        prompt:
          "タイタニック号のデータセットを分析し、生存率に影響した主な要因を可視化と考察つきで示して。",
      },
      {
        title: "Y Combinator の動画を見てディープリサーチ",
        prompt:
          "指定した Y Combinator の YouTube 動画を見て、技術系スタートアップ創業者への YC のアドバイスをディープリサーチして。",
      },
      {
        title: "フェイフェイ・リー博士のポッドキャストを収集・要約",
        prompt:
          "フェイフェイ・リー博士が直近6か月に出演したポッドキャストをすべて集め、包括的なレポートにまとめて。",
      },
    ],
  },
  skills: {
    title: "エージェントスキル",
    lead: "スキルは段階的に読み込まれます。必要なものを、必要なときだけ。",
    extend:
      "独自のスキルファイルで EchoOS を拡張することも、内蔵ライブラリを使うこともできます。",
    clickToPlay: "クリックして再生",
    clickToPause: "クリックして一時停止",
    playPause: "再生 / 一時停止",
    userRequest:
      "mRNA デリバリーを調査し、ランディングページを作って Vercel にデプロイして",
    foundSkills: "3 つのスキルが見つかりました",
    researching: "調査中…",
    building: "構築中…",
    deploying: "デプロイ中…",
    loading: (path) => `${path} を読み込み中…`,
    foundTopic: (path) =>
      `バイオテック関連のトピックが見つかりました。${path} を読み込み中…`,
    generating: (file) => `${file} を生成中…`,
    executing: (command) => `${command} を実行中`,
    liveAt: (host) => `${host} で公開中`,
    askAnything: "Echo に何でも聞いてください…",
  },
  sandbox: {
    title: "エージェント実行環境",
    subtitle:
      "Echo に「コンピューター」を用意しました。コマンドの実行、ファイル管理、長時間タスクを、Docker ベースの安全なサンドボックス内で行えます。",
    eyebrow: "オープンソース",
    recommendBefore: "",
    recommendAfter:
      " がおすすめです。ブラウザ、シェル、ファイル、MCP、VS Code Server を 1 つの Docker コンテナにまとめています。",
    tags: ["分離", "安全", "永続化", "FS マウント可", "長時間実行"],
  },
  whatsNew: {
    title: "Echo の新機能",
    subtitle:
      "Echo は EchoOS を基盤とした、ソーシャルでフルスタックな AI キャラクタープラットフォームへと進化しています",
    features: [
      {
        label: "コンテキストエンジニアリング",
        title: "長期・短期記憶",
        description: "エージェントがあなたをより深く理解します",
      },
      {
        label: "長時間タスク",
        title: "計画とサブタスク",
        description:
          "先に計画し、複雑な問題を推論してから、順次または並列で実行します",
      },
      {
        label: "拡張可能",
        title: "スキルとツール",
        description:
          "差し込むだけで使え、内蔵ツールの置き換えも可能。理想のエージェントを作れます。",
      },
      {
        label: "永続化",
        title: "ファイルシステム付きサンドボックス",
        description: "読み書きも実行も、本物のコンピューターのように",
      },
      {
        label: "柔軟",
        title: "マルチモデル対応",
        description: "Doubao、DeepSeek、OpenAI、Gemini など",
      },
      {
        label: "無料",
        title: "オープンソース",
        description: "Apache-2.0 ライセンス、セルフホスト、完全なコントロール",
      },
    ],
  },
  community: {
    title: "コミュニティに参加",
    subtitle:
      "アイデアを持ち寄って、Echo の未来を一緒に形づくりましょう。協力し、革新し、インパクトを。",
    contribute: "今すぐ貢献する",
  },
};

export const aboutPageKoKR: AboutPageCopy = {
  caseStudies: {
    title: "활용 사례",
    subtitle: "Echo가 실제로 쓰이는 모습",
    tryPrompt: "이 프롬프트로 새 대화 시작",
    items: [
      {
        title: "2026년 AI 에이전트 트렌드와 기회 전망",
        prompt:
          "2026년 AI 에이전트 기술의 트렌드와 기회를 전망하는 딥 리서치 보고서를 웹페이지로 만들어 줘.",
      },
      {
        title: "소설 『오만과 편견』으로 영상 만들기",
        prompt:
          "소설 『오만과 편견』에서 특정 장면을 찾아, 그 장면을 바탕으로 영상과 참고 이미지를 만들어 줘.",
      },
      {
        title: "도라에몽이 설명하는 MoE 아키텍처",
        prompt:
          "AI에 관심 있는 청소년에게 MoE 아키텍처를 설명하는 도라에몽 만화를 그려 줘.",
      },
      {
        title: "타이타닉 데이터셋 탐색적 분석",
        prompt:
          "타이타닉 데이터셋을 분석해 생존율에 영향을 준 핵심 요인을 시각화와 인사이트로 정리해 줘.",
      },
      {
        title: "Y Combinator 영상을 보고 딥 리서치",
        prompt:
          "주어진 Y Combinator 유튜브 영상을 보고, 기술 스타트업 창업자를 위한 YC의 조언을 딥 리서치해 줘.",
      },
      {
        title: "페이페이 리 박사의 팟캐스트 수집·요약",
        prompt:
          "페이페이 리 박사가 최근 6개월간 출연한 팟캐스트를 모두 모아 종합 보고서로 정리해 줘.",
      },
    ],
  },
  skills: {
    title: "에이전트 스킬",
    lead: "스킬은 필요한 것만, 필요할 때 단계적으로 불러옵니다.",
    extend:
      "직접 만든 스킬 파일로 EchoOS를 확장하거나 기본 제공 라이브러리를 사용할 수 있습니다.",
    clickToPlay: "클릭하여 재생",
    clickToPause: "클릭하여 일시정지",
    playPause: "재생 / 일시정지",
    userRequest:
      "mRNA 전달 기술을 조사하고, 랜딩 페이지를 만들어 Vercel에 배포해 줘",
    foundSkills: "스킬 3개를 찾았습니다",
    researching: "조사 중…",
    building: "빌드 중…",
    deploying: "배포 중…",
    loading: (path) => `${path} 불러오는 중…`,
    foundTopic: (path) =>
      `바이오테크 관련 주제를 찾았습니다. ${path} 불러오는 중…`,
    generating: (file) => `${file} 생성 중…`,
    executing: (command) => `${command} 실행 중`,
    liveAt: (host) => `${host}에 배포 완료`,
    askAnything: "Echo에게 무엇이든 물어보세요…",
  },
  sandbox: {
    title: "에이전트 실행 환경",
    subtitle:
      "Echo에게 '컴퓨터'를 줬습니다. 명령 실행, 파일 관리, 장시간 작업을 모두 Docker 기반의 안전한 샌드박스에서 처리합니다.",
    eyebrow: "오픈 소스",
    recommendBefore: "",
    recommendAfter:
      "를 추천합니다. 브라우저, 셸, 파일, MCP, VS Code Server를 하나의 Docker 컨테이너에 담았습니다.",
    tags: ["격리", "안전", "영구 저장", "파일 시스템 마운트", "장시간 실행"],
  },
  whatsNew: {
    title: "Echo의 새로운 기능",
    subtitle:
      "Echo는 EchoOS 기반의 소셜 풀스택 지능형 캐릭터 플랫폼으로 진화하고 있습니다",
    features: [
      {
        label: "컨텍스트 엔지니어링",
        title: "장단기 기억",
        description: "에이전트가 당신을 더 잘 이해합니다",
      },
      {
        label: "장시간 작업",
        title: "계획과 하위 작업",
        description:
          "먼저 계획하고 복잡한 문제를 추론한 뒤, 순차 또는 병렬로 실행합니다",
      },
      {
        label: "확장 가능",
        title: "스킬과 도구",
        description:
          "꽂아서 바로 쓰고, 내장 도구도 바꿀 수 있습니다. 원하는 에이전트를 만드세요.",
      },
      {
        label: "영구 저장",
        title: "파일 시스템이 있는 샌드박스",
        description: "읽고, 쓰고, 실행하고 — 실제 컴퓨터처럼",
      },
      {
        label: "유연함",
        title: "멀티 모델 지원",
        description: "Doubao, DeepSeek, OpenAI, Gemini 등",
      },
      {
        label: "무료",
        title: "오픈 소스",
        description: "Apache-2.0 라이선스, 셀프 호스팅, 완전한 제어",
      },
    ],
  },
  community: {
    title: "커뮤니티에 참여하세요",
    subtitle:
      "멋진 아이디어로 Echo의 미래를 함께 만들어 가세요. 협업하고, 혁신하고, 변화를 만드세요.",
    contribute: "지금 기여하기",
  },
};
