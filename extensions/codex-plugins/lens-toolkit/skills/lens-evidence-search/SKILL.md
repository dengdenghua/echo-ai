---
name: lens-evidence-search
description: 检索已配置的本地镜头知识库、Zemax处方案例、LensVIEW专利配置及逐页证据，返回来源和读取范围。适用于找已有镜头资料和设计起点。
---

# 镜头证据检索

使用本 Skill 的 `scripts/library.py`。它只读取 SQLite；数据库路径来自 `--library`、环境变量 `LENS_LIBRARY_ROOT` 或 `~/.echo/lens-toolkit.local.json` 的 `library_root`，按此优先级解析。先运行 `stats` 确认实际连接。没有配置时询问资料库位置，不把缺配置解释为缺资料。Windows 可使用已配置的 bundled Python，无第三方依赖。

```text
python <本Skill目录>/scripts/library.py stats
python <本Skill目录>/scripts/library.py search "双高斯" --kind knowledge --limit 8
python <本Skill目录>/scripts/library.py search "double gauss" --kind cases --limit 8
python <本Skill目录>/scripts/library.py search "投影" --kind pages --limit 8
python <本Skill目录>/scripts/library.py detail cases <case_id>
python <本Skill目录>/scripts/library.py detail pages <page_id>
```

按问题选择 knowledge（范围核读结论）、cases（ZMX 处方）、patents（LensVIEW 配置）、pages（全文页/段）、documents（文件身份）、resources（外部导航）。关键词以空格求交，按原文中英文分别检索，先小结果集，再读取代表记录的完整详情。

交付结论时引用 `source.sha256`、`locations.original_path` 和具体 `locator`；pages 的 `page` 对文本/PPT 是提取段号，只有 PDF locator 明示时才称物理页。机器提取文本的公式和表格需核原页。

主题关联只提供候选；INT/USP 数据集、实施例和变焦配置各自保留。字段未定义、玻璃依赖未解决、特殊面型/求解未原生解释时说明缺口。库中有处方不表示已重跑，更不表示量产镜头或实测性能。

需要跨在线专利原文核对时用 `lens-patent-research`；要复制已有处方作设计起点时用 `lens-prescription-reuse`。数据库定义见 [schema.md](references/schema.md)。
