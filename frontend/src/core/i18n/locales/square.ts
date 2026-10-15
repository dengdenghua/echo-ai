/**
 * Copy for 广场 (the Square): the shared feed and market the phone shows under
 * 广场 · 灵感 / 市场. Wording follows the phone (echo-mobile values-* strings)
 * so both devices say the same thing. Shared verbatim by ECHO AI and ECHO OS.
 */

export type SquareTopicKey =
  | "recommend"
  | "automation"
  | "efficiency"
  | "life"
  | "learning"
  | "device";

export type SquareMarketKindKey = "skill" | "plugin" | "app";
export type SquareMarketSortKey = "downloads" | "latest" | "trending";

export interface SquareCopy {
  appName: string;
  sections: { inspiration: string; market: string };
  tabs: { recommend: string; hot: string };
  topics: Record<SquareTopicKey, string>;
  heading: (topic: string | null, hot: boolean) => string;
  searchPlaceholder: string;
  searchLabel: string;
  clearSearch: string;
  searchResults: (query: string) => string;
  searchEmpty: (query: string) => string;
  refresh: string;
  loading: string;
  loadMore: string;
  retry: string;
  offlineTitle: string;
  offlineDesc: string;
  staleNotice: string;
  feedEmpty: string;
  untitled: string;
  miniApp: string;
  free: string;
  credits: (count: number) => string;
  likes: (count: number) => string;
  comments: (count: number) => string;
  openAuthor: (name: string) => string;
  drafts: {
    title: (count: number) => string;
    note: string;
    remove: string;
    removeLabel: (title: string) => string;
  };
  detail: {
    title: string;
    close: string;
    image: (index: number, total: number) => string;
    forkedFrom: string;
    stats: {
      likes: string;
      favorites: string;
      comments: string;
      views: string;
    };
    accountNote: string;
    appTitle: string;
    appFree: string;
    appPrice: (credits: number) => string;
    appSubscription: (credits: number) => string;
    appPhoneNote: string;
    commentsTitle: (count: number) => string;
    noComments: string;
    commentsFailed: string;
  };
  profile: {
    back: string;
    works: (count: number) => string;
    following: (count: number) => string;
    followers: (count: number) => string;
    noPosts: string;
    loadFailed: string;
    notFound: string;
  };
  market: {
    kinds: Record<SquareMarketKindKey, string>;
    sorts: Record<SquareMarketSortKey, string>;
    all: string;
    filterPlaceholder: string;
    empty: string;
    loadFailed: string;
    loadFailedDesc: string;
    downloads: (count: number) => string;
    phoneAppsNote: string;
    details: {
      type: string;
      category: string;
      version: string;
      author: string;
      platforms: string;
      downloads: string;
    };
    platformNames: Record<string, string>;
    openInHub: (kind: string) => string;
    phoneInstallNote: string;
  };
}

