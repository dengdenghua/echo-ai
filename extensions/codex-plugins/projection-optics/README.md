# 投影光学设计工具箱

12 个可独立使用的 Skill；插件负责统一安装。每个 `skills/<name>` 目录包含自己的说明和必需资源，可单独复制到目标环境的 Skills 目录。无需先调用总入口。

- `collector-lens-design`：收集与准直透镜设计
- `projection-source-architecture`：光源架构与多通道设计
- `optical-etendue-budget`：扩展量与面角匹配
- `flyeye-design`：复眼与匀光设计
- `projection-prism-design`：投影棱镜与合光设计
- `projection-color-brightness`：配色与亮度预算
- `lcos-polarization-design`：LCOS偏振与对比度
- `optical-design-verification`：光学验证与公差
- `optical-evidence-library`：光学资料与模型检索
- `projection-system-design`：投影光机系统设计
- `optical-knowledge-memory`：知识图谱、个人记忆与学习沉淀续接
- `optical-rapid-prototyping`：倍率缩放、参数与示意光路联动、预览后另存与 JSON 迁移

## 集成与迁移

设计方法 → 既有 LightTools/Zemax 控制 Skill 和 MCP → 原生模型与结果。资料/预算/参数原型 → 既有 Optics Workbench MCP。此包是 skills-only，不重新注册或自动启动这些服务器；更换机器时仍需分别配置相应软件、许可证、运行时及本地资料。

`plugin.json` 为可迁移清单，`.codex-plugin/plugin.json` 为 Codex 兼容清单。可加入本地 marketplace 后安装；在个人 marketplace 注册为 projection-optics 时可用 `codex plugin add projection-optics@personal`。本机是否已装成功以 CLI 返回和缓存验证为准。安装后若当前会话目录尚未更新，在新会话中验证。

此包不包含私人资料、历史模型、数据库、用户路径、密钥或插件运行时。原有知识目录继续供工作台读取，不因技能拆分而迁移或删除。公开发布和私人知识迁移是两项不同操作。

## 使用例子

- “使用 $optical-rapid-prototyping，把20 mm基准做成30 mm候选，保持真实光源尺寸，预览后另存并检查真实器件接口。”

- “使用 $projection-source-architecture，比较 RGB 与蓝泵增强绿光架构，明确驱动、转换、合光与显示通道。”
- “使用 $projection-source-architecture，比较激光荧光粉和 RGB 直接激光，核对转换/消散斑之后的面角接受。”
- “使用 $collector-lens-design，检查这个光扇中间线能否确定镜组焦距。”
- “使用 $collector-lens-design，比较两片一非球面、两片两非球面和实际玻璃牌号，核面角接受及制造约束。”
- “使用 $flyeye-design，按给定入口面角分布设计双复眼。”
- “使用 $projection-color-brightness，检查白点和时序是否重复扣损失。”
- “使用 $projection-system-design，比较两套投影光机的端到端预算。”

规则和源条件优先于历史样例；计算、几何追迹、功率仿真与实测分别报告。准直组的主线是像高/平行光探针 → 整组焦距/主面 → 实际发光面 → 角范围 → 面角联合接受及公差。

光源架构负责选择发光、泵浦、转换、合光与时序关系；配色亮度负责已定义输出通道的白点和通量；整机设计负责跨器件接口。新增蓝泵不自动等于新增显示基色，转换输出与泵光不重复入账。

0.3.0 增补激光荧光粉与 RGB 直接激光两条流程，并补充激光 DMD 的衍射、功率和热验证接口。TI 资料按文档版本及章节定位，历史典型参数不作为默认规格。源架构仍是一个可独立迁移的 Skill，按需读取不同发光机制的参考文件。已有 DMD 插件可选配，实际模型范围以该插件能力声明为准。

收集镜组专题在 0.3.1 增补片数、非球面位置与实际玻璃牌号的比较流程，保留统一焦距/机械约束、面角接受口径及制造敏感性。候选结构是设计起点，具体增益需要对应模型验证。

Packaging: https://developers.openai.com/plugins/build/plugins

知识与记忆维护 Skill 随通用包迁移；实际图谱、记忆、核读目录与资料另保留在本地。学习时先检索已有记忆，再将有来源和适用条件的结论登记、回读核验，并把缺口交给下一批。此工作快照未作新版本发布。
