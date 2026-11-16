---
name: lens-prescription-reuse
description: 将本地镜头案例准备成保留SHA和逐面证据的Zemax工作副本，检查单位、视场、光阑与材料依赖，并衔接原生验证。适用于复用已有处方作设计起点。
---

# 镜头处方复用

从相邻 `lens-evidence-search/scripts/library.py` 检索候选并读取 `detail cases <id>`，选型依据写成目标条件：工作波段、共轭、焦距/倍率、视场口径定义、入瞳/F数、后焦和空间限制。用户已给的信息直接使用；未给的数据保留为待定，不从历史案例补成新项目指标。

```text
python <相邻lens-evidence-search目录>/scripts/library.py search "projection" --kind cases --limit 8
python <相邻lens-evidence-search目录>/scripts/library.py detail cases <case_id>
python <相邻lens-evidence-search目录>/scripts/library.py prepare-case <case_id> --output <全新工作目录>
```

`prepare-case` 在复制前核完整 SHA-256，目标目录必须尚不存在，保留原始 ZMX 字节，生成 `case_provenance.json` 与 `handoff.md`；它不改变几何、单位或玻璃。哈希变化时先解决来源身份，不绕过核对。LensVIEW DBF 配置不是 ZMX，需按专利原表核实并另建模型，不能把 JSON 改后缀当处方。

在副本中核 UNIT、FTYP、孔径类型、光阑面、玻璃目录、波长/主波长、环境折射率、多结构启用、拾取与求解、渐晕和特殊面型。玻璃缺失时先报告；替代材料需明确标识并重新验证。

需要真实建模或优化时读已安装的 `zemax-control:zemax-control`，通过可用 ZOS-API 工具打开另一个工作副本并保存结果。工具不可用时保留交付，明确尚未原生验证。比较至少目标条件下的布局/光阑、实际焦距/倍率、视场和孔径，以及用户要求的像质指标；评价频率、波长、视场权重和补偿量与结果同时记录。

尺度缩放不是 `prepare-case` 的隐式步骤。用户要求缩放时明确长度尺度和焦距目标，核全部有量纲字段、非球面项、孔径/共轭及多结构，再以原生软件复算。制造公差、热漂移、鬼像和量产性能需要相应额外证据，不能用复制成功替代验收。
