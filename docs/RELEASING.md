# 发布 ECHO AI

`release.yml` 由 `v<版本>` 标签触发（例如 `v0.2.0`），只发布**同一提交**上已经全部通过的证据。
本页列出它依赖什么、需要哪些密钥，以及发版顺序。

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

`build-linux.yml` 产出 AppImage，但 `release.yml` 目前不上传 Linux 包。

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

## 发版步骤

1. 在 `main` 上确认 `CHANGELOG.md` 已有 `## [X.Y.Z]` 小节，把 `Unreleased` 改成发布日期；版本号按上文一致。
2. 推送到 `main`，等待同一提交上的 `ci.yml`、`runtime-security-contract.yml`、`build-win.yml`（已签名）全部成功。
3. 在同一提交上手动运行 `behavioral-evidence.yml` 并等待成功。
4. `git tag vX.Y.Z <该提交> && git push origin vX.Y.Z`，`release.yml` 开始运行。
5. `release.yml` 依次：核对版本 → 下载证据并跑 `make production-readiness` → 复核 Windows 签名 → 构建 wheel/sdist → 推送并签名 GHCR 镜像 → 发布到 PyPI → 创建 **草稿** GitHub Release（附 Windows 安装包与 `SHA256SUMS`）。
6. 检查草稿内容后手动发布。

## 本地构建（不发布）

```bash
uv build --no-sources --out-dir dist                  # wheel + sdist
cd frontend && pnpm build                             # frontend/dist
pnpm electron:build:win -c.win.forceCodeSigning=false # 未签名的 Windows 安装包
```

Windows 安装包还需要先在 `extras/desktop` 运行 `pnpm backend:build:win`（PyInstaller 后端），
脚本里的 `pnpm` 必须在 PATH 上。
