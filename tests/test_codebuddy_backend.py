"""Official protocol fixtures and real child-process lifecycle, without cloud calls."""

import asyncio
import json
import sys
from types import SimpleNamespace

import pytest

from runtime.execution import codebuddy_backend as backend
from runtime.execution.codebuddy_events import CodeBuddyError, CodeBuddyEvents
from runtime.execution.engines import (
    CapabilityRequest,
    EngineId,
    EngineSelectionError,
    ExecutionPhase,
    select_execution_route,
)
from runtime.execution.host_mcp_connection import HostMCPConnection


def test_tool_preview_unwraps_nested_mcp_content_before_truncating():
    reducer = CodeBuddyEvents()
    reducer.tools["t"] = "probe"
    output = [
        {
            "type": "text",
            "text": json.dumps(
                [
                    {
                        "type": "text",
                        "text": json.dumps({"stdout": "", "stderr": "文件不存在\n下一行"}),
                    }
                ]
            ),
        }
    ]
    events = reducer.consume(
        {
            "type": "user",
            "message": {
                "content": [{"type": "tool_result", "tool_use_id": "t", "content": output}]
            },
        }
    )
    assert events[0]["output_preview"] == "文件不存在\n下一行"


def assistant(*content, identity="msg1"):
    return {"type": "assistant", "message": {"id": identity, "content": list(content)}}


@pytest.mark.parametrize(
    "payload",
    [
        {"success": False, "status": "artifact_contract_rejected", "error": "host task missing"},
        {"isError": True, "content": [{"type": "text", "text": "denied"}]},
    ],
)
def test_nested_mcp_failure_is_not_reported_as_completed(payload):
    reducer = CodeBuddyEvents()
    reducer.tools["t"] = "call_agent"
    events = reducer.consume(
        {
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "t",
                        "content": [{"type": "text", "text": json.dumps(payload)}],
                    }
                ]
            },
        }
    )
    assert events[0]["success"] is False
    assert events[0]["status"] == "error"


def test_delegated_preview_preserves_continuation_receipt():
    from runtime.execution.codebuddy_events import tool_result_preview

    receipt = {
        "agent_id": "build-agent",
        "success": True,
        "session_id": "session-a",
        "output": "verified " * 500,
    }
    preview = tool_result_preview([{"type": "text", "text": json.dumps(receipt)}])
    parsed = json.loads(preview)
    assert parsed["session_id"] == "session-a"
    assert parsed["success"] is True
    assert len(parsed["output"]) == 1200


def test_deltas_and_snapshot_are_not_duplicated_and_thoughts_stay_private():
    reducer = CodeBuddyEvents(model="hy3")
    delta = {
        "type": "stream_event",
        "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}},
    }
    events = reducer.consume(delta)
    message = assistant(
        {"type": "thinking", "thinking": "private"}, {"type": "text", "text": "Hello world"}
    )
    events += reducer.consume(message)
    assert reducer.consume(message) == []
    events += reducer.consume(
        {"type": "result", "subtype": "success", "usage": {"input_tokens": 8}}
    )
    assert "".join(e.get("delta", "") for e in events) == "Hello world"
    assert events[-1]["completion_receipt"]["engine"] == "codebuddy"
    assert events[-1]["completion_receipt"]["model"] == "hy3"


