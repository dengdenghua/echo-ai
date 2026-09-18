"""Contract tests for the composer ring's context segments.

``GET /api/threads/{id}/context-breakdown`` has two possible answers: the
composition of the request the ReAct loop actually assembled (recorded
in-process, measured) and an estimate of the stored messages (always
available, approximate). These tests pin both, and pin that a measured
request is never blended with the estimate — a number matching neither
reading would be worse than either.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.threads import ThreadStateStore
from runtime.sensing.gateway import context_snapshot as snapshot
from runtime.sensing.gateway.context_snapshot import (
    measure_request,
    record_request_context,
    split_system_sections,
)
from runtime.sensing.gateway.thread_state_router import create_thread_state_router


@pytest.fixture(autouse=True)
def _clean_snapshots():
    snapshot.clear_request_context()
    yield
    snapshot.clear_request_context()


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(create_thread_state_router(store=ThreadStateStore()))
    return TestClient(app)


def _thread(client: TestClient, messages: list[dict[str, object]]) -> str:
    created = client.post(
        "/api/threads",
        json={"metadata": {"mode": "chat"}, "values": {"messages": messages}},
    )
    assert created.status_code == 200, created.text
    return created.json()["thread_id"]


class TestSplitSystemSections:
    def test_charges_each_labelled_span_once(self) -> None:
        prompt = (
            "You are Echo.\n\n"
            "AVAILABLE SKILLS (name · one-liner):\n- web\n\n"
            "RELEVANT LONG-TERM MEMORY:\nthe user prefers rust\n"
        )

        sections = split_system_sections(prompt)

        assert sections["system_prompt"].startswith("You are Echo.")
        assert "AVAILABLE SKILLS" in sections["skills"]
        assert "RELEVANT LONG-TERM MEMORY" in sections["memory"]
        # No span is dropped and none is counted twice.
        assert sum(len(span) for span in sections.values()) == len(prompt)

    def test_a_prompt_without_markers_is_all_system_prompt(self) -> None:
        sections = split_system_sections("plain instructions")

        assert sections == {"system_prompt": "plain instructions", "skills": "", "memory": ""}

    def test_an_empty_prompt_yields_nothing(self) -> None:
        assert split_system_sections("") == {
            "system_prompt": "",
            "skills": "",
            "memory": "",
        }


class TestMeasureRequest:
    def test_charges_tool_schemas_by_kind(self) -> None:
        tokens = measure_request(
            messages=[{"role": "system", "content": "sys"}],
            tools=[
                {
                    "name": "filesystem_write",
                    "description": "write a file",
                    "input_schema": {"type": "object"},
                },
                {
                    "name": "mcp__github__search",
                    "description": "search code",
                    "input_schema": {"type": "object"},
                },
            ],
        )

        assert tokens["system_prompt"] > 0
        assert tokens["system_tools"] > 0
        assert tokens["mcp_tools"] > 0
        assert tokens["messages"] == 0

    def test_conversation_and_tool_results_land_in_their_own_buckets(self) -> None:
        tokens = measure_request(
            messages=[
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hello there"},
                {"role": "assistant", "content": "hi"},
                {"role": "tool", "name": "mcp__fs__read", "content": "file body"},
            ],
            tools=[],
        )

        assert tokens["messages"] > 0
        assert tokens["mcp_tools"] > 0

    def test_skill_and_memory_spans_leave_the_system_prompt_bucket(self) -> None:
        tokens = measure_request(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "base\n\nAVAILABLE SKILLS (name · one-liner):\n- web · build pages\n\n"
                        "RELEVANT LONG-TERM MEMORY:\nlikes rust\n"
                    ),
                }
            ],
            tools=[],
        )

        assert tokens["skills"] > 0
        assert tokens["memory"] > 0
        assert tokens["system_prompt"] > 0


class TestSnapshotStore:
    def test_records_and_reads_back_per_thread(self) -> None:
        record_request_context("trn_a", [{"role": "system", "content": "x"}], [])

        assert snapshot.get_request_context("trn_a")["tokens"]["system_prompt"] > 0
        assert snapshot.get_request_context("trn_b") is None

    def test_a_missing_thread_id_is_not_recorded(self) -> None:
        assert record_request_context("", [{"role": "user", "content": "x"}], []) is None
        assert snapshot.get_request_context("") is None

    def test_the_map_stays_bounded(self) -> None:
        for index in range(snapshot._MAX_THREADS + 5):
            record_request_context(f"trn_{index}", [{"role": "user", "content": "x"}], [])

        assert len(snapshot._SNAPSHOTS) == snapshot._MAX_THREADS
        # The oldest entry was the one dropped.
        assert snapshot.get_request_context("trn_0") is None
        assert snapshot.get_request_context(f"trn_{snapshot._MAX_THREADS + 4}") is not None

    def test_reading_a_snapshot_does_not_expose_the_stored_dict(self) -> None:
        record_request_context("trn_a", [{"role": "user", "content": "x" * 80}], [])

        first = snapshot.get_request_context("trn_a")
        first["tokens"]["messages"] = 999_999

        assert snapshot.get_request_context("trn_a")["tokens"]["messages"] != 999_999


class TestContextBreakdownEndpoint:
    def test_estimates_from_stored_messages_without_a_measured_request(self) -> None:
        client = _client()
        thread_id = _thread(
            client,
            messages=[
                {"type": "system", "content": "you are echo"},
                {"type": "human", "content": "how much context is this?"},
            ],
        )

        payload = client.get(f"/api/threads/{thread_id}/context-breakdown").json()

        assert payload["source"] == "estimate"
        assert payload["measured_at"] is None
        keys = {segment["key"] for segment in payload["segments"]}
        assert {"system_prompt", "messages"} <= keys
        assert payload["total_tokens"] == sum(segment["tokens"] for segment in payload["segments"])

    def test_a_measured_request_wins_over_the_estimate(self) -> None:
        client = _client()
        thread_id = _thread(client, messages=[{"type": "human", "content": "x" * 4_000}])
        record_request_context(
            thread_id,
            messages=[{"role": "system", "content": "s" * 400}],
            tools=[
                {
                    "name": "mcp__github__search",
                    "description": "d" * 400,
                    "input_schema": {"type": "object"},
                }
            ],
        )

        payload = client.get(f"/api/threads/{thread_id}/context-breakdown").json()

        assert payload["source"] == "request"
        assert payload["measured_at"] is not None
        by_key = {segment["key"]: segment["tokens"] for segment in payload["segments"]}
        assert by_key["mcp_tools"] > 0
        # The request carried no conversation, so the estimate's messages
        # bucket must not leak into a measured answer.
        assert "messages" not in by_key

    def test_an_unknown_thread_is_a_404(self) -> None:
        client = _client()

        assert client.get("/api/threads/trn_missing/context-breakdown").status_code == 404
