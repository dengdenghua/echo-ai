"""One server-owned design selection contract for previews and all engines.

Preferences contain identifiers only. They never grant permissions, enable a
plugin, or supply instruction paths. Re-resolve them against the live registry
on every turn so a stale UI cannot revive disabled capabilities.
"""

from __future__ import annotations

import re
from typing import Any

DESIGN_FOUNDATIONS = """<design-foundations>
理解用户目标、受众、输出格式和参考材料。信息足够就开始制作，保留用户现有作品。
把布局层级、字体、配色、留白、对比度、可访问性和跨尺寸适配落实到产物。
使用本轮匹配的专项技能；只读取当前任务需要的说明，不批量读取整个技能库。
调用生成或编辑工具前检查其连接、授权、模型和输入要求。缺少必要能力时明确指出
缺失项及配置入口，保留草稿与已有产物；不要自动安装插件、购买服务或声称已经执行。
必须实际制作并检查产物：网页打开预览并验证关键交互；图片检查尺寸、文字和构图；
视频检查时长、画幅与导出；文件确认存在且可打开。区分已验证与尚未验证的部分。
失败时依据工具错误修复或使用已授权的替代工具，不要重复相同失败调用或只描述计划。
</design-foundations>"""

# Ordered, bounded task packs. These are registry identifiers, not filesystem paths.
DESIGN_PACKS = (
    (
        "web",
        "网页与界面",
        r"网页|网站|界面|交互|前端|落地页|\b(?:ui|ux|website|webpage|landing page|frontend)\b",
        ("frontend-ui-engineering", "webapp-building"),
    ),
    (
        "slides",
        "演示文稿",
        r"演示|幻灯|路演|\b(?:pptx?|slides?|presentation)\b",
        ("presentations",),
    ),
    (
        "video",
        "视频制作",
        r"视频|短片|剪辑|漫剧|分镜|\b(?:video|storyboard|film)\b",
        ("creative-storyboard-assets",),
    ),
    (
        "image",
        "图片与视觉",
        r"海报|图片|插画|主视觉|商品图|电商|画一张|生图|\b(?:image|poster|illustration)\b",
        ("creative-visual-direction",),
    ),
    ("editing", "视频剪辑", r"剪辑|时间线|加字幕|\bedit.*video\b", ("creative-video-editor",)),
    (
        "commerce",
        "商品图片",
        r"商品图|电商|产品主图|\bproduct image\b",
        ("creative-ecommerce-images",),
    ),
    ("comfyui", "ComfyUI 工作流", r"\bcomfyui\b", ("creative-comfyui-workflow",)),
)
DESIGN_SKILLS = tuple(dict.fromkeys(name for _, _, _, names in DESIGN_PACKS for name in names))
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


def design_context(context: Any) -> dict[str, Any]:
    if not isinstance(context, dict):
        return {}
    nested = context.get("metadata")
    return {**(nested if isinstance(nested, dict) else {}), **context}


def is_design_context(context: Any) -> bool:
    ctx = design_context(context)
    return ctx.get("agent_mode") == "uxui" or ctx.get("capability_mode") == "design"


def _ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(x for x in value if isinstance(x, str) and _ID.fullmatch(x)))[:12]


def design_preferences(value: Any) -> dict[str, Any]:
    value = value if isinstance(value, dict) else {}
    return {
        "mode": "manual" if value.get("mode") == "manual" else "auto",
        "skills": _ids(value.get("skills")),
        "plugins": _ids(value.get("plugins")),
        **{
            key: value[key]
            for key in ("image_model", "video_model")
            if isinstance(value.get(key), str)
            and 0 < len(value[key]) <= 128
            and not any(ord(char) < 32 for char in value[key])
        },
    }


def skill_available(registry: Any, name: str, agent: Any = None) -> bool:
    try:
        return bool(
            registry.has(name)
            and registry.is_enabled(name)
            and (agent is None or agent.skill_policy().allows(name))
        )
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


