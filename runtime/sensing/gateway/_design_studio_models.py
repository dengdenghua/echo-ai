"""Request bodies and static ComfyUI catalogs for the Design Studio router.

Moved verbatim out of ``design_studio_router`` (which re-imports every name,
so ``design_studio_router.<name>`` still resolves) when its factory was split
into register groups, keeping that file within its line budget.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

_COMFY_MODEL_GROUPS = (
    "checkpoints",
    "diffusion_models",
    "loras",
    "vae",
    "controlnet",
    "text_encoders",
    "clip_vision",
    "upscale_models",
)
_CURATED_COMFY_NODES = (
    "comfyui-impact-pack",
    "comfyui-kjnodes",
    "comfyui_essentials",
    "comfyui-videohelpersuite",
    "comfyui_ipadapter_plus",
    "rgthree-comfy",
    "comfyui_controlnet_aux",
    "comfyui-advanced-controlnet",
    "comfyui-easy-use",
)


class WorkflowImport(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    workflow: dict[str, Any]
    ui: dict[str, Any] = Field(default_factory=dict)


class DesignCapabilityRequest(BaseModel):
    goal: str = Field(default="", max_length=32000)
    preferences: dict[str, Any] = Field(default_factory=dict)
    check_connection: bool = False


class WorkflowSave(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    workflow: dict[str, Any]
    ui: dict[str, Any] = Field(default_factory=dict)
    expected_revision: int = Field(default=0, ge=0)


class QueueRequest(BaseModel):
    prompt: dict[str, Any] | None = None
    workflow_id: str | None = Field(default=None, max_length=80)
    client_id: str | None = Field(default=None, max_length=120)


class CanvasSave(BaseModel):
    document: dict[str, Any]
    expected_revision: int = Field(default=0, ge=0)


class CanvasPresenceHeartbeat(BaseModel):
    client_id: str = Field(pattern=r"^[a-zA-Z0-9._:-]{8,128}$")
    display_name: str = Field(default="协作者", min_length=1, max_length=48)
    x: float | None = Field(default=None, ge=-100000, le=100000)
    y: float | None = Field(default=None, ge=-100000, le=100000)
    section: str = Field(default="canvas", pattern=r"^(home|canvas|assets|skills|comfyui)$")


class PluginNodeStatePut(BaseModel):
    plugin_id: str = Field(min_length=1, max_length=160)
    value: Any
    expected_revision: int = Field(default=0, ge=0)


class ComfyCustomNodeAction(BaseModel):
    node_id: str = Field(min_length=2, max_length=120)


class ComfyCustomNodeRollback(BaseModel):
    backup_id: str | None = Field(default=None, max_length=180)


class ComfyModelDownload(BaseModel):
    url: str = Field(min_length=12, max_length=2048)
    group: str = Field(min_length=2, max_length=80)


class ComfyModelAction(BaseModel):
    group: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=1, max_length=500)


class ComfyModelRestore(BaseModel):
    backup_id: str = Field(min_length=3, max_length=600)