const zhCN: SquareCopy = {
  appName: "广场",
  sections: { inspiration: "灵感", market: "市场" },
  tabs: { recommend: "推荐", hot: "热门" },
  topics: {
    recommend: "推荐",
    automation: "自动化",
    efficiency: "效率",
    life: "生活",
    learning: "学习",
    device: "设备",
  },
  heading: (topic, hot) =>
    hot
      ? topic
        ? `热门 · ${topic}`
        : "热门内容"
      : topic
        ? `${topic} 灵感`
        : "正在流行",
  searchPlaceholder: "搜索玩法、教程、作品",
  searchLabel: "搜索广场",
  clearSearch: "清空搜索",
  searchResults: (query) => `搜索：${query}`,
  searchEmpty: (query) => `没有找到和「${query}」相关的内容。`,
  refresh: "刷新",
  loading: "加载中…",
  loadMore: "加载更多",
  retry: "重试",
  offlineTitle: "暂时连不上广场",
  offlineDesc: "请检查网络后重试。连上后会显示大家分享的玩法。",
  staleNotice: "暂时连不上广场，下面是上次同步的内容。",
  feedEmpty: "这里还没有内容。",
  untitled: "未命名",
  miniApp: "小程序",
  free: "免费复刻",
  credits: (count) => `${count} 积分`,
  likes: (count) => `${count} 个赞`,
  comments: (count) => `${count} 条评论`,
  openAuthor: (name) => `查看 ${name} 的主页`,
  drafts: {
    title: (count) => `本机草稿 ${count}`,
    note: "这些内容只保存在这台设备上，没有发布到广场。",
    remove: "删除",
    removeLabel: (title) => `删除草稿「${title}」`,
  },
  detail: {
    title: "帖子详情",
    close: "关闭",
    image: (index, total) => `第 ${index} 张，共 ${total} 张`,
    forkedFrom: "复刻自另一篇帖子",
    stats: {
      likes: "点赞",
      favorites: "收藏",
      comments: "评论",
      views: "浏览",
    },
    accountNote: "点赞、收藏、评论和关注需要在手机上登录后使用。",
    appTitle: "手机小程序",
    appFree: "免费复刻",
    appPrice: (credits) => `复刻需要 ${credits} 积分`,
    appSubscription: (credits) => `订阅 ${credits} 积分 / 月`,
    appPhoneNote: "复刻和试运行在手机上的 ECHO 里完成。",
    commentsTitle: (count) => `评论 ${count}`,
    noComments: "还没有评论。",
    commentsFailed: "评论加载失败。",
  },
  profile: {
    back: "返回广场",
    works: (count) => `作品 ${count}`,
    following: (count) => `关注 ${count}`,
    followers: (count) => `粉丝 ${count}`,
    noPosts: "还没有发布作品。",
    loadFailed: "加载用户信息失败",
    notFound: "这个用户不存在或已注销。",
  },
  market: {
    kinds: { skill: "技能", plugin: "插件", app: "应用" },
    sorts: { downloads: "排行", latest: "最新", trending: "趋势" },
    all: "全部",
    filterPlaceholder: "筛选名称或说明",
    empty: "这个分类下还没有内容，晚点再来看看。",
    loadFailed: "列表加载失败",
    loadFailedDesc: "请检查网络连接后重试。",
    downloads: (count) => `${count} 次下载`,
    phoneAppsNote: "这些是手机应用，在手机上的「广场 · 市场」里安装。",
    details: {
      type: "类型",
      category: "分类",
      version: "版本",
      author: "作者",
      platforms: "平台",
      downloads: "下载量",
    },
    platformNames: { mobile: "手机", desktop: "桌面" },
    openInHub: (kind) => `在 HUB 中查看${kind}`,
    phoneInstallNote: "这是手机应用，请在手机上的「广场 · 市场」里安装。",
  },
};

