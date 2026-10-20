interface ConversationFilesCopy {
  imageFailed: string;
  reloadImage: string;
  viewSource: string;
  close: string;
  previous: string;
  next: string;
  imageNumber: (index: number) => string;
  incompleteSearch: string;
  errors: Record<number, string>;
  readFailed: (status: number) => string;
}

const zh: ConversationFilesCopy = {
  imageFailed: "图片读取失败，请重新打开或查看源文件。",
  reloadImage: "重新读取图片",
  viewSource: "查看源文件",
  close: "关闭图片预览",
  previous: "上一张",
  next: "下一张",
  imageNumber: (index) => `第 ${index} 张`,
  incompleteSearch:
    "目录较大或部分目录无法访问，请选择已找到的文件，或使用完整路径。",
  errors: {
    401: "登录已失效，请重新登录后打开文件。",
    403: "此文件不在当前会话授权的工作目录内。",
    404: "未找到文件，可能已移动、删除或引用路径不完整。",
    409: "文件引用不唯一，请选择完整路径。",
    413: "文件超过 24 MB 预览上限，请在本地打开。",
  },
  readFailed: (status) => `文件读取失败（${status}），请重试。`,
};
const en: ConversationFilesCopy = {
  imageFailed: "Unable to load image. Reopen it or view the source file.",
  reloadImage: "Reload image",
  viewSource: "View source file",
  close: "Close image preview",
  previous: "Previous image",
  next: "Next image",
  imageNumber: (index) => `Image ${index}`,
  incompleteSearch:
    "The search could not finish. Choose a found file or use the full path.",
  errors: {
    401: "Sign in again to open this file.",
    403: "This file is outside this conversation’s authorized workspace.",
    404: "File not found. It may have moved, been deleted, or have an incomplete reference.",
    409: "Several files match. Choose the full path.",
    413: "This file exceeds the 24 MB preview limit. Open it locally.",
  },
  readFailed: (status) => `Unable to read file (${status}). Please retry.`,
};
const ja: ConversationFilesCopy = {
  imageFailed:
    "画像を読み込めません。再度開くか元のファイルを確認してください。",
  reloadImage: "画像を再読み込み",
  viewSource: "元のファイルを表示",
  close: "画像プレビューを閉じる",
  previous: "前の画像",
  next: "次の画像",
  imageNumber: (index) => `${index} 枚目`,
  incompleteSearch:
    "検索を完了できませんでした。見つかったファイルを選ぶか、完全なパスを指定してください。",
  errors: {
    401: "ファイルを開くには再度ログインしてください。",
    403: "このファイルは会話で許可された作業フォルダーの外にあります。",
    404: "ファイルが見つかりません。移動・削除されたか、参照パスが不完全です。",
    409: "複数のファイルが一致しました。完全なパスを選択してください。",
    413: "24 MB のプレビュー上限を超えています。ローカルで開いてください。",
  },
  readFailed: (status) =>
    `ファイルを読み込めません（${status}）。再試行してください。`,
};
const ko: ConversationFilesCopy = {
  imageFailed: "이미지를 읽을 수 없습니다. 다시 열거나 원본 파일을 확인하세요.",
  reloadImage: "이미지 다시 읽기",
  viewSource: "원본 파일 보기",
  close: "이미지 미리보기 닫기",
  previous: "이전 이미지",
  next: "다음 이미지",
  imageNumber: (index) => `${index}번째 이미지`,
  incompleteSearch:
    "검색을 완료하지 못했습니다. 찾은 파일을 선택하거나 전체 경로를 사용하세요.",
  errors: {
    401: "파일을 열려면 다시 로그인하세요.",
    403: "이 파일은 대화에서 허용한 작업 폴더 밖에 있습니다.",
    404: "파일을 찾을 수 없습니다. 이동 또는 삭제되었거나 참조 경로가 불완전합니다.",
    409: "여러 파일이 일치합니다. 전체 경로를 선택하세요.",
    413: "24 MB 미리보기 제한을 초과했습니다. 로컬에서 여세요.",
  },
  readFailed: (status) =>
    `파일을 읽을 수 없습니다(${status}). 다시 시도하세요.`,
};
export function conversationFilesCopy(locale: string): ConversationFilesCopy {
  if (locale.startsWith("zh")) return zh;
  if (locale.startsWith("ja")) return ja;
  if (locale.startsWith("ko")) return ko;
  return en;
}

export function fileReadError(status: number, locale: string, reason?: string) {
  const copy = conversationFilesCopy(locale);
  return reason === "file_search_incomplete"
    ? copy.incompleteSearch
    : (copy.errors[status] ?? copy.readFailed(status));
}
