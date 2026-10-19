# Kane 光机电能力迁移

2026-10-19，按用户要求，将截图中的七个工程插件和找回的光学工作台共八个能力包接入 Echo AI，选用 Kane / Paladin
作为光机电与 AI 系统工程搭档。保留角色 ID、外观、人物关系和原有软件工程能力。
选择依据是其工程执行、系统拆解与实际交付的既有定位；这不是对用户完整人格的判断。

| 能力包 | 技能动作 | MCP 工具 |
| --- | ---: | ---: |
| SolidWorks 本地控制 | 1 | 42 |
| Blender 本地控制 | 1 | 26 |
| KiCad 电路设计控制 | 1 | 9 |
| Zemax Control | 1 | 32 |
| LightTools 本地控制 | 1 | 19 |
| 投影光学设计工具箱 | 12 | 按任务使用对应服务 |
| 镜头知识与处方工具箱 | 3 | 本地只读资料客户端 |
| 找回并补迁的光学工作台 | 2 | 35 |
| 合计 | 22 | 163 |

投影技能涵盖系统架构、光源、收集透镜、扩展量、复眼、棱镜、配色亮度、LCOS 偏振、
验证、资料检索、知识记忆和快速原型。镜头技能涵盖证据检索、专利溯源与处方复用。
工具发现验证只证明服务初始化和接口注册成功，不代表完成 CAD 建模、光学求解或许可证验收。

## 角色与执行

`agents/kane/profile.jsonc` 定义现实职业和六个 MCP 依赖；`agent-core/SOUL.md`
保存跨领域工作方法和资料边界。`agent-core/tool-registry.jsonc` 绑定二十二项插件动作与
163 个准确工具名，保留原有软件技能。主角身份不增加账户管理权或绕过工具授权。

外部执行器现在会载入角色明确绑定的插件技能，无需每轮手动 @ 插件；自动载入仅允许角色
绑定的动作，不把同包其他动作扩成权限。用户当轮明确选择插件仍遵循原来的授权流程。
模型先调用对应技能动作读取规则，再使用带 `mcp_<服务名>_` 前缀的实际工具。

## 私人资料

本地 SQLite 经一致性备份迁至 `<Echo数据目录>/personal-engineering/lens-library-20261019/`，
通过 `~/.echo/lens-toolkit.local.json` 指向快照。私人数据不进入可发布插件或 Git。
原始文档及模型保持原位置，只迁移数据库、知识图谱和知识文件；已有来源路径仍是依赖。
本机迁移报告保留源位置、快照 SHA-256、统计及限制。

实读统计：62 条知识卡、27,962 个处方案例、124,793 条逐面记录、90,310 条专利配置记录。
镜头库 JSON 图谱包含 72 个节点、62 条边。这些数字是资产和索引规模，不是掌握率；
本次未新增原生复算或实测。历史项目参数不能自动变成新项目指标。

补查确认：原工作台于 2026-10-11 从桌面迁至 `E:/工作区/lcos/optics-workbench`，
迁移记录位于 `E:/迁移存档/C盘迁移/LCOS迁移记录_20261011/`。Codex 当前配置仍指向
已失效的 C 盘路径。前一轮仅检查旧路径，遗漏了 E 盘工作区，现已纠正。

工作台主库包含 5,861 个图谱节点、7,570 条关联、542 条记忆（399 条工程经验、
133 条待验证问题、10 条用户偏好），以及 14,074 条文档索引、344 条知识记录、
1,000 条模型索引、12 个参数原型。以上与镜头库分别计数，不能相加当作学习量。
原件只读；工作台代码已打包，两个数据库经一致性备份迁入 Echo 私人数据目录，
新增 35 个 MCP 工具和两项技能，已通过真实 MCP 回读图谱统计与记忆。
Echo 副本后续写入不会自动回写原工作台。Codex 的旧连接需要独立更新并重连。

## 重复部署

先准备 Echo 独立的 Zemax 与 LightTools Python 环境。LightTools 用其插件内
`requirements.lock`，Zemax 用 `requirements-lock.txt`；原生软件依赖仍需本机安装。
执行以下入口时，数据目录应与目标 Echo 后端保持一致：

```powershell
.venv/Scripts/python.exe tools/install_personal_cad_plugins.py --config config.local.yaml --apply
.venv/Scripts/python.exe tools/migrate_personal_optics_library.py --source-library <原镜头库目录> --destination <全新快照目录> --apply
```

安装器先验证五个服务的工具清单和七个包，再通过既有插件生命周期安装，保留配置和插件备份。
它保留其他 MCP 配置；绑定角色不会替其他登录账户授予权限。修改插件内容需提升版本号。
配置与执行器改动需重启目标 Echo 后端。移植包源码位于 `extensions/codex-plugins/`；
本机安装根目录以 `personal-cad-migration.json` 为准，不沿用旧机器路径。

验证入口：`test_personal_engineering_migration.py`、`test_personal_cad_plugins.py`、
`test_codex_dynamic_tools.py`。覆盖七包加载、角色绑定、同包动作不越权、SQLite WAL 一致性备份、
重复目录拒绝、MCP 注册及外部执行器动态工具边界。

本次相关回归共 45 项通过，Ruff 与差异空白检查通过。本机后端已重新加载配置，
`/api/health` 返回正常；七包均为 installed/enabled，Kane 无需手动选择插件即载入二十项技能动作。
已通过 Echo 安装副本回读知识卡 K001，来源 SHA、PDF 物理页定位与验证限制保持一致。

补迁工作台后，角色自动载入 22 项动作、允许 163 个 MCP 工具；新增工作台技能绑定验证，
29 项迁移与动态工具测试通过。工作台迁移记录在私人目录
`data/personal-engineering/optics-workbench-20261019/`，包含配置、数据库快照指纹、安装事务和真实 MCP 回读。
原工作台网页当前未监听旧端口 8790，Echo 通过独立 stdio MCP 使用迁移副本。
