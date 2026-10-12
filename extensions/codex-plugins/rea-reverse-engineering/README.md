# REA 逆向 · Codex 插件

本地运行 REA 6.4.0，并增加 **REA Deep 1.2.0**。保留原生、Electron / JavaScript 等上游能力；Android 分析采用持久目录，完整解包后反复搜索和追踪，不必每次查询都重载 APK。

## 本次增强

| 能力 | 实现 |
| --- | --- |
| 完整解包 | APK / XAPK / APKM 的全部 supplied split；保留每个 APK 和成员哈希 |
| 资源与代码 | Apktool 全量资源、语言限定符与 Smali；JADX 批量 Java 输出，保留失败标记 |
| 持久检索 | ripgrep 搜索 Java / Smali / 资源 / assets / 原生字符串；分页、行号、文件哈希 |
| 调用追踪 | 从 Smali 提取精确方法描述符与 invoke 指令；上下游、多层、批量方法读取 |
| 原生入口 | 原生库、ELF 符号、字符串与字节偏移；需要函数体时继续使用 Ghidra |
| 证据与比较 | 保存查询证据、结论类型、搜索边界与未解问题；版本差异和报告导出 |
| 视觉走查 | ADB 真实截图、UI 节点、屏幕/密度/键盘上下文，或导入 PNG；保存像素标注与截图哈希 |
| UX 走查 | 观察后单步操作、前后截图、期望与实际结果、复现步骤、覆盖缺口 |
| 统一报告 | 视觉/UX 问题优先级和截图标注；可关联解包证据；导出独立 HTML 和 Markdown |
| 长任务 | 后台进度、取消、断点复用；缺失引擎与部分反编译不会伪装成成功 |

工具清单和字符串只是追踪线索。使用指引要求跟进功能入口、状态变化、请求或设备命令及结果，并把服务端边界和未观察的运行时行为说清楚。

## 安装到当前用户的 Codex

需要 Node.js 22.19+、24.11+ 或 26+，以及 Codex CLI。macOS 有 Homebrew 时，在本目录执行：

```sh
node scripts/setup.mjs --engines --install
```

这会安装 Ghidra、Apktool、JADX CLI、ripgrep 及依赖；安装固定版本的 REA；下载并验证 headless JADX 0.7.1；将插件加入个人 marketplace，再通过 Codex 自身的安装命令启用。已有个人 marketplace 条目保留，修改前会留备份。

已经有分析引擎时可省略 `--engines`。仅准备运行依赖时可省略 `--install`。运行数据放在 `~/.local/share/rea-reverse-engineering/`，JADX 放在 `~/.local/share/rea-engines/`；运行过程中不往插件缓存写数据。

安装后新建聊天；如果新工具仍未出现，重启 Codex。

持久 Android 工具目前支持 **macOS / Linux、Python 3.9+**。SDK build-tools 的 `apksigner` 用于签名校验；没有该工具时会明确记录覆盖缺口。JADX CLI 与 headless JADX JAR 是两个不同引擎入口。Windows 仍可使用上游 REA 能力，本扩展的后台进程组和文件锁暂不支持 Windows。

## 使用

在 Codex 中选择 **REA 逆向**，或直接说：

- “用 REA 逆向分析这个 APK 的页面、权限和主要功能：/绝对路径/app.apk。”
- “追踪这个 Electron 应用中的剪贴板实现，并给出代码证据。”
- “分析这个原生程序中的指定函数，解释调用关系。”

也可以从本目录直接运行：

```sh
node scripts/rea.mjs --paths
node scripts/rea.mjs inspect-android-package /absolute/path/app.apk --format json
node scripts/rea.mjs analyze-javascript-application /absolute/path/application --format json
node scripts/rea.mjs doctor --provider ghidra --format json
node scripts/rea.mjs deep prepare '{"path":"/absolute/path/app.xapk","workspace":"/absolute/path/new-workspace"}'
node scripts/rea.mjs deep status '{"workspace":"/absolute/path/new-workspace"}'
node scripts/rea.mjs deep search '{"workspace":"/absolute/path/new-workspace","query":"buildChatSendRequest","scope":"java"}'
node scripts/rea.mjs deep trace '{"workspace":"/absolute/path/new-workspace","symbol":"Lpkg/Handler;->send(Ljava/lang/String;)V","direction":"outgoing","depth":2}'
```

