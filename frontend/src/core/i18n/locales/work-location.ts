// Copy for the composer's work-location menu and its add-connection dialog.
// Typed (not English-keyed): a missing translation is a type error.

export interface WorkLocationCopy {
  local: string;
  remoteControl: string;
  addConnection: string;
  looking: string;
  offline: string;
  notMounted: string;
  unavailableLocation: string;
  openFolder: string;

  dialogTitle: string;
  connectionType: string;
  describeNode: string;
  describeSsh: string;
  describeWsl: string;
  remoteDisabled: string;
  adminOnly: string;
  sshHost: string;
  sshHostHint: string;
  distro: string;
  chooseDistro: string;
  nameOptional: string;
  namePlaceholder: string;
  advanced: string;
  sshPort: string;
  echoPort: string;
  echoPortHintSsh: string;
  echoPortHintWsl: string;
  sshKey: string;
  sshKeyHint: string;
  accessToken: string;
  accessTokenHint: string;
  connected: string;
  connectionFailed: string;
  gotIt: string;
  testConnection: string;
  cancel: string;
  add: string;
  addAnyway: string;
  /** Joins a next-step hint with the raw OpenSSH / probe detail. */
  withDetail: (hint: string, detail: string) => string;
  sshHints: {
    hostKey: string;
    auth: string;
    hostName: string;
    refused: string;
    timeout: string;
    noEcho: string;
    noClient: string;
  };
  echoHints: {
    denied: string;
    unreachable: string;
  };

  guideSteps: [string, string, string];
  guideNote: string;
}

export const workLocationEnUS: WorkLocationCopy = {
  local: "Local",
  remoteControl: "Remote Control",
  addConnection: "Add connection…",
  looking: "Looking…",
  offline: "Offline",
  notMounted: "Workspace is not mounted here",
  unavailableLocation: "This location is no longer available",
  openFolder: "Open folder…",

  dialogTitle: "Add connection",
  connectionType: "Connection type",
  describeNode: "Let another machine running Echo connect here and take tasks.",
  describeSsh: "Run conversations on a remote machine that runs Echo.",
  describeWsl: "Run conversations in Echo inside WSL (Linux).",
  remoteDisabled:
    "SSH / WSL connections are off: enable the experimental ui.remote_transport flag.",
  adminOnly: "Only admins can add SSH / WSL connections.",
  sshHost: "SSH host",
  sshHostHint: "Or a host name from ~/.ssh/config.",
  distro: "Distro",
  chooseDistro: "Choose a distro",
  nameOptional: "Name (optional)",
  namePlaceholder: "Work laptop",
  advanced: "Advanced",
  sshPort: "SSH port",
  echoPort: "Echo port",
  echoPortHintSsh:
    "The Echo port is the remote backend's port; it only needs to listen on 127.0.0.1.",
  echoPortHintWsl:
    "The Echo backend's port inside WSL; avoid this computer's own port.",
  sshKey: "SSH key",
  sshKeyHint:
    "Leave empty to use your SSH config or agent; passwords are not supported.",
  accessToken: "Access token",
  accessTokenHint:
    "Needed when the remote Echo requires sign-in; stored encrypted here.",
  connected: "Connected — the remote Echo answered",
  connectionFailed: "Connection failed",
  gotIt: "Got it",
  testConnection: "Test connection",
  cancel: "Cancel",
  add: "Add",
  addAnyway: "Add anyway",
  withDetail: (hint, detail) => `${hint} (${detail})`,
  sshHints: {
    hostKey:
      "Unknown host key: ssh to this host once in a terminal and accept its fingerprint",
    auth: "SSH authentication failed: check the key or ssh-agent (passwords are not supported)",
    hostName: "Host name not found",
    refused: "Connection refused: no SSH server on that port",
    timeout: "Timed out: check the network or firewall",
    noEcho: "SSH works, but nothing listens on the Echo port",
    noClient: "OpenSSH client is not installed",
  },
  echoHints: {
    denied: "The remote Echo refused access: add an access token",
    unreachable: "Echo is unreachable: make sure it is running on that port",
  },

  guideSteps: [
    "Save this node.json on that machine with this computer's HTTPS address and the shared workspace IDs to offer (non-local addresses require HTTPS).",
    "Set ECHO_EXECUTION_NODE_CONFIG to the node.json path and ECHO_EXECUTION_NODE_TOKEN to an access token of an admin on this computer.",
    "Set execution.member_engine: echo in that machine's config (nodes only run native-engine roles), then start Echo.",
  ],
  guideNote:
    "Once online, the node appears under Work location → Remote control. It works in a snapshot of a shared workspace with file tools only; changes come back with the reply.",
};

