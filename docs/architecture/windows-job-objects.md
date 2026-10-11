# Windows Job Object 进程树约束

状态：工具、非内核启动点和 `sandbox.py` / `streaming.py` 已接入。内核接入经本次行为测试后登记为公共清单 1.0.1；OS 产品适配源码保持独立。

## 问题

Windows 上原来的子进程管理是 `CREATE_NEW_PROCESS_GROUP` 加 `taskkill /pid N /T /F`：

- `taskkill /T` 在结束进程时按父 pid 链遍历。子进程已经退出时，它的孙进程就找不到了，例如 `cmd /c start server` 或 `python -c "Popen(...)"` 后立即退出。
- 后端进程本身崩溃、被 Electron `child.kill()`（即 `TerminateProcess`）或被任务管理器结束时，根本没有代码运行，整棵子进程树留成孤儿。用 `ECHO_WINDOWS_JOB_OBJECTS=0` 做对照实验：硬杀启动进程后，子进程和孙进程都还活着；开启 job 时两者都被结束。
- 没有任何进程级资源上限。

## 已落地（本分支）

`runtime/platform/process/win_job.py` 只用 ctypes，不加依赖。在非 Windows 平台上全部为空操作，能正常 import。

| API | 作用 |
|---|---|
| `JobLimits(kill_on_close=True, process_memory_bytes=None, job_memory_bytes=None, active_processes=None)` | 作业上限。内存上限按提交字节计，超限时分配失败，进程本身不会被杀；进程数达到上限后，job 内的 `CreateProcess` 失败 |
| `WindowsJob(limits)` | `.active`、`.assign_process(proc_or_pid)`、`.terminate(exit_code=1)`、`.close()`、`.detach()`、`.process_ids()`；线程安全；对象被回收时关闭句柄 |
| `attach_suspended(job, owner)` | 把挂起的子进程 assign 进 job，再恢复运行 |
| `job_for` / `register_job` / `release_job` | owner（`Popen` 或 asyncio `Process`）到 job 的弱引用登记表 |
| `ECHO_WINDOWS_JOB_OBJECTS=0` | 总开关，用于灰度或紧急回退 |

`runtime/platform/process/tree.py` 提供的高层用法：

- `spawn_in_job(args, *, limits=None, **popen_kwargs)`：POSIX 上等同于 `Popen(..., start_new_session=True)`。Windows 上的流程是 `CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED` → assign → resume。
- `terminate_process_tree(proc)`：有 job 时先 `TerminateJobObject`，即使 `proc` 已经退出也执行，这样能结束被遗弃的孙进程；没有 job 时仍走原来的 `taskkill` 路径。没有 job 的调用方仍走原有进程组清理。
- `close_process_job(proc)`：立即关闭 job，kill-on-close 会结束残留进程。
- `detach_process_job(proc)`：先清除 kill-on-close 再关闭句柄，残留进程继续运行，与 POSIX 上 setsid 守护进程的语义一致。

### 竞态

`Popen` 返回到 `AssignProcessToJobObject` 之间，子进程可能已经启动了孙进程，这个孙进程不会进入 job。处理方式是用 `CREATE_SUSPENDED` 创建子进程，此时它的首个线程一条指令都还没执行；先 assign，再 resume。

`Popen` 会关闭主线程句柄，所以 resume 用的是 `NtResumeProcess`，一次系统调用，约 0.1 ms；失败时退回 Toolhelp32 遍历线程。Toolhelp32 是文档化 API，但要对全机线程拍快照，在本机实测约 100 ms，不适合放在每条命令的启动路径上。

万一 resume 失败：子进程从未运行，杀掉后用不带 job 的普通方式重新启动，没有副作用。

### 降级

以下失败都只记 warning，然后回到原有行为（进程组 + `taskkill`），启动本身不会因此失败：

- 创建 job 失败；
- 设置上限失败（会先只保留 kill-on-close 重试一次）；
- `OpenProcess` 失败；
- `AssignProcessToJobObject` 失败，例如外层 job 不允许嵌套或权限不足。

### 已接入的启动点

| 启动点 | 语义 |
|---|---|
| `tree.run_capture`（worktree worker 命令） | kill-on-close；命令结束即关闭 job |
| `subagents/isolated_worktree._git` | kill-on-close；每条 git 命令结束即关闭 job |
| `suckers/_write_skills_exec._background_exec` + `_write_skills_background.kill()` | **不** kill-on-close：后台任务按设计要在后端重启后被 adopt（`recover_background_processes`）。`kill()` 改为直接子进程退出后也结束整个 job |
| `arms/process_tree.ProcessTreeManager.spawn` | asyncio 版本：挂起、assign、恢复；`untrack` / `terminate_all` 时释放 job |
| `workflow/engine` worker | kill-on-close；`dispose` 时关闭 job，结束 worker 退出后留下的子孙进程 |

## 内核执行路径与语义

`stream_run` 和 `SandboxRunner.run` 通过 `spawn_in_job` 启动进程；正常结束后
`detach_process_job` 释放句柄并保留命令启动的守护进程。这样 adb、编译服务器
等正常命令的语义保持，与现有 POSIX 行为一致。超时和取消先调用
`terminate_process_tree`，结束作业内整棵树，包括父进程先退出后留下的孙进程。
后端异常退出期间句柄由 Windows 关闭，仍在执行的命令树会被结束。

持久后台任务继续使用不带 kill-on-close 的作业，以便后端重启后按元数据恢复。
不开放 breakaway：命令显式申请离开作业会失败；可通过已有总开关回退到旧路径，
但关闭作业机制会失去后端崩溃时的树清理保证。没有增加新的内存/进程数策略字段。

Job Object 只约束进程树生命周期，不提供受限令牌、文件系统或网络隔离。
Windows 的当前沙箱仍属于软约束；严格/共享模式要求硬后端，缺失时拒绝执行。

## 版本与验证

两个文件属于 `ai` profile；更新后的源摘要进入 1.0.1 清单，并由新的固定摘要审核。
1.0.0 原审核摘要保留，校验器仍拒绝任意自算 revision 的未登记载荷。
共享源码和 `os` profile 未被覆盖；两仓共同登记新的清单与审核摘要。

本次验证包括真实 Windows 子孙进程、正常结束保留守护进程、超时清理，
以及沙箱平台合同和跨设备任务回归。命令与结果保存在收尾进度记录。
此验证不代表真机 Android、所有第三方程序兼容或正式安装包验收。

OS 如需接入同一 Windows 启动机制，必须同时引入 `win_job.py` 与新版 `tree.py`，
再按双仓流程更新产品摘要。本次未替换 OS 的进程/沙箱适配层。

## 已知限制

- 不在 job 里的进程：通过 WMI `Win32_Process.Create`、计划任务、服务或 COM 本地服务器启动的进程，由别的父进程创建，不受 job 约束。
- `terminate_pid_tree(pid)`（例如重启后从元数据恢复的后台任务）拿不到 job，仍用 `taskkill`。
- venv 下的 `python.exe` 是启动器，会再启动真正的解释器，因此一个 Python 子进程会占用 job 里的两个进程名额，设置 `active_processes` 时要考虑这一点。