def plugin_skill_names(registry: Any, plugin_id: str, agent: Any = None) -> list[str]:
    try:
        names = registry.all_names()
    except (AttributeError, TypeError):
        return []
    result = []
    for name in names:
        if not skill_available(registry, name, agent):
            continue
        source = str(getattr(registry.get(name), "trusted_source", ""))
        if source == f"plugin://{plugin_id}" or source.startswith(f"plugin://{plugin_id}/"):
            result.append(name)
    return result


def resolve_design_plan(
    goal: str, *, context: Any, registry: Any, agent: Any = None
) -> dict[str, Any]:
    prefs = design_preferences(design_context(context).get("design_capabilities"))
    matched = [
        (key, label, names)
        for key, label, pattern, names in DESIGN_PACKS
        if re.search(pattern, goal, re.IGNORECASE)
    ]
    inferred = list(dict.fromkeys(name for _, _, names in matched for name in names))[:4]
    requested = prefs["skills"] if prefs["mode"] == "manual" else inferred
    # Explicit user skill selection always precedes inference. The parser is
    # shared with ordinary turns; do not extract paths from the browser.
    from runtime.core.cerebrum.input_mentions import parse_input_mentions

    mentions = parse_input_mentions(goal)
    explicit = list(mentions.skills)
    for match in re.finditer(r"(?<![\w-])\$([A-Za-z0-9][A-Za-z0-9_-]{0,127})", goal):
        if match.group(1) not in explicit:
            explicit.append(match.group(1))
    requested = list(dict.fromkeys([*explicit[:8], *requested]))[:12]
    selected = [name for name in requested if skill_available(registry, name, agent)]
    blockers = [
        f"技能 {name} 未启用、未安装或当前角色无权使用"
        for name in requested
        if name not in selected and (name in explicit or prefs["mode"] == "manual")
    ]
    warnings = [
        f"专项技能 {name} 不可用，将使用基础设计规范"
        for name in requested
        if name not in selected and name not in explicit and prefs["mode"] == "auto"
    ]
    plugins = list(dict.fromkeys([*mentions.plugins, *prefs["plugins"]]))[:12]
    from runtime.execution.suckers.media_gateway import model_catalog

    catalog = model_catalog()
    for kind in ("image", "video"):
        chosen = prefs.get(f"{kind}_model")
        if chosen and (chosen not in catalog[kind]["models"] or not catalog[kind]["available"]):
            blockers.append(
                f"所选{'图片' if kind == 'image' else '视频'}模型不可用，请重新选择或检查生成服务配置"
            )
    advice_only = bool(
        re.search(r"^\s*(?:如何|怎么|为什么|介绍|解释|what\b|how\b|why\b)", goal, re.I)
    )
    # Only select a plugin automatically when the task calls for its specific
    # workflow. Merely entering Design must not activate every media plugin.
    if (
        prefs["mode"] == "auto"
        and not advice_only
        and any(key == "comfyui" for key, _, _ in matched)
    ):
        plugins = list(dict.fromkeys([*plugins, "comfyui_bridge"]))
    if (
        prefs["mode"] == "auto"
        and not advice_only
        and re.search(r"剪辑|时间线|加字幕|\bedit.*video\b", goal, re.I)
    ):
        plugins = list(dict.fromkeys([*plugins, "clip_studio"]))
    tools: list[str] = []
    for plugin in plugins:
        actions = plugin_skill_names(registry, plugin, agent)
        if not actions:
            blockers.append(f"插件 {plugin} 没有当前角色可用的工具，请安装、启用或检查权限")
        tools.extend(actions)
    # Generation is a concrete capability requirement, unlike design advice.
    generation = None
    if re.search(r"生成视频|生视频|图生视频|\b(?:generate|create)\s+(?:a\s+)?video\b", goal, re.I):
        generation = "generate_video"
    elif re.search(
        r"生成图片|生成一张|画一张|生图|\b(?:generate|draw)\s+(?:an?\s+)?image\b", goal, re.I
    ):
        generation = "generate_image"
    if generation and not advice_only:
        if skill_available(registry, generation, agent):
            tools.append(generation)
            # Check only our own known adapter configuration, never execute a
            # registry handler or a generation request during preflight.
            handler = getattr(registry.get(generation), "handler", None)
            if getattr(handler, "__module__", "") == "runtime.execution.suckers.kimi_compat_skills":
                from runtime.execution.suckers.kimi_compat_skills import (
                    _bundled_media_configured,
                    _openai_media_config,
                )

                configured = _bundled_media_configured() or (
                    generation == "generate_image" and bool(_openai_media_config()[1])
                )
                from runtime.execution.suckers import media_gateway

                if media_gateway.selected():
                    error = media_gateway.configuration_error(
                        "image" if generation == "generate_image" else "video"
                    )
                    configured = not error
                    if error:
                        blockers.append(error)
                if not configured and "comfyui_bridge" not in plugins:
                    blockers.append(
                        "生成服务尚未配置凭据，请先连接图片/视频服务，或选择本机 ComfyUI"
                    )
        elif not any(name.startswith("comfyui_bridge.") for name in tools):
            blockers.append("缺少可用的图片/视频生成工具，请先连接生成服务")
    return {
        "mode": prefs["mode"],
        "preferences": prefs,
        "foundations": "布局、字体、配色、可访问性与结果检查",
        "tasks": [label for _, label, _ in matched],
        "skills": selected,
        "plugins": plugins,
        "tools": list(dict.fromkeys(tools)),
        "blockers": blockers,
        "warnings": warnings,
        "ready": not blockers,
        "available_skills": [
            {"id": name, "available": skill_available(registry, name, agent)}
            for name in DESIGN_SKILLS
        ],
    }