export const workLocationZhCN: WorkLocationCopy = {
  local: "本地",
  remoteControl: "远程控制",
  addConnection: "添加连接…",
  looking: "正在查找…",
  offline: "离线",
  notMounted: "共享空间未挂载到本机",
  unavailableLocation: "这个位置已不可用，请换一个",
  openFolder: "打开文件夹…",

  dialogTitle: "添加连接",
  connectionType: "连接方式",
  describeNode: "让另一台运行 Echo 的机器连过来，把任务派给它。",
  describeSsh: "在一台运行 Echo 的远程机器上执行对话。",
  describeWsl: "在 WSL 里运行的 Echo 中执行对话（Linux 环境）。",
  remoteDisabled:
    "SSH / WSL 连接尚未开启：需要开启实验功能 ui.remote_transport。",
  adminOnly: "只有管理员可以添加 SSH / WSL 连接。",
  sshHost: "SSH 主机",
  sshHostHint: "也可以填 ~/.ssh/config 里的主机名。",
  distro: "发行版",
  chooseDistro: "选择发行版",
  nameOptional: "名称（可选）",
  namePlaceholder: "工作笔记本",
  advanced: "高级选项",
  sshPort: "SSH 端口",
  echoPort: "Echo 端口",
  echoPortHintSsh:
    "Echo 端口是远端 Echo 后端的端口，它只需监听 127.0.0.1，流量走 SSH 隧道。",
  echoPortHintWsl: "WSL 里 Echo 后端的端口，别和这台电脑上的 Echo 冲突。",
  sshKey: "SSH 密钥",
  sshKeyHint: "留空则用 SSH 配置或 ssh-agent；不支持密码登录。",
  accessToken: "访问令牌",
  accessTokenHint: "远端 Echo 开启登录时需要，加密保存在本机。",
  connected: "连接正常，远端 Echo 已响应",
  connectionFailed: "连接失败",
  gotIt: "知道了",
  testConnection: "测试连接",
  cancel: "取消",
  add: "添加",
  addAnyway: "仍要添加",
  withDetail: (hint, detail) => `${hint}（${detail}）`,
  sshHints: {
    hostKey: "主机密钥未确认：先在终端里 ssh 连一次这台主机并接受指纹",
    auth: "SSH 认证失败：检查密钥路径或 ssh-agent（不支持密码登录）",
    hostName: "找不到这个主机名",
    refused: "连接被拒绝：那台机器没有运行 SSH 服务，或端口不对",
    timeout: "连接超时：检查网络或防火墙",
    noEcho: "SSH 已连上，但远端端口上没有 Echo",
    noClient: "这台电脑没有 OpenSSH 客户端",
  },
  echoHints: {
    denied: "远端 Echo 拒绝了访问：请填写访问令牌",
    unreachable: "连不上 Echo：确认它已经启动，端口填对了",
  },

  guideSteps: [
    "在那台机器上保存下面的 node.json，填好这台电脑的 HTTPS 地址和要开放的共享空间 ID（非本机地址必须用 HTTPS）。",
    "设置环境变量 ECHO_EXECUTION_NODE_CONFIG 指向 node.json，ECHO_EXECUTION_NODE_TOKEN 填这台电脑上管理员账号的访问令牌。",
    "在那台机器的配置里设 execution.member_engine: echo（执行节点只运行原生引擎角色），然后启动 Echo。",
  ],
  guideNote:
    "节点上线后会出现在「工作位置 → 远程控制」里。它在共享空间的快照里工作，只能读写文件、不能运行命令；改动随回复交回。",
};

