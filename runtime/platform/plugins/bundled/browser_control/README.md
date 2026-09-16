# 浏览器控制

Echo 随应用交付的 ModulePlugin，使用 PluginHub 的安装、启用、停用、卸载入口。
保留现有工具 ID；Codex、OpenCode 继续使用 Echo Host MCP 的工具桥。

Playwright 驱动使用项目的 `browser` extra，并需要安装相应浏览器运行时。
内置浏览器需要 Electron 宿主，用户浏览器 Relay 需要另外安装
`extensions/echo-browser-relay` Chrome 扩展。缺失驱动不阻止其他插件加载。

停用注销工具、撤销缓存处理函数，并阻止新的 HTTP 自动化请求。
已经进入驱动执行的动作不强行中断；保留用户浏览器会话与个人数据。
`enable_web_skills: false` 或关闭浏览器自动化设置仍是宿主约束，启用插件不能越过。