def test_official_block_envelopes_share_message_id_without_rewriting_text():
    reducer = CodeBuddyEvents(tool_names={"mcp__echo__echo_probe": "probe"})
    packets = [
        assistant({"type": "thinking", "thinking": "private"}),
        assistant({"type": "text", "text": "Checking."}),
        assistant({"type": "tool_use", "id": "t", "name": "mcp__echo__echo_probe", "input": {}}),
        {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t"}]}},
        assistant({"type": "text", "text": "Verified."}),
    ]
    events = []
    for index, packet in enumerate(packets):
        packet["uuid"] = f"block-{index}"
        events.extend(reducer.consume(packet))
        assert reducer.consume(packet) == []
    events.extend(reducer.consume({"type": "result", "subtype": "success"}))
    assert reducer.text == "Checking.Verified."
    assert [event["type"] for event in events] == [
        "text_delta",
        "tool_start",
        "tool_end",
        "text_delta",
        "react_completed",
    ]


def test_distinct_blocks_with_identical_text_are_not_discarded():
    reducer = CodeBuddyEvents()
    for identity in ("block-1", "block-2"):
        packet = assistant({"type": "text", "text": "OK"})
        packet["uuid"] = identity
        reducer.consume(packet)
    assert reducer.text == "OKOK"


def test_interleaved_stream_messages_match_their_own_final_snapshots():
    reducer = CodeBuddyEvents()
    for identity, text in (("first", "First"), ("second", "Second")):
        reducer.consume(
            {
                "type": "stream_event",
                "_messageId": identity,
                "event": {
                    "type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": text},
                },
            }
        )
    for identity, text in (("first", "First"), ("second", "Second")):
        assert (
            reducer.consume(
                {
                    **assistant({"type": "text", "text": text}, identity=identity),
                    "uuid": "snapshot-" + identity,
                    "_messageId": identity,
                }
            )
            == []
        )
    assert reducer.text == "FirstSecond"
    assert not reducer.partial_by_message


def test_identified_stream_still_rejects_a_genuinely_rewritten_snapshot():
    reducer = CodeBuddyEvents()
    reducer.consume(
        {
            "type": "stream_event",
            "_messageId": "first",
            "event": {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "Original"},
            },
        }
    )
    with pytest.raises(CodeBuddyError, match="流式回答"):
        reducer.consume(assistant({"type": "text", "text": "Rewritten"}, identity="first"))


def test_rewriting_same_text_block_still_fails():
    reducer = CodeBuddyEvents()
    reducer.consume({**assistant({"type": "text", "text": "Original"}), "uuid": "same-block"})
    with pytest.raises(CodeBuddyError, match="快照不一致"):
        reducer.consume({**assistant({"type": "text", "text": "Rewritten"}), "uuid": "same-block"})


def test_nontext_block_does_not_shrink_legacy_text_snapshot():
    reducer = CodeBuddyEvents(tool_names={"mcp__echo__echo_probe": "probe"})
    reducer.consume(assistant({"type": "text", "text": "Checking."}))
    result = reducer.consume(
        assistant({"type": "tool_use", "id": "t", "name": "mcp__echo__echo_probe"})
    )
    assert result[0]["type"] == "tool_start"
    assert reducer.text == "Checking."


def test_tool_pairs_map_to_the_host_catalog_and_refusals_are_failures():
    reducer = CodeBuddyEvents(tool_names={"mcp__echo__echo_read_file": "read_file"})
    tool = {"type": "tool_use", "id": "t1", "name": "mcp__echo__echo_read_file", "input": {}}
    assert reducer.consume(assistant(tool))[0]["tool_name"] == "read_file"
    end = reducer.consume(
        {
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "t1",
                        "is_error": True,
                        "content": "denied",
                    }
                ]
            },
        }
    )
    assert end[0]["tool_call_id"] == "t1"
    assert end[0]["success"] is False
    assert end[0]["status"] == "error"


@pytest.mark.parametrize("native", ["Bash", "Edit", "Agent", "mcp__other__echo_read_file"])
def test_unadvertised_tools_cannot_be_reported_as_authorized(native):
    reducer = CodeBuddyEvents()
    with pytest.raises(CodeBuddyError, match="未授权"):
        reducer.consume(assistant({"type": "tool_use", "id": "t", "name": native}))


def test_official_cli_mcp_normalization_preserves_the_authorized_blender_skill():
    reducer = CodeBuddyEvents(
        tool_names={
            "mcp__echo__blender-control__blender-control": "blender-control__blender-control",
        }
    )
    events = reducer.consume(
        assistant(
            {
                "type": "tool_use",
                "id": "blender-1",
                "name": "mcp__echo__blender_control__blender_control",
                "input": {},
            }
        )
    )
    assert events[0]["tool_name"] == "blender-control__blender-control"
    assert reducer.tool_names == {
        "mcp__echo__blender-control__blender-control": "blender-control__blender-control",
    }
    with pytest.raises(CodeBuddyError, match="未授权"):
        reducer.consume(
            assistant({"type": "tool_use", "id": "unlisted", "name": "mcp__echo__other_plugin"})
        )