`deep prepare` 返回后台任务，随后用 `deep status` 查看阶段。首次准备完成后，查询复用磁盘索引。相同输入和选项会复用目录；修改了资源/代码可用 `reindex: true`，解决失败阶段的原因后用 `retry_failed: true`。`deep cancel` 只取消该目录所属的分析进程组。不要在插件缓存中创建分析目录。

CLI 的 `deep` 子命令也接受 stdin JSON，避免复杂字符串的命令行转义。可用操作：`prepare`、`status`、`cancel`、`overview`、`search`、`read`、`resources`、`methods`、`trace`、`finding`、`report`、`compare`。MCP `rea-deep` 提供 12 个解包工具与 9 个走查工具，原来的 `rea` 服务保留。

启动器会自动寻找常见的 Homebrew Java 21 / Ghidra、Android Studio Java 和 Android SDK adb。自定义安装路径可通过 `JAVA_HOME`、`GHIDRA_INSTALL_DIR`、`REA_JADX_MCP_JAR`、`REA_APKTOOL_COMMAND`、`REA_ADB_PATH` 覆盖；扩展增加 `REA_JADX_COMMAND`、`REA_PYTHON_COMMAND`、`REA_APKSIGNER_COMMAND`，ripgrep 通过 PATH 发现。

分析目录包含 `inputs/`、`raw/`、`decoded/`、`java/`、`native/`、`index.sqlite`、`summary.json`、`state.json`、`logs/`、`jobs/`、`evidence/` 和 `findings/`。资源通过限定符分页查询，无固定 2000 条截断。查询会检查文件哈希，拒绝使用已经改变的源码生成旧证据；索引重建后旧结论不计入新报告。

`deep_...` 是本扩展自己的证据 ID；不要与上游 REA Evidence ID 混用。完整报告由保存的结论生成，未记录结论时不会自动编造功能解释。

原生分析得到的是反编译伪代码和汇编；APK 类和方法是静态分析结果。网页和运行时分析需要对应的浏览器、设备或进程连接。固件等平台专属功能仍取决于 REA 官方要求；本安装器没有安装 Linux 固件工具或商业 Hopper / IDA。

Smali 调用图只追精确 invoke 操作数，不承诺动态分派、反射、动态 DEX 或 JNI 的完整解析。原生符号和字符串不是原生反编译结果。完整解包也不能还原 APK 之外的云端模型、调度或系统提示词。

分析发生在本机；交给 Codex 理解的工具结果会遵循当前模型服务商的数据政策。

## 视觉和 UX 走查

详见 [走查工作流](skills/reverse-engineer-anything/references/visual-ux-workflow.md)。设备走查需要已连接的 Android 模拟器或真机与显式 serial；导入 PNG 不需要 ADB。插件不会安装或启动目标，也不自动登录。

```sh
node scripts/rea.mjs deep audit-start '{"audit":"/absolute/new-walkthrough","package":"com.example.app","serial":"emulator-5554"}'
node scripts/rea.mjs deep audit-capture '{"audit":"/absolute/new-walkthrough","label":"首页"}'
node scripts/rea.mjs deep audit-report '{"audit":"/absolute/new-walkthrough","title":"界面走查报告"}'
```

其余 CLI 操作：`audit-status`、`audit-read`、`audit-import`、`audit-action`、`audit-coverage`、`audit-finding`。走查目录与解包目录分开保存，可通过 `audit-start` 的 `workspace` 绑定包名相符的既有解包索引。截图、节点文字、操作和报告保存在本地；交给模型的图像与工具结果遵循模型服务商政策。报告包含截图，分享前按实际内容处理。

字体、颜色、间距和视觉层级由 Codex 阅读真实图片判断；几何测量仅提供候选，不自动算问题。节点边界可能小于实际触控区域；无可靠前景或 UI 结构时仍可截图，但单步操作被禁用。反射/JNI 和服务端实现依旧需要进一步分析。当前直接设备采集面向 Android；iOS、桌面、网页可导入 PNG 做视觉记录，实时 UX 操作需使用对应平台工具。

## 来源

- [REA](https://github.com/morluto/rea) 6.4.0，MIT；分析技能基于该版本 npm 包，并加入插件连接与持久 Android 工作流，原始许可见 `licenses/REA-LICENSE`。
- [JADX headless MCP](https://github.com/1013503897/jadx-headless-mcp) 0.7.1，由安装脚本从上游下载，按 REA 发布的 SHA-256 验证，未随插件再分发。
- [Codex 插件格式](https://developers.openai.com/plugins/build/plugins)。

这是基于 REA 的个人插件封装，并非 REA 官方发布的插件。