const enUS: SquareCopy = {
  appName: "Square",
  sections: { inspiration: "Inspiration", market: "Market" },
  tabs: { recommend: "Recommend", hot: "Hot" },
  topics: {
    recommend: "Recommend",
    automation: "Automation",
    efficiency: "Efficiency",
    life: "Lifestyle",
    learning: "Learning",
    device: "Device",
  },
  heading: (topic, hot) =>
    hot
      ? topic
        ? `Hot · ${topic}`
        : "Hot posts"
      : topic
        ? `${topic} inspiration`
        : "Trending now",
  searchPlaceholder: "Search ideas, tutorials, works",
  searchLabel: "Search the Square",
  clearSearch: "Clear search",
  searchResults: (query) => `Search: ${query}`,
  searchEmpty: (query) => `Nothing matches “${query}”.`,
  refresh: "Refresh",
  loading: "Loading…",
  loadMore: "Load more",
  retry: "Retry",
  offlineTitle: "Can't reach the Square",
  offlineDesc:
    "Check your network and try again. Ideas people share show up here once you're connected.",
  staleNotice: "Can't reach the Square. Showing what was last synced.",
  feedEmpty: "Nothing here yet.",
  untitled: "Untitled",
  miniApp: "Mini app",
  free: "Free to fork",
  credits: (count) => `${count} credits`,
  likes: (count) => `${count} likes`,
  comments: (count) => `${count} comments`,
  openAuthor: (name) => `Open ${name}'s profile`,
  drafts: {
    title: (count) => `Drafts on this device ${count}`,
    note: "These are saved on this device only. They were never published to the Square.",
    remove: "Delete",
    removeLabel: (title) => `Delete draft “${title}”`,
  },
  detail: {
    title: "Post detail",
    close: "Close",
    image: (index, total) => `Image ${index} of ${total}`,
    forkedFrom: "Forked from another post",
    stats: {
      likes: "Likes",
      favorites: "Saves",
      comments: "Comments",
      views: "Views",
    },
    accountNote:
      "Liking, saving, commenting and following need you to sign in on your phone.",
    appTitle: "Phone mini app",
    appFree: "Free to fork",
    appPrice: (credits) => `Fork for ${credits} credits`,
    appSubscription: (credits) => `Subscribe for ${credits} credits / month`,
    appPhoneNote: "Fork and try it in ECHO on your phone.",
    commentsTitle: (count) => `Comments ${count}`,
    noComments: "No comments yet.",
    commentsFailed: "Couldn't load comments.",
  },
  profile: {
    back: "Back to the Square",
    works: (count) => `Works ${count}`,
    following: (count) => `Following ${count}`,
    followers: (count) => `Followers ${count}`,
    noPosts: "No works published yet.",
    loadFailed: "Couldn't load this profile",
    notFound: "This user doesn't exist or has left.",
  },
  market: {
    kinds: { skill: "Skill", plugin: "Plugin", app: "App" },
    sorts: { downloads: "Ranking", latest: "Latest", trending: "Trending" },
    all: "All",
    filterPlaceholder: "Filter by name or description",
    empty: "Nothing in this category yet, check back later.",
    loadFailed: "Couldn't load this list",
    loadFailedDesc: "Check your network connection and try again.",
    downloads: (count) => `${count} downloads`,
    phoneAppsNote:
      "These are phone apps. Install them from Square · Market on your phone.",
    details: {
      type: "Type",
      category: "Category",
      version: "Version",
      author: "Author",
      platforms: "Platforms",
      downloads: "Downloads",
    },
    platformNames: { mobile: "Phone", desktop: "Desktop" },
    openInHub: (kind) => `Find ${kind.toLowerCase()}s in HUB`,
    phoneInstallNote:
      "This is a phone app. Install it from Square · Market on your phone.",
  },
};

