from runtime.execution.subagents import opencode_progress as progress


def test_member_events_keep_role_call_and_failure_identity(monkeypatch):
    queued = []
    emitted = []
    monkeypatch.setattr(progress, "_emit_sub_tool_event", lambda kind, **kw: queued.append((kind, kw)))
    callback = progress.progress_emitter("aoi", {"event_emitter": emitted.append})
    callback({"type": "tool_start", "tool_name": "search", "tool_call_id": "call-1", "input_preview": "sleep"})
    callback({"type": "tool_end", "tool_name": "search", "tool_call_id": "call-1", "success": False, "output_preview": "failed"})
    assert [event["type"] for event in emitted] == ["sub_tool_start", "sub_tool_end"]
    assert all(event["agent_id"] == "aoi" and event["tool_call_id"] == "call-1" for event in emitted)
    assert emitted[-1]["status"] == "failed"
    assert queued[-1][1]["is_error"] is True


def test_text_progress_uses_same_child_channel(monkeypatch):
    calls = []
    monkeypatch.setattr(progress, "_emit_sub_text_delta", lambda *args, **kw: calls.append(args))
    progress.progress_emitter("aoi", {})({"type": "text_delta", "delta": "正在检查"})
    assert calls == [("aoi", 0, "正在检查")]


def test_interleaved_tools_preserve_parsed_inputs_at_completion(monkeypatch):
    queued = []
    emitted = []
    monkeypatch.setattr(progress, "_emit_sub_tool_event", lambda kind, **kw: queued.append(kw))
    callback = progress.progress_emitter("eve", {"event_emitter": emitted.append})
    for call_id, preview in [("one", '{"query":"sleep"}'), ("two", {"path": "report.md"})]:
        callback({"type": "tool_start", "tool_call_id": call_id, "input_preview": preview})
    for call_id in ["two", "one"]:
        callback({"type": "tool_end", "tool_call_id": call_id, "success": True})
    assert queued[-2]["tool_call"].input == {"path": "report.md"}
    assert queued[-1]["tool_call"].input == {"query": "sleep"}
    assert emitted[-1]["args"] == {"query": "sleep"}
    assert emitted[-1]["execution_engine"] == "opencode"
    assert emitted[-1]["status"] == "success"


def test_malformed_tool_input_does_not_break_progress(monkeypatch):
    queued = []
    monkeypatch.setattr(progress, "_emit_sub_tool_event", lambda kind, **kw: queued.append(kw))
    callback = progress.progress_emitter("eve", {})
    for preview in ["not JSON", "[]", 42]:
        callback({"type": "tool_start", "input_preview": preview})
    assert all(item["tool_call"].input == {} for item in queued)
