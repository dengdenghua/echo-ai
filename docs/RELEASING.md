# 发布 ECHO AI

两种标签，各自只触发一个工作流（`tests/test_preview_release_workflow.py` 校验互不误触发）：

| 标签 | 工作流 | 产出 | 前置条件 |
|---|---|---|---|
| `vX.Y.Z-preview.N` | `preview-release.yml` | GitHub **Pre-release**（不标为 latest）：未签名的 Windows 安装包、Linux AppImage、wheel、sdist、`SHA256SUMS` | 同一提交上 `ci.yml` 与 `runtime-security-contract.yml` 成功；不需要任何 secret |
| `vX.Y.Z` | `release.yml` | 草稿 Release（已签名 Windows 安装包）、PyPI、GHCR 镜像 | 见下文，含已签名 build-win 和行为证据 |

`release.yml` 由 `v<版本>` 标签触发（例如 `v0.2.0`），只发布**同一提交**上已经全部通过的证据。
本页列出它依赖什么、需要哪些密钥，以及发版顺序；预览版见“发布预览版”。

## 版本号

一次发布只有一个版本号，以 `pyproject.toml` 的 `project.version` 为准。下列位置必须一致
（`tests/test_version_sync.py` 校验）：

- `pyproject.toml`、`uv.lock`（`uv lock` 自动跟随）、`runtime/__init__.py` 的 `__version__`
- `frontend/package.json`（`release.yml` 校验它与 pyproject 相同）、`extras/desktop/package.json`、根目录 `package.json`
- `CHANGELOG.md` 里的 `## [<版本>]` 小节，GitHub Release 的说明从这里截取

标签必须是 `v` 加上这个版本号，否则 `release.yml` 第一步就失败。

## 发布前必须在同一提交上成功的工作流

| 工作流 | 触发方式 | 产出 / 证明 |
|---|---|---|
| `ci.yml` | push 到 `main` | 全部门禁；上传 `full-stack-smoke-proof-<sha>` |
| `runtime-security-contract.yml` | push | Linux + Windows 运行时安全合同 |
| `build-win.yml` | push 到 `main` 或手动 | **已签名**的 `Echo-Setup-Windows-<sha>` 与 `Echo-Portable-Windows-<sha>`；没有证书时只产出 `-UNSIGNED` 预览，不能发布 |
| `behavioral-evidence.yml` | 手动 | `behavioral-surpass-evidence-<sha>`；需要自托管 macOS runner（标签 `self-hosted, macOS, behavioral-evidence`） |

`build-linux.yml` 产出 AppImage，但 `release.yml` 目前不上传 Linux 包（预览版会附上）。

## 密钥与变量

| 名称 | 类型 / 位置 | 用途 |
|---|---|---|
| `WINDOWS_CODE_SIGNING_CERTIFICATE_BASE64` | secret，环境 `windows-code-signing` | 带 Code Signing EKU 的 PKCS#12（.pfx）的 base64 |
| `WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD` | secret，环境 `windows-code-signing` | 上述 .pfx 的密码 |
| `ECHO_PLUGIN_SIGNING_PUBLIC_KEY` | variable（仓库） | Ed25519 公钥（32 字节原始值的 base64），打进 wheel / 镜像 / 安装包 |
| `ECHO_PLUGIN_SIGNING_KEY_ID` | variable（仓库） | 公钥的 key id |
| `ECHO_PLUGIN_SIGNING_PUBLISHER_ID` | variable（仓库） | 发布者 id（脚本默认 `echoai`） |
| `ECHO_PLUGIN_SIGNING_PRIVATE_KEY` | secret，环境 `plugin-content-signing` | 对应私钥，只给 `publish-plugin-content.yml` |
| `MARKETPLACE_RELEASE_TOKEN` | secret，环境 `plugin-content-signing` | 能在 `dengdenghua/workbuddy-expert-market` 创建 release 的 token |
| `ECHO_API_TOKEN`、`ECHO_EVAL_LOCAL_PASSWORD` 与 `ECHO_BEHAVIORAL_*` 变量 | 环境 `behavioral-evidence` | 行为证据评测 |
| PyPI Trusted Publisher | pypi.org 项目设置 | 项目 `echo-ai-runtime`，仓库 `dengdenghua/echo-ai`，工作流 `release.yml`，环境 `pypi`；不需要 token |