def design_priority(goal: str, context: Any, registry: Any) -> list[str]:
    if not is_design_context(context):
        return []
    plan = resolve_design_plan(goal, context=context, registry=registry)
    return list(dict.fromkeys([*plan["skills"], *plan["tools"]]))


def design_instructions(
    goal: str,
    *,
    context: Any,
    registry: Any,
    agent: Any = None,
    goal_skills_loaded: bool = False,
) -> str:
    if not is_design_context(context):
        return ""
    plan = resolve_design_plan(goal, context=context, registry=registry, agent=agent)
    if plan["blockers"]:
        raise ValueError("设计能力检查未通过：" + "；".join(plan["blockers"]))
    parts = [
        DESIGN_FOUNDATIONS,
        "本轮设计技能（按优先级）：" + ("、".join(plan["skills"]) or "基础设计规范"),
        "本轮绑定工具：" + ("、".join(plan["tools"]) or "按具体操作使用当前工具目录"),
    ]
    for kind in ("image", "video"):
        chosen = plan["preferences"].get(f"{kind}_model")
        if chosen:
            parts.append(
                f"用户指定 {kind} 生成模型：{chosen}；调用 generate_{kind} 时使用该 model，不得擅自替换。"
            )
    if plan["warnings"]:
        parts.append("；".join(plan["warnings"]))
    # Automatic matches advertise capabilities; their bodies are loaded through
    # the skill tools when needed. An inferred keyword is not an explicit request.
    if plan["skills"]:
        parts.append("按当前操作需要调用上述技能获取专项说明，不要预读全部技能。")
    if agent is not None and plan["skills"]:
        from runtime.core.cerebrum.input_mentions import parse_input_mentions
        from runtime.execution.tool_engine.role_instructions import (
            resolve_explicit_skill_instructions,
        )

        explicit = set(parse_input_mentions(goal).skills)
        explicit.update(re.findall(r"(?<![\w-])\$([A-Za-z0-9][A-Za-z0-9_-]{0,127})", goal))
        manual = set(plan["preferences"]["skills"]) if plan["mode"] == "manual" else set()
        eager = [
            name
            for name in plan["skills"]
            if (name in manual or name in explicit)
            and not (goal_skills_loaded and name in explicit)
        ]
        # Explicit goal skills are assembled once by the role composer. Manual
        # picker selections retain eager loading through the same trusted resolver.
        body = resolve_explicit_skill_instructions(
            " ".join(f"@skill:{name}" for name in eager),
            registry=registry,
            agent=agent,
        )
        body = body.replace("The user explicitly selected", "The design task selected")
        if body:
            parts.append(body[:24_000])
    return "\n\n".join(parts)