export const workLocationJaJP: WorkLocationCopy = {
  local: "ローカル",
  remoteControl: "リモート操作",
  addConnection: "接続を追加…",
  looking: "検索中…",
  offline: "オフライン",
  notMounted: "共有スペースがこのPCにマウントされていません",
  unavailableLocation:
    "この場所は利用できなくなりました。別の場所を選んでください",
  openFolder: "フォルダーを開く…",

  dialogTitle: "接続を追加",
  connectionType: "接続方法",
  describeNode:
    "Echo を実行している別のマシンをここに接続し、タスクを任せます。",
  describeSsh: "Echo を実行しているリモートマシンで会話を実行します。",
  describeWsl: "WSL 内の Echo で会話を実行します（Linux 環境）。",
  remoteDisabled:
    "SSH / WSL 接続は無効です：実験的機能 ui.remote_transport を有効にしてください。",
  adminOnly: "SSH / WSL 接続を追加できるのは管理者だけです。",
  sshHost: "SSH ホスト",
  sshHostHint: "~/.ssh/config のホスト名も使えます。",
  distro: "ディストリビューション",
  chooseDistro: "ディストリビューションを選択",
  nameOptional: "名前（任意）",
  namePlaceholder: "仕事用ノートPC",
  advanced: "詳細設定",
  sshPort: "SSH ポート",
  echoPort: "Echo ポート",
  echoPortHintSsh:
    "Echo ポートはリモートの Echo バックエンドのポートです。127.0.0.1 で待ち受けるだけでよく、通信は SSH トンネルを通ります。",
  echoPortHintWsl:
    "WSL 内の Echo バックエンドのポートです。このPCの Echo と重ならないようにしてください。",
  sshKey: "SSH 鍵",
  sshKeyHint:
    "空欄の場合は SSH 設定または ssh-agent を使います。パスワード認証には対応していません。",
  accessToken: "アクセストークン",
  accessTokenHint:
    "リモートの Echo がサインインを要求する場合に必要です。このPCに暗号化して保存されます。",
  connected: "接続できました。リモートの Echo が応答しました",
  connectionFailed: "接続に失敗しました",
  gotIt: "了解",
  testConnection: "接続テスト",
  cancel: "キャンセル",
  add: "追加",
  addAnyway: "このまま追加",
  withDetail: (hint, detail) => `${hint}（${detail}）`,
  sshHints: {
    hostKey:
      "ホスト鍵が未確認です：一度ターミナルからこのホストに ssh 接続し、フィンガープリントを承認してください",
    auth: "SSH 認証に失敗しました：鍵のパスか ssh-agent を確認してください（パスワード認証は非対応）",
    hostName: "ホスト名が見つかりません",
    refused:
      "接続が拒否されました：そのマシンで SSH サービスが動いていないか、ポートが違います",
    timeout:
      "タイムアウトしました：ネットワークかファイアウォールを確認してください",
    noEcho:
      "SSH には接続できましたが、リモートのポートで Echo が動いていません",
    noClient: "このPCに OpenSSH クライアントがありません",
  },
  echoHints: {
    denied:
      "リモートの Echo がアクセスを拒否しました：アクセストークンを入力してください",
    unreachable:
      "Echo に接続できません：起動しているか、ポートが正しいか確認してください",
  },

  guideSteps: [
    "そのマシンに下の node.json を保存し、このPCの HTTPS アドレスと公開する共有スペースの ID を記入します（このPC以外のアドレスは HTTPS 必須）。",
    "環境変数 ECHO_EXECUTION_NODE_CONFIG に node.json のパスを、ECHO_EXECUTION_NODE_TOKEN にこのPCの管理者アカウントのアクセストークンを設定します。",
    "そのマシンの設定で execution.member_engine: echo を指定し（実行ノードはネイティブエンジンのロールだけを実行します）、Echo を起動します。",
  ],
  guideNote:
    "ノードがオンラインになると「作業場所 → リモート操作」に表示されます。共有スペースのスナップショット上で動作し、ファイルの読み書きのみ可能でコマンドは実行できません。変更は返信と一緒に戻ります。",
};

