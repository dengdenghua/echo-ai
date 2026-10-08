"""Small visual entry points; detailed authoring guidance loads only on demand."""

from __future__ import annotations

from typing import Any

from runtime.platform.capabilities.tenant_context import current_capability_scope
from runtime.platform.process.session import current_session
from runtime.platform.visuals import create_visual, visual_status

from .registry import Skill, SkillRegistry

VISUAL_SKILL_NAMES = ("visual_guidelines", "show_visual", "visual_status")
_COMMON = (
    "用图解释关系、过程、空间或参数变化。简单流程用 mermaid 代码块；静态定制图用 SVG；"
    "有交互价值才用 HTML。标题、单位、图例清楚，颜色之外也用文字/线型区分，支持窄屏。"
    "show_visual 接受完整原始代码，不加 Markdown 围栏，单个载荷最多 100000 字符。"
    "HTML 在隔离 iframe 执行内联脚本；禁止外部网络、CDN、父窗口访问、导航、表单提交。"
    "使用内联 CSS、原生 JS 或内联 SVG，不依赖外部库；不要添加 CSP/base/iframe。"
    "载荷成功只表示等待浏览器展示；做其他工作后可查一次 visual_status，pending/unknown 不代表成功，"
    "不要循环轮询。error 时修正并提交新的 show_visual。浏览器回执不验证内容、数值或布局质量。"
    "需交付/分享/版本管理时，用现有文件工具写入任务工作区并走 HTML 产物预览和修订流程。"
)
_GUIDES = {
    "diagram": "SVG 设置 viewBox、可读文字、留白和不交叉的连线；标签靠近对象。工程示意必须注明非比例，公差/标准另核权威依据。",
    "interactive": "HTML 使用语义化按钮、label/input、键盘可操作控件和可见数值反馈；初始状态也有完整内容。脚本置于内容之后，监听 input/change 更新，避免动画循环。",
    "chart": "图表标注数据来源、时间范围、单位和缺失值。柱图基线从零起；估计与事实分开。不虚构数据。复杂出版图表用专用绘图工具生成独立产物。",
    "layout": "内容分组和阅读顺序清晰；不用固定页面宽度。文本最小约 14px，SVG 标签足够大；少量强调色，浅/深主题均可读。",
}


def _thread_id() -> str:
    session = current_session()
    return str((session.thread_id or session.conversation_id or session.turn_id) if session else "")


def _guidelines(module: str = "diagram") -> dict[str, Any]:
    if module not in _GUIDES:
        return {"ok": False, "error": "Unknown module", "modules": list(_GUIDES)}
    return {"ok": True, "module": module, "guidance": _COMMON + _GUIDES[module]}


def _show_visual(title: str, code: str, format: str = "svg") -> dict[str, Any]:
    if format not in {"svg", "html"} or not code.strip() or len(code) > 100000:
        return {"ok": False, "error": "Use svg/html with 1–100000 characters of raw code."}
    if not title.strip() or len(title) > 160 or code.lstrip().startswith("```"):
        return {"ok": False, "error": "Provide a short title and raw code without fences."}
    if format == "svg" and not code.lstrip().startswith("<svg"):
        return {"ok": False, "error": "SVG must start with <svg."}
    return create_visual(current_capability_scope(), _thread_id())


def _status(visual_id: str) -> dict[str, Any]:
    return visual_status(visual_id, current_capability_scope(), _thread_id())


def register_visual_skills(registry: SkillRegistry) -> int:
    for name, summary, handler in (
        (
            "visual_guidelines",
            "Load visual authoring guidance: module=diagram/interactive/chart/layout.",
            _guidelines,
        ),
        (
            "show_visual",
            "Display a titled SVG or interactive HTML inline. Read visual_guidelines first. Payload success is not a browser receipt.",
            _show_visual,
        ),
        (
            "visual_status",
            "Read one visual's browser receipt in the current task; do not poll repeatedly.",
            _status,
        ),
    ):
        registry.register(
            Skill(
                name=name,
                summary=summary,
                description=summary,
                affinity=["meta", "visual"],
                handler=handler,
                trusted_source=f"skill://public/{name}",
            )
        )
    return len(VISUAL_SKILL_NAMES)
