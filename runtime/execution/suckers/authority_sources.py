"""Publisher discovery hints, not a cache of standards or proof of compliance."""

from __future__ import annotations

import re

_SOURCES = {
    "GB": (
        ("全国标准信息公共服务平台", "https://std.samr.gov.cn/", "std.samr.gov.cn"),
        ("行业标准备案查询", "https://std.samr.gov.cn/hb/", "hbba.sacinfo.org.cn"),
    ),
    "ISO": (("ISO 标准目录", "https://www.iso.org/standards.html", "iso.org"),),
    "ASME": (("ASME Codes & Standards", "https://www.asme.org/codes-standards", "asme.org"),),
    "IEC": (("IEC Webstore", "https://webstore.iec.ch/", "webstore.iec.ch"),),
    "office_policy": (
        ("国务院政策文件库", "https://sousuo.www.gov.cn/zcwjk/", "gov.cn"),
        ("国家档案局行业标准", "https://www.saac.gov.cn/daj/hybz/dabz_list.shtml", "saac.gov.cn"),
    ),
}


SELECTION_PRINCIPLES = (
    "适用于所有专业：在满足功能、质量、安全、合规和项目约束后，优先复用已批准且适用的资产，"
    "再选择适用标准、常用规格和成熟产品、技术、流程或模板，确有缺口才定制。"
    "依据所属专业核对兼容性、互换性、可获取性与持续支持、维护交接、全生命周期成本及供应商锁定风险；"
    "减少无必要的种类和特殊依赖。标准化不等于指定品牌，流行成熟不等于合规适用，"
    "也不把机械零件选型规则套用到软件、电子或办公等其他专业。"
    "先查已有受控资产及适用标准、正式目录、官方接口文档或流程定义，再比较可行方案；"
    "记录采用依据、版本、已验证替代条件及待核实项。确需定制时说明已有方案不满足的约束及代价。"
    "不为通用性牺牲关键要求，不擅改已批准方案，不因此新增固定审批或每次任务都联网。"
)


def resolve_discovery_purpose(query: str, purpose: str) -> str:
    if purpose != "auto":
        return purpose
    if re.search(
        r"公差|国标|行标|国家标准|行业标准|工程图|几何精度|表面粗糙度|"
        r"\b(?:GB(?:\s*/\s*T)?|ISO|IEC|ASME|JB\s*/\s*T)\s*[-\d]|"
        r"\b(?:tolerances?|GD&T)\b",
        query,
        re.IGNORECASE,
    ):
        return "standards"
    if re.search(
        r"办公规范|办公行为|公司制度|企业制度|审批流程|文件归档|档案管理|公文规范|office policy",
        query,
        re.I,
    ):
        return "office_policy"
    return "capability"


def authority_plan(query: str, purpose: str, standard_family: str) -> dict:
    if purpose == "capability":
        return {}
    if purpose == "office_policy":
        families = ["office_policy"]
    elif standard_family != "auto":
        families = [standard_family]
    else:
        families = [
            name for name in ("GB", "ISO", "ASME", "IEC") if re.search(rf"\b{name}\b", query, re.I)
        ]
        # A Chinese entry point is a discovery default, never the governing
        # standard choice. The project/customer scope must still be established.
        families = families or ["GB"]
    sources = [
        {"name": name, "url": url, "domain": domain}
        for family in families
        for name, url, domain in _SOURCES[family]
    ]
    return {
        "status": "not_verified",
        "sources": sources,
        "verification_fields": [
            "applicable_region_industry_and_project",
            "issuer_and_document_identifier",
            "edition_and_amendments",
            "effective_date_and_current_status",
            "replacement_or_withdrawal",
            "binding_or_recommended_and_adoption_basis",
            "verified_clause_table_or_page",
            "source_url_and_retrieval_date",
        ],
        "guidance": (
            "这些是查证入口，不是已查证标准。先确定地区、行业、合同/客户约定及企业受控文件；"
            "网页发布日期不等于实施日期，最新版不一定是项目约定版。核对编号、年份、修订、现行/废止/替代关系，"
            "区分强制要求、推荐标准、合同采用要求和内部制度；相互冲突时指出冲突，不自行宣布优先级。"
            "通过发布机构、标准机构或主管部门原文核对条款，博客和 GitHub 只能作线索。"
            "检索首页或看到摘要不等于读到正文；有付费或访问限制时使用合法授权文本，无法取得则标记未核实。"
            "只有完成相应条款检查后才能声称符合规范。图纸公差必须结合功能、配合、尺寸段、等级和制造检验条件，"
            "不凭记忆填写数值，不随意混用 GB/ISO/ASME。办公流程先查企业/客户受控模板与制度，"
            "外部通用规范不能冒充公司规定；草稿、审核、批准和发布状态应区分，不代填签字或声称已批准。"
            "保存采用依据、版本和待核实项；具体结论引用标准号、条款/表号及来源。"
        ),
    }