export const workLocationKoKR: WorkLocationCopy = {
  local: "로컬",
  remoteControl: "원격 제어",
  addConnection: "연결 추가…",
  looking: "찾는 중…",
  offline: "오프라인",
  notMounted: "공유 공간이 이 컴퓨터에 마운트되지 않았습니다",
  unavailableLocation:
    "이 위치는 더 이상 사용할 수 없습니다. 다른 위치를 선택하세요",
  openFolder: "폴더 열기…",

  dialogTitle: "연결 추가",
  connectionType: "연결 방식",
  describeNode: "Echo를 실행 중인 다른 컴퓨터를 여기에 연결해 작업을 맡깁니다.",
  describeSsh: "Echo를 실행 중인 원격 컴퓨터에서 대화를 실행합니다.",
  describeWsl: "WSL 안의 Echo에서 대화를 실행합니다(Linux 환경).",
  remoteDisabled:
    "SSH / WSL 연결이 꺼져 있습니다: 실험 기능 ui.remote_transport를 켜세요.",
  adminOnly: "SSH / WSL 연결은 관리자만 추가할 수 있습니다.",
  sshHost: "SSH 호스트",
  sshHostHint: "~/.ssh/config의 호스트 이름도 쓸 수 있습니다.",
  distro: "배포판",
  chooseDistro: "배포판 선택",
  nameOptional: "이름(선택)",
  namePlaceholder: "업무용 노트북",
  advanced: "고급 옵션",
  sshPort: "SSH 포트",
  echoPort: "Echo 포트",
  echoPortHintSsh:
    "Echo 포트는 원격 Echo 백엔드의 포트입니다. 127.0.0.1에서만 수신하면 되며 트래픽은 SSH 터널을 거칩니다.",
  echoPortHintWsl:
    "WSL 안 Echo 백엔드의 포트입니다. 이 컴퓨터의 Echo와 겹치지 않게 하세요.",
  sshKey: "SSH 키",
  sshKeyHint:
    "비워 두면 SSH 설정이나 ssh-agent를 씁니다. 비밀번호 로그인은 지원하지 않습니다.",
  accessToken: "액세스 토큰",
  accessTokenHint:
    "원격 Echo가 로그인을 요구할 때 필요합니다. 이 컴퓨터에 암호화되어 저장됩니다.",
  connected: "연결되었습니다. 원격 Echo가 응답했습니다",
  connectionFailed: "연결에 실패했습니다",
  gotIt: "확인",
  testConnection: "연결 테스트",
  cancel: "취소",
  add: "추가",
  addAnyway: "그래도 추가",
  withDetail: (hint, detail) => `${hint} (${detail})`,
  sshHints: {
    hostKey:
      "호스트 키가 확인되지 않았습니다: 터미널에서 이 호스트에 한 번 ssh 접속해 지문을 승인하세요",
    auth: "SSH 인증에 실패했습니다: 키 경로나 ssh-agent를 확인하세요(비밀번호 로그인은 지원하지 않음)",
    hostName: "호스트 이름을 찾을 수 없습니다",
    refused:
      "연결이 거부되었습니다: 그 컴퓨터에서 SSH 서비스가 실행 중이 아니거나 포트가 다릅니다",
    timeout: "시간이 초과되었습니다: 네트워크나 방화벽을 확인하세요",
    noEcho: "SSH는 연결되었지만 원격 포트에서 Echo가 실행 중이 아닙니다",
    noClient: "이 컴퓨터에 OpenSSH 클라이언트가 없습니다",
  },
  echoHints: {
    denied: "원격 Echo가 접근을 거부했습니다: 액세스 토큰을 입력하세요",
    unreachable:
      "Echo에 연결할 수 없습니다: 실행 중인지, 포트가 맞는지 확인하세요",
  },

  guideSteps: [
    "그 컴퓨터에 아래 node.json을 저장하고 이 컴퓨터의 HTTPS 주소와 공개할 공유 공간 ID를 입력합니다(이 컴퓨터가 아닌 주소는 HTTPS 필수).",
    "환경 변수 ECHO_EXECUTION_NODE_CONFIG에 node.json 경로를, ECHO_EXECUTION_NODE_TOKEN에 이 컴퓨터 관리자 계정의 액세스 토큰을 설정합니다.",
    "그 컴퓨터 설정에서 execution.member_engine: echo를 지정하고(실행 노드는 네이티브 엔진 역할만 실행) Echo를 시작합니다.",
  ],
  guideNote:
    "노드가 온라인이 되면 「작업 위치 → 원격 제어」에 표시됩니다. 공유 공간의 스냅샷에서 동작하며 파일 읽기·쓰기만 할 수 있고 명령은 실행할 수 없습니다. 변경 사항은 답변과 함께 돌아옵니다.",
};