GHCR 推送和 cosign 签名使用工作流自带的 `GITHUB_TOKEN` 与 OIDC，不需要额外密钥。

## 发布预览版

预览版不需要签名证书、行为证据或 PyPI；标签的 `X.Y.Z` 必须等于当前版本，`CHANGELOG.md` 必须已有
`## [X.Y.Z]` 小节，`N` 从 1 开始递增。安装包的应用版本就是 `X.Y.Z`，不带 `-preview`。

1. 合并到 `main`，等 push 触发的 `ci.yml` 和 `runtime-security-contract.yml` 在该提交上成功。
2. 打标签并推送：

   ```bash
   git tag v0.2.0-preview.1 <main 上的 SHA>
   git push origin v0.2.0-preview.1
   ```

3. `preview-release.yml` 依次：核对标签与版本、查同 SHA 的 CI 证据 → 以 `preview: true` 调用
   `build-win.yml`（强制未签名，不读取签名 secret）和 `build-linux.yml`，同时构建 wheel/sdist 并
   `twine check` → 生成 `SHA256SUMS` → 直接发布 Pre-release。说明 = `.github/preview-release-notes.md`
   的中英文提示（未签名与 SmartScreen、不在 PyPI、不自动更新、哪些功能需要模型）+ CHANGELOG 小节。
4. 重跑同一个预览标签：

   ```bash
   gh workflow run preview-release.yml --ref v0.2.0-preview.1 -f tag=v0.2.0-preview.1
   # Linux AppImage 构建失败时，可只发 Windows：追加 -f include_linux=false
   ```

   Release 已存在时先 `gh release delete v0.2.0-preview.1 --yes`（保留标签）。需要改代码时，在新提交上
   打 `v0.2.0-preview.2`。

说明：`build-win` 的 job 仍声明环境 `windows-code-signing`，给它配了 required reviewers 或部署标签限制时，
预览构建也要批准 / 放行 `v*-preview.*`。预览版不附 `latest.yml` 等更新元数据，应用内更新不会推送它；
未配置 `ECHO_PLUGIN_SIGNING_*` 变量时，它不含内置插件发布者公钥，Release 说明会注明。

## 正式版发版步骤

1. 在 `main` 上确认 `CHANGELOG.md` 已有 `## [X.Y.Z]` 小节，把 `Unreleased` 改成发布日期；版本号按上文一致。
2. 推送到 `main`，等待同一提交上的 `ci.yml`、`runtime-security-contract.yml`、`build-win.yml`（已签名）全部成功。
3. 在同一提交上手动运行 `behavioral-evidence.yml` 并等待成功。
4. `git tag vX.Y.Z <该提交> && git push origin vX.Y.Z`，`release.yml` 开始运行。
5. `release.yml` 依次：核对版本 → 下载证据并跑 `make production-readiness` → 复核 Windows 签名 → 构建 wheel/sdist → 推送并签名 GHCR 镜像 → 发布到 PyPI → 创建 **草稿** GitHub Release（附 Windows 标准版与完整离线版安装包，以及两者共用的 `SHA256SUMS`）。
6. 检查草稿内容后手动发布。

## 本地构建（不发布）

```bash
uv build --no-sources --out-dir dist                  # wheel + sdist
cd frontend && pnpm build                             # frontend/dist
pnpm electron:build:win -c.win.forceCodeSigning=false # 未签名的标准版 Windows 安装包
pnpm electron:build:win:offline -c.win.forceCodeSigning=false # 未签名的完整离线版
```

标准版不带 Codex / OpenCode，用户在 HUB「应用」里按需下载（先 ai.echo-age.com，再官方源）。
发布新的引擎版本前，先用 `uv run python scripts/publish_engine_mirror.py --out <目录>`
生成镜像目录并上传到服务器的 `/var/www/echo/marketplace/engines/`。

Windows 安装包还需要先在 `extras/desktop` 运行 `pnpm backend:build:win`（PyInstaller 后端），
脚本里的 `pnpm` 必须在 PATH 上。