def test_ambiguous_cli_name_normalization_is_rejected_before_execution():
    with pytest.raises(CodeBuddyError, match="冲突"):
        CodeBuddyEvents(tool_names={"mcp__echo__a-b": "first", "mcp__echo__a_b": "second"})


@pytest.mark.parametrize(
    "result",
    [
        {"type": "result", "subtype": "error_during_execution", "is_error": True},
        {"type": "result", "subtype": "error_max_turns"},
        {"type": "result", "subtype": "success"},
    ],
)
def test_errors_limits_and_empty_responses_never_complete(result):
    with pytest.raises(CodeBuddyError):
        CodeBuddyEvents().consume(result)


def test_unfinished_tool_and_disconnected_host_cannot_complete():
    reducer = CodeBuddyEvents(tool_names={"mcp__echo__echo_x": "x"})
    reducer.consume(assistant({"type": "tool_use", "id": "t", "name": "mcp__echo__echo_x"}))
    with pytest.raises(CodeBuddyError, match="未完成"):
        reducer.consume({"type": "result", "subtype": "success", "result": "done"})
    with pytest.raises(CodeBuddyError, match="连接"):
        CodeBuddyEvents().consume(
            {
                "type": "system",
                "subtype": "init",
                "mcp_servers": [{"name": "echo", "status": "failed"}],
            }
        )


def test_hosted_tenants_cannot_use_a_machine_account(monkeypatch):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "cloud")
    assert backend.inspect_readiness()["reason_code"] == "local_only"
    assert backend.model_catalog() == []


def test_model_ownership_is_explicit(tmp_path, monkeypatch):
    assert backend.resolve_model("auto") == "auto"
    assert backend.resolve_model("codebuddy/hy3") == "hy3"
    with pytest.raises(CodeBuddyError):
        backend.resolve_model("opencode-zen/big-pickle")


def test_official_catalog_excludes_custom_models_and_never_falls_back(monkeypatch):
    monkeypatch.setattr(backend, "inspect_readiness", lambda: {"available": True})
    monkeypatch.setattr(backend, "executable", lambda: sys.executable)
    monkeypatch.setattr(
        backend, "_models", lambda *args: ("deepseek-v4.1-flash", "custom-local:claude")
    )
    assert backend.model_catalog() == ["deepseek-v4.1-flash"]
    with pytest.raises(CodeBuddyError, match="官方积分通道"):
        backend.resolve_model("codebuddy/custom-local:claude")


@pytest.mark.parametrize("failure", ["timeout", "empty", "nonzero"])
def test_model_discovery_retries_transient_failures_without_caching_empty(monkeypatch, failure):
    backend._models.cache_clear()
    monkeypatch.setattr(backend, "inspect_readiness", lambda: {"available": True})
    monkeypatch.setattr(backend, "executable", lambda: sys.executable)
    monkeypatch.setattr(backend, "command", lambda binary: [binary])
    calls = []

    def discover(*args, **kwargs):
        calls.append(args)
        if len(calls) == 1:
            if failure == "timeout":
                raise backend.subprocess.TimeoutExpired("codebuddy --help", 10)
            return SimpleNamespace(
                stdout="" if failure == "empty" else "Currently supported: (hy3)",
                returncode=1 if failure == "nonzero" else 0,
            )
        return SimpleNamespace(stdout="Currently supported: (hy3, glm-5.3)", returncode=0)

    monkeypatch.setattr(backend.subprocess, "run", discover)
    try:
        assert backend.model_catalog() == []
        assert backend.model_catalog() == ["hy3", "glm-5.3"]
        assert backend.model_catalog() == ["hy3", "glm-5.3"]
        assert len(calls) == 2
    finally:
        backend._models.cache_clear()


