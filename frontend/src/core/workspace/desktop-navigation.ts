export const DESKTOP_PIN_KEY = "echo.desktop.pins.v1";
export const DEFAULT_DESKTOP_PINS: string[] = [
  "chat", "projects", "local-knowledge", "library.docs", "assistant", "intelligence",
];

export function parseDesktopPins(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_DESKTOP_PINS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_DESKTOP_PINS];
    return [
      ...new Set(
        parsed.filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length < 160,
        ),
      ),
    ];
  } catch {
    return [...DEFAULT_DESKTOP_PINS];
  }
}

export function toggleDesktopPin(ids: string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((value) => value !== id)
    : [...ids, id];
}

export function desktopCopy(locale: string) {
  const en = {
    apps: "Applications",
    more: "More apps",
    edit: "Edit",
    done: "Done",
    close: "Close",
    search: "Search or jump to…",
    browser: "Browser",
    files: "Files",
    devices: "Devices & remote",
    settings: "Settings",
    add: "Add custom website",
    manage: "Manage apps",
    web: "Websites",
    pin: "Pin",
    unpin: "Unpin",
    pinHint: "Pin your favorite apps. Scroll the navigation bar to see more.",
    navigation: "Projects and chats",
    saved: "Pinned apps are saved on this device.",
  };
  if (locale.startsWith("zh"))
    return {
      apps: "应用导航",
      more: "更多应用",
      edit: "编辑",
      done: "完成",
      close: "关闭",
      search: "搜索或跳转…",
      browser: "浏览器",
      files: "文件",
      devices: "设备与远控",
      settings: "设置",
      add: "自定义添加",
      manage: "管理应用",
      web: "自定义网页",
      pin: "固定",
      unpin: "取消固定",
      pinHint: "固定常用应用；超出高度时可滚动，不限制为 8 个。",
      navigation: "项目与对话",
      saved: "常用应用已保存在当前设备。",
    };
  if (locale.startsWith("ja"))
    return {
      ...en,
      apps: "アプリ",
      more: "その他のアプリ",
      edit: "編集",
      done: "完了",
      close: "閉じる",
      search: "検索・移動…",
      browser: "ブラウザー",
      files: "ファイル",
      devices: "デバイス・リモート",
      settings: "設定",
      add: "ウェブサイトを追加",
      manage: "アプリを管理",
      web: "ウェブサイト",
      pin: "固定",
      unpin: "固定を解除",
      navigation: "プロジェクトとチャット",
    };
  return en;
}
