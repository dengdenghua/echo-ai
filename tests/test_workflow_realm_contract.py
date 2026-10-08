"""Workflow realm contract: introspection escapes are rejected statically.

Every script in ``_REJECTED`` must fail ``validate_script`` with
``SCRIPT_PARSE``; nothing here is executed. ``_ACCEPTED`` keeps the
ordinary plain-data vocabulary working. The worker-env tests pin that the
worker subprocess does not inherit provider credentials.
"""

from __future__ import annotations

import pytest

from runtime.execution.workflow.engine import worker_env
from runtime.execution.workflow.realm import validate_script
from runtime.execution.workflow.types import WorkflowError

_REJECTED: dict[str, str] = {
    "coroutine_send_to_loop": 'c = agent("x")\nf = c.send(None)\nreturn f.get_loop()',
    "coroutine_send_alias": 'send = agent("x").send\nreturn send(None)',
    "future_loop": "return args.get_loop()",
    "loop_process": 'return args.subprocess_exec(None, "unused")',
    "coroutine_pattern": 'c = agent("x")\nmatch c:\n    case str(send=f):\n        return f(None)',
    "unknown_public_method": "return args.arbitrary_method()",
    "coroutine_frame": 'c = agent("x")\nf = c.cr_frame\nreturn 1',
    "coroutine_code": 'c = agent("x")\nreturn c.cr_code',
    "coroutine_await": 'c = agent("x")\nreturn c.cr_await',
    "generator_frame": "g = (i for i in [1])\nreturn g.gi_frame",
    "generator_code": "g = (i for i in [1])\nreturn g.gi_code",
    "async_gen_frame": "x = 1\nreturn x.ag_frame",
    "frame_globals": "x = 1\nreturn x.f_globals",
    "frame_locals": "x = 1\nreturn x.f_locals",
    "frame_back": "x = 1\nreturn x.f_back",
    "frame_builtins": "x = 1\nreturn x.f_builtins",
    "traceback_frame": "try:\n    raise ValueError()\nexcept ValueError as e:\n    t = e.tb_frame\nreturn 1",
    "traceback_next": "x = 1\nreturn x.tb_next",
    "code_bytes": "f = lambda: 1\nreturn f.co_code",
    "legacy_func_globals": "f = lambda: 1\nreturn f.func_globals",
    "mro_walk": "return str.mro()",
    "private_attr": "return agent._loop",
    "dunder_attr": "return args.__class__",
    "format_field_access": 'return "{0.x}".format(args)',
    "format_map_field_access": 'return "{a.x}".format_map({"a": args})',
    "with_traceback": "e = ValueError()\nreturn e.with_traceback(None)",
    "dunder_subscript": 'd = {}\nreturn d["__builtins__"]',
    "dunder_name": "return __builtins__",
    "wrapper_name": "return __workflow_main",
    "getattr_name": 'return getattr(args, "x")',
    "vars_name": "return vars()",
    "globals_name": "return globals()",
    "locals_name": "return locals()",
    "dir_name": "return dir(args)",
    "type_name": "return type(args)",
    "object_name": "return object",
    "eval_name": 'return eval("1")',
    "open_name": 'return open("x")',
    "import_stmt": "import os\nreturn 1",
    "class_pattern_attr": "match args:\n    case str(cr_frame=f):\n        return 1\nreturn 0",
    "class_pattern_dunder": "match args:\n    case str(__class__=c):\n        return 1\nreturn 0",
    "fstring_attr": 'c = agent("x")\nreturn f"{c.cr_frame}"',
}

_ACCEPTED: dict[str, str] = {
    "data_updates": 'd = dict.fromkeys(["x"], 1)\nd.update({"y": 2})\nreturn list(d.values())',
    "vocabulary": (
        'phase("research")\n'
        'log("starting")\n'
        'a = await agent("研究 A 主题", {"label": "A"})\n'
        "results = await parallel([\n"
        '    lambda: agent("p1", {"label": "p1"}),\n'
        '    lambda: agent("p2", {"label": "p2"}),\n'
        "])\n"
        "pipe = await pipeline([1, 2, 3], lambda v, item, i: v * 2)\n"
        'return {"a": a, "parallel": results, "pipeline": pipe, "arg0": args["x"]}'
    ),
    "plain_data_methods": (
        "out = []\n"
        "for k, v in args.items():\n"
        "    out.append(str(k).strip().upper())\n"
        'return ", ".join(sorted(out))'
    ),
    "string_building": 'name = "x"\nreturn "hello " + name + " %s" % 1 + f" {len(name)}"',
    "error_handling": (
        "try:\n"
        '    raise ValueError("bad")\n'
        "except ValueError as e:\n"
        "    return str(e) + str(e.args)\n"
    ),
    "throwaway_name": "total = 0\nfor _ in range(3):\n    total += 1\nreturn total",
    "plain_subscript": 'd = {"__x": 1, "k": 2}\nreturn d["k"]',
    "value_pattern": 'match args:\n    case {"k": v}:\n        return v\nreturn None',
}


@pytest.mark.parametrize("script", list(_REJECTED.values()), ids=list(_REJECTED))
def test_introspection_escapes_are_rejected(script: str) -> None:
    with pytest.raises(WorkflowError) as excinfo:
        validate_script(script)
    assert excinfo.value.code == "SCRIPT_PARSE"


@pytest.mark.parametrize("script", list(_ACCEPTED.values()), ids=list(_ACCEPTED))
def test_plain_data_scripts_still_validate(script: str) -> None:
    validate_script(script)


def test_worker_env_drops_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-real")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    monkeypatch.setenv("SOME_UNRELATED_SETTING", "value")
    monkeypatch.setenv("PATH", "C:/bin")
    env = worker_env()
    assert "ANTHROPIC_API_KEY" not in env
    assert "OPENAI_API_KEY" not in env
    # Allowlist, not denylist: unknown names are not inherited either.
    assert "SOME_UNRELATED_SETTING" not in env
    assert env["PATH"] == "C:/bin"


def test_worker_env_pins_utf8_stdio() -> None:
    env = worker_env()
    assert env["PYTHONIOENCODING"] == "utf-8"
    assert env["PYTHONUTF8"] == "1"