@pytest.mark.parametrize(
    "detail,expected",
    [
        ("503 No available channel for model hy3", "无法调用所选模型"),
        ("401 Unauthorized", "账号验证失败"),
        ("insufficient credit balance", "额度不足"),
        ("429 rate limit", "过于频繁"),
    ],
)
def test_provider_failure_is_actionable_without_echoing_secrets(detail, expected):
    with pytest.raises(CodeBuddyError, match=expected) as error:
        CodeBuddyEvents().consume(
            {
                "type": "result",
                "is_error": True,
                "subtype": "error_during_execution",
                "errors": [detail + " https://private.example/key=secret"],
            }
        )
    assert "private.example" not in str(error.value)
    assert "secret" not in str(error.value)


@pytest.mark.parametrize(
    "scheduler,driver",
    [
        ({}, "codebuddy_cli"),
        ({"project_command": True}, "project_os"),
        ({"group_fanout": True}, "group_fanout"),
        ({"topology_id": "t"}, "swarm_mesh"),
    ],
)
def test_engine_is_bound_across_host_schedulers_and_continuations(scheduler, driver):
    route = select_execution_route(requested_engine=EngineId.CODEBUDDY, **scheduler)
    assert route.driver_for(ExecutionPhase.PRIMARY) == driver
    assert route.driver_for(ExecutionPhase.REPAIR) == "codebuddy_cli"
    with pytest.raises(EngineSelectionError):
        select_execution_route(
            requested_engine=EngineId.CODEBUDDY, required=CapabilityRequest(vision=True)
        )


def fake_cli(tmp_path, monkeypatch, source):
    script = tmp_path / "fake_cli.py"
    script.write_text(source, encoding="utf-8")
    monkeypatch.setattr(backend, "command", lambda _: [sys.executable, str(script)])
    monkeypatch.setattr(backend, "executable", lambda: sys.executable)
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")


def test_real_child_receives_only_host_tools_and_no_secret_arguments(tmp_path, monkeypatch):
    fake_cli(
        tmp_path,
        monkeypatch,
        """
import json,sys,pathlib
args=sys.argv[1:]
assert args[args.index('--effort')+1] == 'high'
assert args[args.index('--autocompact')+1] == '300000'
assert args[args.index('--tools')+1] == 'NoDefer(mcp__echo__echo_probe)'
assert args[args.index('--permission-mode')+1] == 'dontAsk'
assert args[args.index('--setting-sources')+1] == 'local'
assert '--strict-mcp-config' in args
assert '--no-session-persistence' in args
assert 'secret-bearer' not in ' '.join(args)
config=json.loads(pathlib.Path(args[args.index('--mcp-config')+1]).read_text())
assert config['mcpServers']['echo']['headers']['Authorization'] == 'Bearer secret-bearer'
assert sys.stdin.read() == 'trusted prompt'
print(json.dumps({'type':'assistant','message':{'id':'a','content':[{'type':'text','text':'OK'}]}}))
print(json.dumps({'type':'result','subtype':'success','result':'OK'}))
""",
    )

    async def run():
        return [
            event
            async for event in backend.stream_prompt(
                reasoning_effort="high",
                autocompact=300000,
                text="trusted prompt",
                system="role",
                model="auto",
                interrupted=lambda: False,
                host_mcp=HostMCPConnection("http://127.0.0.1:1234/mcp", "secret-bearer"),
                tool_names={"mcp__echo__echo_probe": "probe"},
            )
        ]

    events = asyncio.run(run())
    assert events[-1]["type"] == "react_completed"
    assert events[0]["delta"] == "OK"


@pytest.mark.parametrize("tail", ["", "print('not-json')", "sys.exit(7)"])
def test_exit_or_malformed_output_cannot_report_success(tmp_path, monkeypatch, tail):
    fake_cli(tmp_path, monkeypatch, "import sys\nsys.stdin.read()\n" + tail)

    async def run():
        return [
            event
            async for event in backend.stream_prompt(
                text="p", system="s", model="auto", interrupted=lambda: False
            )
        ]

    with pytest.raises(CodeBuddyError):
        asyncio.run(run())