const jaJP: SquareCopy = {
  appName: "広場",
  sections: { inspiration: "インスピレーション", market: "マーケット" },
  tabs: { recommend: "おすすめ", hot: "人気" },
  topics: {
    recommend: "おすすめ",
    automation: "自動化",
    efficiency: "効率",
    life: "ライフスタイル",
    learning: "学習",
    device: "デバイス",
  },
  heading: (topic, hot) =>
    hot
      ? topic
        ? `人気 · ${topic}`
        : "人気の投稿"
      : topic
        ? `${topic} インスピレーション`
        : "流行中",
  searchPlaceholder: "遊び方・チュートリアル・作品を検索",
  searchLabel: "広場を検索",
  clearSearch: "検索をクリア",
  searchResults: (query) => `検索：${query}`,
  searchEmpty: (query) => `「${query}」に一致する内容はありません。`,
  refresh: "更新",
  loading: "読み込み中…",
  loadMore: "さらに読み込む",
  retry: "再試行",
  offlineTitle: "広場に接続できません",
  offlineDesc:
    "ネットワークを確認して、もう一度お試しください。接続すると、みんなが共有したアイデアがここに表示されます。",
  staleNotice: "広場に接続できません。前回同期した内容を表示しています。",
  feedEmpty: "まだ何もありません。",
  untitled: "無題",
  miniApp: "ミニアプリ",
  free: "無料でフォーク",
  credits: (count) => `${count} クレジット`,
  likes: (count) => `いいね ${count}`,
  comments: (count) => `コメント ${count}`,
  openAuthor: (name) => `${name} のページを開く`,
  drafts: {
    title: (count) => `この端末の下書き ${count}`,
    note: "この端末にだけ保存されています。広場には公開されていません。",
    remove: "削除",
    removeLabel: (title) => `下書き「${title}」を削除`,
  },
  detail: {
    title: "投稿の詳細",
    close: "閉じる",
    image: (index, total) => `${total} 枚中 ${index} 枚目`,
    forkedFrom: "別の投稿からフォーク",
    stats: {
      likes: "いいね",
      favorites: "保存",
      comments: "コメント",
      views: "閲覧",
    },
    accountNote:
      "いいね・保存・コメント・フォローはスマートフォンでサインインすると使えます。",
    appTitle: "スマートフォンのミニアプリ",
    appFree: "無料でフォーク",
    appPrice: (credits) => `フォークに ${credits} クレジット`,
    appSubscription: (credits) => `月額 ${credits} クレジットで購読`,
    appPhoneNote: "フォークと試用はスマートフォンの ECHO で行います。",
    commentsTitle: (count) => `コメント ${count}`,
    noComments: "まだコメントがありません。",
    commentsFailed: "コメントを読み込めませんでした。",
  },
  profile: {
    back: "広場に戻る",
    works: (count) => `作品 ${count}`,
    following: (count) => `フォロー中 ${count}`,
    followers: (count) => `フォロワー ${count}`,
    noPosts: "まだ作品がありません。",
    loadFailed: "ユーザー情報を読み込めませんでした",
    notFound: "このユーザーは存在しないか、退会しています。",
  },
  market: {
    kinds: { skill: "スキル", plugin: "プラグイン", app: "アプリ" },
    sorts: { downloads: "ランキング", latest: "最新", trending: "トレンド" },
    all: "すべて",
    filterPlaceholder: "名前や説明で絞り込む",
    empty: "このカテゴリーにはまだ何もありません。",
    loadFailed: "一覧を読み込めませんでした",
    loadFailedDesc: "ネットワーク接続を確認して、もう一度お試しください。",
    downloads: (count) => `${count} ダウンロード`,
    phoneAppsNote:
      "これらはスマートフォン用のアプリです。スマートフォンの「広場 · マーケット」からインストールしてください。",
    details: {
      type: "種類",
      category: "カテゴリー",
      version: "バージョン",
      author: "作成者",
      platforms: "プラットフォーム",
      downloads: "ダウンロード数",
    },
    platformNames: { mobile: "スマートフォン", desktop: "デスクトップ" },
    openInHub: (kind) => `HUB で${kind}を探す`,
    phoneInstallNote:
      "スマートフォン用のアプリです。スマートフォンの「広場 · マーケット」からインストールしてください。",
  },
};

