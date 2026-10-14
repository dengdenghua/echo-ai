# Google / GitHub 登录配置

登录页顺序为 Google、GitHub、邮箱验证码，以及（启用 `local_auth` 时）本地登录。
`local_auth.enabled=true` 且未配置密码账户时，本地登录按运行方式区分：

- 开发实例（`ECHO_ENV=development`、`ECHO_DEPLOYMENT_MODE=local`，`pnpm dev:full` 会自动设置）：
  显示「访客模式」，输入任意用户名即可进入，只接受本机请求。
- 桌面版：桌面外壳用每次启动生成的令牌自动登录本机账户，登录页没有表单。
- 自托管（其余 `local` 部署）：显示「本机账户」。首次运行时服务端在控制台打印一次性设置码，
  同时写入 `<数据目录>/auth/owner-setup-code.txt`；在登录页输入设置码、用户名和密码即创建本机账户
  （管理员）。之后用这个密码登录。设置和登录都只接受本机与局域网（含 Tailscale 地址）的请求，
  经反向代理转发的公网请求也会被拒绝。忘记密码时删除 `<数据目录>/auth/local-owner.json` 并重启，
  再用新的设置码重新创建。

正式的多人部署请配置密码账户（`local_auth.users`）或邮箱登录；`shared`/`commercial` 模式不会启用本机账户。
未配置的第三方登录显示「暂未启用」，不会跳到无效授权页。

在运行后端的环境中配置以下变量，重启后生效（不要把密钥提交到 Git）：

```text
ECHO_AUTH_PUBLIC_URL=https://你的站点域名
ECHO_GOOGLE_CLIENT_ID=Google OAuth 客户端 ID
ECHO_GOOGLE_CLIENT_SECRET=Google OAuth 客户端密钥
ECHO_GITHUB_CLIENT_ID=GitHub OAuth App 客户端 ID
ECHO_GITHUB_CLIENT_SECRET=GitHub OAuth App 客户端密钥
```

本地开发使用 `ECHO_AUTH_PUBLIC_URL=http://localhost:3310`。
站点必须将 `/api` 转发到后端。生产环境使用 HTTPS，并保持原有 JWT 签名密钥稳定。

## Google

在 Google Cloud Console 配置 OAuth 同意屏幕，创建「Web 应用」类型的 OAuth 客户端。
授权重定向 URI：

```text
https://你的站点域名/api/auth/social/google/callback
```

本地测试填 `http://localhost:3310/api/auth/social/google/callback`。
测试状态下添加允许登录的测试用户；公开上线前完成 Google 要求的发布流程。
只申请 `openid email profile`，不申请邮件或云盘权限。

## GitHub

在 GitHub Settings → Developer settings → OAuth Apps 创建应用。
Homepage URL 填站点地址；Authorization callback URL 填：

```text
https://你的站点域名/api/auth/social/github/callback
```

本地测试填 `http://localhost:3310/api/auth/social/github/callback`。
只申请 `read:user user:email`，不申请代码仓库权限；账户需有已验证的主邮箱。

## 行为与验证

- 使用一次性 state、浏览器绑定 Cookie 和 PKCE，授权流程有效期 10 分钟。
- 服务端交换授权码、读取已验证邮箱；提供方 token 不返回浏览器或落盘。
- 登录完成后设置现有 HttpOnly 会话 Cookie，返回原来的站内页面。
- 社交账号以提供方稳定 ID 建立独立身份，不凭相同邮箱自动合并原账号或迁移数据。
- 身份记录存储于数据目录的 `social-identities.sqlite3`，重启时恢复。
- 目前待配置实际 OAuth 应用后，人工完成两个提供方的授权回调验收。
- 当前授权会话存于单个后端进程；多实例部署需粘性会话，或改用共享会话存储。

官方参考：[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[GitHub OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。
