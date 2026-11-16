---
name: lens-patent-research
description: 查找镜头专利和在线处方案例资源，核对本地LensVIEW配置与专利原文的国家、实施例、变焦位置及尺度；用于专利找镜头和在线案例溯源。
---

# 镜头专利与在线案例

使用同插件 `../lens-evidence-search/scripts/library.py` 的只读客户端；独立安装时该 Skill 也以同名相邻目录提供。配置方法与运行时要求见相邻 `lens-evidence-search/SKILL.md`。

```text
python <相邻lens-evidence-search目录>/scripts/library.py search "专利" --kind resources
python <相邻lens-evidence-search目录>/scripts/library.py detail resources lensview
python <相邻lens-evidence-search目录>/scripts/library.py patent-links US2117252 --limit 10
python <相邻lens-evidence-search目录>/scripts/library.py detail patents <configuration_id>
```

先读资源的 status、checked_on、provenance、limitations。Delphion 等历史入口、LensVIEW 本地光盘库与现行官网分别说明。旧文献的 OSA 条目误写 SPIE 网址，不能沿用为正确官网。

当用户要在线查证时，实际打开官方专利站或案例作者原站，记录检索式、访问日、专利国家/编号/种类码、申请人、实施例、表/段/图位置。`patent-links` 只生成候选链接和本地数字编号匹配；它没有下载原文，也不能确认不同国家同号记录就是用户指定专利。

对处方表核实 R/曲率、厚度、玻璃或 nd/Vd、单位/焦距归一化、光阑、视场/孔径定义、非球面方程及变焦间隔。仅有 nd/Vd 时不冒充精确牌号或全光谱色散。在线案例与量产型号的对应关系需单独证据。

若用户要求把新案例加入库，保存来源元数据和实际取得的内容指纹，再记录映射与缺口；只加入入口时登记为资源导航。订阅或校验页面读取失败就保留状态，不扩大下载范围。专利公开文本中的设计描述不替代原生追迹；涉及当前法律状态或权利判断时另核官方资料。
