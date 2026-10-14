# 工具执行与可恢复错误

## 命令参数

`exec_shell` 和 `background_exec` 使用 `shell=False`，优先接收 argv 数组。
字符串命令在 Windows 上通过 `CommandLineToArgvW` 解析，在其他平台使用
POSIX shlex；Windows 双引号只负责参数分组，不会作为额外字符传入 Python `-c`。
不会自动启用 cmd/PowerShell，也不会改变工作区、审批和环境隔离策略。

回归测试不仅检查退出码，还确认标准输出和临时文件内容，以防代码被当作
字符串字面量求值、退出成功却没有执行预期操作。

## 修改前读取

修改已有文件仍须在当前轮先读取。缺少读取记录时，执行器保留
`read_before_write_required` 分类，并返回 `retryable`、`blocked_operation`
及 `recovery`：后者包含读取工具名、目标参数和核对最新内容后重试的说明。
Codex 动态工具桥保留这些字段；模型应先读取和检查，再调整并重试编辑。
执行器不会替模型自动读取并盲目重放修改。

引擎指令要求报告失败的具体工具和实际错误；只有终端调用确实返回权限拒绝，
才能据此报告终端执行受限。修改前读取这一前置条件不需要扩大权限。

验证入口：`tests/test_windows_command_arguments.py`、
`tests/test_codex_dynamic_tools.py`、`tests/test_read_before_write.py`、
`tests/test_write_skills.py`、`tests/test_codex_role_context.py`。

## Windows Codex 的执行入口

2026-09-15 的原始 Codex 会话记录确认：原生 `exec_command` 在启动
PowerShell 执行 `git status --short` 前返回 `blocked by policy`。当时配置
已经是 Echo 的完全访问配置，但为保护账号与会话目录而保留的 deny 规则
使 Codex 将该配置视为受限文件系统；不能用 OpenCode 执行成功证明原生
Codex 终端也恢复了。

Windows 的 Echo Codex 角色现在设置服务端 `host_tools_only`：在
`thread/start`、`thread/resume` 和 `turn/start` 都撤下原生执行环境，保留
当轮 Echo 动态工具目录及回调。终端、读写文件由 Echo 的工具代理执行，
沿用工作区授权、审批、取消和修改前读取校验，不放宽隔离目录的保护。
空工具目录不会重新开放原生工具；无工具回复及连接器专用请求保持各自边界。
角色指令明确使用已发布的 `exec_shell` 和文件工具，不沿用旧的原生终端
拒绝结论，也不绕过 Echo 工具实际返回的拒绝。

回归：`tests/test_codex_host_execution.py` 覆盖新建、恢复、空目录和角色构造；
`tests/test_codex_host_execution_live.py` 使用真实 Windows Codex App Server、
Echo 工具代理和子进程，在临时 Git 仓库验证 `git status --short`、退出码 7
后的继续执行，以及恢复同一会话后的再次执行。测试不修改用户项目。
该实时测试需设置 `ECHO_RUN_CODEX_LIVE_SMOKE=1`、`ECHO_CODEX_LIVE_BINARY`，
并提供已登录的 Codex 源目录（默认当前用户的 `.codex`）。
