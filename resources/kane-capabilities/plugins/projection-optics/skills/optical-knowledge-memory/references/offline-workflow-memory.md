# 工作台未连接时的本地续接

先发现 Optics Workbench 工具并检查已有配置。若工具不可用且已知服务器源码/启动入口不存在，不把一个新建 SQLite 库冒称原图谱，也不擅自修改私人图谱导入契约。

使用本技能的 `scripts/local_memory.py` 保存和检索本地工作流续接记录。默认存储为当前用户 `$CODEX_HOME/optical-workflow-memory/memory.sqlite3`，未设置时为 `~/.codex/optical-workflow-memory/memory.sqlite3`。私人记录不放入可分发插件包。脚本仅依赖 Python 标准库。

- 续接光学任务时先执行 `local_memory.py search "接收面"` 等主题检索，并检查 scope；再按实际工况读取证据。
- `local_memory.py add <记录JSON绝对路径>` 会验证必填范围、来源、证据状态及可选文件 SHA256，再幂等保存并回读。
- `local_memory.py stats` 核对真实记录数，不能把条数当掌握率。

记录要求：kind、scope、text、evidence_state、provenance。kind 仅支持 user_preference、engineering_lesson_pending_graph、open_question。用户偏好必须 provenance.type=direct_user_instruction；正文保留直接要求和日期/任务来源。工程经验记为待图谱关联的本地记录，不伪造 rule node。artifacts 可附 [{path,sha256}]，必须是当前存在的绝对路径及实测指纹。

原生几何检查通过、脚本行为验证、工程验收通过与尚未解决分别标记。具体项目的片数、余量或90%要求不得跨项目当默认限值。

原工作台恢复后，先检索已有规则并核导入契约，再同步合适记录；回读规则与关联记忆。没有完成这些步骤时，一律报告“本地已保存可检索，原图谱尚未同步”。此回退解决续接，不宣称恢复了工作台服务。
