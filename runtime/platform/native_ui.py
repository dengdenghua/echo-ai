"""Versioned, inert UI documents. Actions remain ordinary conversation replies."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,47}$")]
Title = Annotated[str, Field(min_length=1, max_length=160)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class TextBlock(StrictModel):
    type: Literal["text"]
    id: Identifier
    text: Annotated[str, Field(min_length=1, max_length=8000)]


class ComparisonBlock(StrictModel):
    type: Literal["comparison"]
    id: Identifier
    title: Title
    columns: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=80)]], Field(min_length=2, max_length=6)
    ]
    rows: Annotated[
        list[
            Annotated[
                list[Annotated[str, Field(max_length=500)]], Field(min_length=2, max_length=6)
            ]
        ],
        Field(min_length=1, max_length=12),
    ]

    @model_validator(mode="after")
    def rectangular(self):
        if any(len(row) != len(self.columns) for row in self.rows):
            raise ValueError("Every row must match the column count")
        return self


class FormField(StrictModel):
    id: Identifier
    label: Title
    type: Literal["text", "textarea", "select"]
    required: bool = False
    options: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=160)]], Field(max_length=12)
    ] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_options(self):
        if self.type == "select" and not self.options:
            raise ValueError("Select fields need options")
        if self.type != "select" and self.options:
            raise ValueError("Only select fields accept options")
        if len(self.options) != len(set(self.options)):
            raise ValueError("Options must be unique")
        return self


class FormBlock(StrictModel):
    type: Literal["form"]
    id: Identifier
    title: Title
    fields: Annotated[list[FormField], Field(min_length=1, max_length=8)]

    @model_validator(mode="after")
    def unique_fields(self):
        if len({field.id for field in self.fields}) != len(self.fields):
            raise ValueError("Field ids must be unique")
        return self


class TasksBlock(StrictModel):
    type: Literal["tasks"]
    id: Identifier
    # No model-supplied progress/status: the renderer reads this thread's plan.
    title: Title


Block = Annotated[TextBlock | ComparisonBlock | FormBlock | TasksBlock, Field(discriminator="type")]


class UIDocument(StrictModel):
    version: Literal[1]
    title: Title
    blocks: Annotated[list[Block], Field(min_length=1, max_length=12)]

    @field_validator("version", mode="before")
    @classmethod
    def numeric_version(cls, value):
        if type(value) is not int:
            raise ValueError("Version must be an integer")
        return value

    @model_validator(mode="after")
    def unique_blocks(self):
        if len({block.id for block in self.blocks}) != len(self.blocks):
            raise ValueError("Block ids must be unique")
        return self


def ui_tool_schema() -> dict:
    schema = UIDocument.model_json_schema()
    definitions = schema.pop("$defs", {})
    return {
        "type": "object",
        "properties": {"document": schema},
        "required": ["document"],
        "additionalProperties": False,
        "$defs": definitions,
    }


def validate_ui(document: dict, thread_id: str) -> dict:
    if not thread_id:
        return {"ok": False, "error": "show_ui requires an active conversation"}
    try:
        if len(json.dumps(document, ensure_ascii=False)) > 60000:
            raise ValueError("UI document exceeds 60000 characters")
        parsed = UIDocument.model_validate(document)
    except (ValidationError, ValueError, TypeError, RecursionError) as exc:
        # Do not echo potentially sensitive input values in validation errors.
        detail = "Invalid UI document"
        if isinstance(exc, ValidationError):
            detail += ": " + "; ".join(
                ".".join(map(str, error["loc"])) + " " + error["type"]
                for error in exc.errors(include_input=False)[:4]
            )
        return {"ok": False, "error": detail}
    return {
        "ok": True,
        "kind": "echo.ui.v1",
        "thread_id": thread_id,
        # The document is already persisted as the tool's arguments. Keeping
        # the receipt small avoids output pruning corrupting a large UI JSON
        # and avoids sending the same document back to the model a second time.
        "version": parsed.version,
        "status": "ready",  # Validated payload, not a browser/display receipt.
    }


UI_GUIDANCE = (
    "需要用户提供多项需求、比较多个方案或查看任务计划时，用 show_ui(document=...)。"
    "document={version:1,title,blocks}；每个 block 有稳定、唯一的英文 id。"
    "text={type:'text',id,text}；comparison={type:'comparison',id,title,columns:[列名],rows:[[单元格]]}；"
    "form={type:'form',id,title,fields:[{id,label,type:'text'|'textarea'|'select',required:false,options:[]}]}；"
    "tasks={type:'tasks',id,title} 自动读取当前对话任务清单，不接受自填完成状态。"
    "最多60000字符、12个块、8个表单字段、6列12行；select 必须提供选项，其余字段不提供选项。"
    "全部文本为纯文字；不提供脚本、URL、动作或隐藏提示词。不要收集密码/API密钥。"
    "表单由用户点击后把可见字段发送为当前对话消息，收到后再继续；显示成功不等于用户提交。"
    "表单提交不替代操作权限或邀请成员等明确审批；复用现有审批流程。"
    "不要重复渲染同一份表单或在正文重复卡片全文。工具成功仅表示校验通过。"
)