const koKR: SquareCopy = {
  appName: "광장",
  sections: { inspiration: "영감", market: "마켓" },
  tabs: { recommend: "추천", hot: "인기" },
  topics: {
    recommend: "추천",
    automation: "자동화",
    efficiency: "효율",
    life: "라이프스타일",
    learning: "학습",
    device: "기기",
  },
  heading: (topic, hot) =>
    hot
      ? topic
        ? `인기 · ${topic}`
        : "인기 게시물"
      : topic
        ? `${topic} 영감`
        : "현재 트렌드",
  searchPlaceholder: "아이디어, 튜토리얼, 작품 검색",
  searchLabel: "광장 검색",
  clearSearch: "검색 지우기",
  searchResults: (query) => `검색: ${query}`,
  searchEmpty: (query) => `“${query}”와 일치하는 내용이 없습니다.`,
  refresh: "새로고침",
  loading: "로드 중…",
  loadMore: "더 보기",
  retry: "다시 시도",
  offlineTitle: "광장에 연결할 수 없습니다",
  offlineDesc:
    "네트워크를 확인한 뒤 다시 시도하세요. 연결되면 사람들이 공유한 아이디어가 여기에 표시됩니다.",
  staleNotice:
    "광장에 연결할 수 없습니다. 마지막으로 동기화한 내용을 표시합니다.",
  feedEmpty: "아직 내용이 없습니다.",
  untitled: "제목 없음",
  miniApp: "미니 앱",
  free: "무료 포크",
  credits: (count) => `${count} 크레딧`,
  likes: (count) => `좋아요 ${count}`,
  comments: (count) => `댓글 ${count}`,
  openAuthor: (name) => `${name}의 프로필 열기`,
  drafts: {
    title: (count) => `이 기기의 초안 ${count}`,
    note: "이 기기에만 저장되어 있으며 광장에 게시되지 않았습니다.",
    remove: "삭제",
    removeLabel: (title) => `초안 “${title}” 삭제`,
  },
  detail: {
    title: "게시물 상세",
    close: "닫기",
    image: (index, total) => `${total}장 중 ${index}번째`,
    forkedFrom: "다른 게시물에서 포크함",
    stats: {
      likes: "좋아요",
      favorites: "저장",
      comments: "댓글",
      views: "조회",
    },
    accountNote:
      "좋아요, 저장, 댓글, 팔로우는 휴대폰에서 로그인한 뒤 사용할 수 있습니다.",
    appTitle: "휴대폰 미니 앱",
    appFree: "무료 포크",
    appPrice: (credits) => `포크하려면 ${credits} 크레딧`,
    appSubscription: (credits) => `월 ${credits} 크레딧 구독`,
    appPhoneNote: "포크와 체험은 휴대폰의 ECHO에서 진행합니다.",
    commentsTitle: (count) => `댓글 ${count}`,
    noComments: "아직 댓글이 없습니다.",
    commentsFailed: "댓글을 불러오지 못했습니다.",
  },
  profile: {
    back: "광장으로 돌아가기",
    works: (count) => `작품 ${count}`,
    following: (count) => `팔로잉 ${count}`,
    followers: (count) => `팔로워 ${count}`,
    noPosts: "아직 게시한 작품이 없습니다.",
    loadFailed: "사용자 정보를 불러오지 못했습니다",
    notFound: "존재하지 않거나 탈퇴한 사용자입니다.",
  },
  market: {
    kinds: { skill: "스킬", plugin: "플러그인", app: "앱" },
    sorts: { downloads: "순위", latest: "최신", trending: "트렌딩" },
    all: "전체",
    filterPlaceholder: "이름이나 설명으로 필터",
    empty: "이 카테고리에 아직 아무것도 없습니다. 나중에 다시 확인하세요.",
    loadFailed: "목록을 불러오지 못했습니다",
    loadFailedDesc: "네트워크 연결을 확인한 뒤 다시 시도하세요.",
    downloads: (count) => `다운로드 ${count}회`,
    phoneAppsNote: "휴대폰 앱입니다. 휴대폰의 「광장 · 마켓」에서 설치하세요.",
    details: {
      type: "유형",
      category: "카테고리",
      version: "버전",
      author: "작성자",
      platforms: "플랫폼",
      downloads: "다운로드",
    },
    platformNames: { mobile: "휴대폰", desktop: "데스크톱" },
    openInHub: (kind) => `HUB에서 ${kind} 찾기`,
    phoneInstallNote:
      "휴대폰 앱입니다. 휴대폰의 「광장 · 마켓」에서 설치하세요.",
  },
};

export function squareCopy(locale: string): SquareCopy {
  if (locale.startsWith("zh")) return zhCN;
  if (locale.startsWith("ja")) return jaJP;
  if (locale.startsWith("ko")) return koKR;
  return enUS;
}
