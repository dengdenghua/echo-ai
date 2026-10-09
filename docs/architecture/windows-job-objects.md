# Windows Job Object 进程树约束

状态：工具与非内核启动点已落地；`sandbox.py` / `streaming.py` 的接入是**待审核方案**，本文只给出 diff 草案，没有应用。

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
- `terminate_process_tree(proc)`：有 job 时先 `TerminateJobObject`，即使 `proc` 已经退出也执行，这样能结束被遗弃的孙进程；没有 job 时仍走原来的 `taskkill` 路径。**没有 job 的调用方行为完全不变**，包括两个内核文件。
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

## 内核文件接入方案（待审核，未应用）

两个文件都登记在 `runtime/kernel-release.json` 的 `ai` profile 里，`os` profile 中有各自的版本。

### `runtime/platform/process/streaming.py`（`stream_run`）

```diff
     started_at = time.monotonic()
     try:
         from runtime.platform.process.tree import (
-            process_group_kwargs,
+            detach_process_job,
+            spawn_in_job,
             terminate_process_tree,
         )

-        proc = subprocess.Popen(
+        proc = spawn_in_job(
             _popen_args(argv),
             stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
             stdout=subprocess.PIPE,
             stderr=subprocess.PIPE,
             text=True,
             encoding=encoding or _child_text_encoding(output_argv, run_env),
             errors="replace",
             cwd=run_cwd,
             env=run_env,
             bufsize=1,
             shell=False,
-            **process_group_kwargs(),
         )
@@
     finally:
         t_out.join(timeout=2.0)
         t_err.join(timeout=2.0)
+        # Timeout/cancel already ended the whole job in terminate_process_tree.
+        # Normal exit: daemons the command started (adb server, build servers)
+        # keep running, matching POSIX setsid daemons. Strict alternative:
+        # close_process_job(proc) kills them at command end.
+        detach_process_job(proc)
```

### `runtime/safety/sandboxing/sandbox.py`（`SandboxRunner.run`）

```diff
         started_at = time.monotonic()
         from runtime.platform.process.tree import (
-            process_group_kwargs,
+            detach_process_job,
+            spawn_in_job,
             terminate_process_tree,
         )

         try:
-            proc = subprocess.Popen(
+            proc = spawn_in_job(
                 cmd_list,
                 cwd=str(run_cwd),
                 env=env,
                 stdin=subprocess.PIPE if stdin_text else subprocess.DEVNULL,
                 stdout=subprocess.PIPE,
                 stderr=subprocess.PIPE,
                 text=True,
                 encoding="utf-8",
                 errors="replace",
-                **process_group_kwargs(),
             )
@@
         out_thread.join(timeout=1.0)
         err_thread.join(timeout=1.0)
+        detach_process_job(proc)

         return SandboxResult(
```

可选的第二步：给 `SandboxPolicy` 增加 `max_process_memory_bytes` / `max_processes`，通过 `limits=JobLimits(...)` 传进去，并把 `"windows_job": process_job(proc) is not None` 写进 `execution_policy` 快照。这两项会改变策略和回执的 schema，需要单独评审。

### 为什么需要人工审核

1. 两个文件是所有 `exec_shell` / 沙箱命令的唯一执行路径。清单的作用就是让它们的每次行为变化都有人核验，而不是重算摘要了事（见 `docs/kernel-release.md`）。
2. 有语义选择要人来定：正常结束后残留的守护进程，是保留（`detach`，与 POSIX 一致）还是结束（`close`，最严格的"不留孤儿"）。
3. job 内的进程不能 breakaway。少数程序用 `CREATE_BREAKAWAY_FROM_JOB` 启动子进程，在 job 里会以 `ERROR_ACCESS_DENIED` 失败。是否给 job 加 `JOB_OBJECT_LIMIT_BREAKAWAY_OK`，需要在兼容性和约束强度之间取舍。
4. 修改后要更新 `ai` profile 的 sha256 和 `revision`，以及 `runtime.release_identity.SUPPORTED_RELEASES` 里固定的审核摘要，并重新运行安全行为门（`tests/test_sandbox_platform_contract.py` 等）和跨端任务回归。

### 对 echo-os 的影响

- POSIX 上 `spawn_in_job` 等同于原来的 `start_new_session=True`，echo-os 在 macOS/Linux 上没有行为变化。
- echo-os 的 `streaming.py` / `sandbox.py` 是 `os` profile 下的独立版本，不会被 echo-ai 覆盖。如果要采用同样的改动，必须先同步 `runtime/platform/process/win_job.py` 和新版 `tree.py`。echo-os 当前的 `tree.py` 是旧版，没有 `spawn_in_job`，只同步内核文件会在 import 时失败。
- 采用后，`os` profile 的摘要也要更新，两个仓库的共同 `revision` 随之变化，要按双仓流程运行 `tools/kernel_release.py --ai-repo ... --os-repo ...`。
- echo-os 如果有 Windows 构建，并且由外层的 kill-on-close job 托管后端，嵌套 job（Windows 8 及以上）照常工作；外层 job 带 silent-breakaway 时（uv 和 venv 的启动器都是这样），子进程会离开外层 job，但仍留在本 job 中。

## 已知限制

- 不在 job 里的进程：通过 WMI `Win32_Process.Create`、计划任务、服务或 COM 本地服务器启动的进程，由别的父进程创建，不受 job 约束。
- `terminate_pid_tree(pid)`（例如重启后从元数据恢复的后台任务）拿不到 job，仍用 `taskkill`。
- venv 下的 `python.exe` 是启动器，会再启动真正的解释器，因此一个 Python 子进程会占用 job 里的两个进程名额，设置 `active_processes` 时要考虑这一点。