def test_cancellation_reaps_the_official_process(tmp_path, monkeypatch):
    fake_cli(
        tmp_path,
        monkeypatch,
        """
import json,sys,time
sys.stdin.read()
print(json.dumps({'type':'assistant','message':{'content':[{'type':'text','text':'started'}]}}),flush=True)
time.sleep(60)
""",
    )
    children = []
    spawn = asyncio.create_subprocess_exec

    async def record(*args, **kwargs):
        process = await spawn(*args, **kwargs)
        children.append(process)
        return process

    monkeypatch.setattr(backend.asyncio, "create_subprocess_exec", record)

    async def run():
        state = {"stopped": False}
        async for _event in backend.stream_prompt(
            text="p", system="s", model="auto", interrupted=lambda: state["stopped"]
        ):
            state["stopped"] = True

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run())
    assert children[0].returncode is not None


def test_shutdown_metadata_is_ignored_but_second_answer_is_not():
    reducer = CodeBuddyEvents()
    reducer.consume({"type": "result", "subtype": "success", "result": "OK"})
    assert reducer.consume({"type": "system", "subtype": "init"}) == []
    with pytest.raises(CodeBuddyError):
        reducer.consume(assistant({"type": "text", "text": "another answer"}))


def test_official_environment_does_not_inherit_third_party_settings(tmp_path, monkeypatch):

    monkeypatch.setenv("CODEBUDDY_CONFIG_DIR", str(tmp_path))
    monkeypatch.setenv("CODEBUDDY_API_KEY", "shell-secret")
    monkeypatch.setenv("CODEBUDDY_BASE_URL", "https://third-party.example")
    (tmp_path / "settings.json").write_text(
        json.dumps(
            {
                "env": {
                    "CODEBUDDY_API_KEY": "local-test-secret",
                    "CODEBUDDY_MODEL": "test-model",
                    "NODE_OPTIONS": "--require=untrusted.js",
                    "ARBITRARY_COMMAND": "untrusted",
                },
                "hooks": {"SessionStart": "untrusted"},
            }
        )
    )
    env = backend.child_environment()
    assert "CODEBUDDY_API_KEY" not in env
    assert "CODEBUDDY_MODEL" not in env
    assert "CODEBUDDY_BASE_URL" not in env
    assert env["CODEBUDDY_INTERNET_ENVIRONMENT"] == "internal"
    assert "NODE_OPTIONS" not in env
    assert "ARBITRARY_COMMAND" not in env


def test_catalog_refreshes_when_official_login_changes(monkeypatch, tmp_path):
    settings = tmp_path / ".codebuddy/settings.json"
    monkeypatch.setattr(backend.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(backend, "executable", lambda: __file__)
    monkeypatch.setattr(backend, "command", lambda _: [__file__])
    calls = []
    def discover(*args, **kwargs):
        calls.append(1)
        assert kwargs["env"]["CODEBUDDY_INTERNET_ENVIRONMENT"] == "internal"
        return SimpleNamespace(stdout="Currently supported: (hy4std)" if settings.exists() else "Currently supported: (hy4-preview)", returncode=0)
    monkeypatch.setattr(backend.subprocess, "run", discover)
    backend._models.cache_clear()
    try:
        assert backend.model_catalog() == ["hy4-preview"]
        settings.parent.mkdir()
        settings.write_text("{}")
        assert backend.model_catalog() == ["hy4std"]
        assert backend.model_catalog() == ["hy4std"]
        assert len(calls) == 2
    finally:
        backend._models.cache_clear()


def test_real_compacting_status_is_recorded_without_double_counting():
    reducer = CodeBuddyEvents(model="glm-5.3")
    for status in ("compacting", "compacting", None, "compacting", None):
        assert reducer.consume({"type": "system", "subtype": "status", "status": status}) == []
    events = reducer.consume({"type": "result", "subtype": "success", "result": "DONE", "usage": {}})
    assert events[-1]["completion_receipt"]["compaction_count"] == 2
