"""Page translation endpoint: tagged prompts, mapping back to nodes, cache, failures."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from runtime.sensing.gateway import page_translate_router as ptr
from runtime.sensing.model_router.actor_context import current_actor
from runtime.sensing.model_router.models import ModelResponse
from runtime.sensing.model_router.oct_router import OctCredentialsRequired

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

# "Machine translation is the use of computational techniques to translate
# text or speech from one language to another." with its bold term and links.
WIKI_PIECES = [
    "Machine translation",
    " is the use of computational techniques to ",
    "translate",
    " text or speech from one ",
    "language",
    " to another.",
]
WIKI_KINDS = ["b", "", "a", "", "a", ""]


def _reply(mapping: dict[str, str], *, fenced: bool = False) -> ModelResponse:
    body = json.dumps(
        {"segments": [{"id": key, "text": value} for key, value in mapping.items()]},
        ensure_ascii=False,
    )
    if fenced:
        body = f"Here you go:\n```json\n{body}\n```"
    return ModelResponse(text=body, model="fake")


class _Router:
    def __init__(self, reply=None, error: Exception | None = None) -> None:
        self.reply = reply
        self.error = error
        self.requests = []
        self.actors = []

    def call(self, request):
        self.requests.append(request)
        self.actors.append(current_actor.get())
        if self.error is not None:
            raise self.error
        return self.reply(request) if callable(self.reply) else self.reply


def _segment(key: str, pieces: list[str], kinds: list[str] | None = None):
    return ptr.PageTranslateSegment(id=key, pieces=pieces, kinds=kinds)


def test_the_model_sees_formatted_words_in_numbered_tags():
    assert ptr.tagged_text(WIKI_PIECES, WIKI_KINDS) == (
        "<b0>Machine translation</b0> is the use of computational techniques to "
        "<a2>translate</a2> text or speech from one <a4>language</a4> to another."
    )
    assert ptr.tagged_text(["1 < 2"], [""]) == "1 ‹ 2"


def test_tags_in_page_order_map_straight_back():
    translated = (
        "<b0>机器翻译</b0>是借助计算技术<a2>翻译</a2>文本或语音，从一种<a4>语言</a4>转换为另一种。"
    )

    pieces = ptr.map_translation(WIKI_PIECES, WIKI_KINDS, translated)

    assert pieces == [
        "机器翻译",
        "是借助计算技术",
        "翻译",
        "文本或语音，从一种",
        "语言",
        "转换为另一种。",
    ]


def test_reordered_links_keep_the_sentence_fluent():
    # A real reply: Chinese wants "language" before "translate".
    translated = (
        "<b0>机器翻译</b0>是利用计算技术将文本或语音从一种<a4>语言</a4><a2>翻译</a2>成另一种语言。"
    )

    pieces = ptr.map_translation(WIKI_PIECES, WIKI_KINDS, translated)

    assert "".join(pieces) == "机器翻译是利用计算技术将文本或语音从一种语言翻译成另一种语言。"
    # The bold term and one link keep their own words; the other link's word
    # moved into the sentence and its piece is empty.
    assert pieces[0] == "机器翻译"
    assert {pieces[2], pieces[4]} in ({"", "翻译"}, {"", "语言"})


def test_missing_tags_and_line_breaks_still_read_whole():
    pieces = ptr.map_translation(
        ["Read the ", "installation guide", " first."],
        ["", "a", ""],
        "请先阅读安装指南。",
    )
    assert "".join(pieces) == "请先阅读安装指南。"
    assert pieces[1] == ""

    lines = ptr.map_translation(
        ["First line", "Second line"], ["t", "t"], "<t0>第一行</t0><t1>第二行</t1>"
    )
    assert lines == ["第一行", "第二行"]


def test_pieces_without_valid_kinds_keep_their_boundaries():
    assert ptr.piece_kinds(_segment("1", ["a", "b"])) == ["t", "t"]
    assert ptr.piece_kinds(_segment("1", ["only"])) == [""]
    assert ptr.piece_kinds(_segment("1", ["a", "b"], ["x", "!"])) == ["t", "t"]


def test_reply_parsing_tolerates_fences_and_prose():
    reply = _reply({"1": "你好"}, fenced=True)

    assert ptr.parse_translations(reply.text) == {"1": "你好"}
    with pytest.raises(ValueError):
        ptr.parse_translations("sorry, I cannot help with that")


def test_cached_paragraphs_skip_the_model_and_missing_ones_are_left_out():
    router = _Router(_reply({"1": "关于我们", "2": "<a0>联系</a0>我们"}))
    cache = ptr._TranslationCache()
    segments = [
        _segment("1", ["About us"], [""]),
        _segment("2", ["Contact", " us"], ["a", ""]),
        _segment("3", ["Blog"], [""]),
    ]

    first, hits = ptr.translate_segments(router.call, "value-model", segments, cache=cache)

    assert [(s.id, s.pieces) for s in first] == [("1", ["关于我们"]), ("2", ["联系", "我们"])]
    assert hits == 0
    payload = json.loads(router.requests[0].messages[1].content)
    assert payload["segments"][1] == {"id": "2", "text": "<a0>Contact</a0> us"}
    assert router.requests[0].model == "value-model"

    again, hits = ptr.translate_segments(router.call, "value-model", segments[:2], cache=cache)
    assert hits == 2
    assert len(router.requests) == 1
    assert [s.id for s in again] == ["1", "2"]


def test_unparseable_reply_is_a_readable_error():
    router = _Router(ModelResponse(text="I can't do that.", model="fake"))

    with pytest.raises(ptr.PageTranslateError) as caught:
        ptr.translate_segments(router.call, "m", [_segment("1", ["Hello"])])
    assert caught.value.status == 502


def _client(router: _Router, monkeypatch) -> TestClient:
    from runtime.core.cerebrum import turn_complexity
    from runtime.sensing.gateway import openai_gateway_router

    monkeypatch.setattr(turn_complexity, "resolve_tier_model", lambda tier: "value-model")
    monkeypatch.setattr(openai_gateway_router, "_resolve_actor", lambda *a, **k: "alice")
    stack = SimpleNamespace(planner=SimpleNamespace(router=router, planner_model="p"))
    app = fastapi.FastAPI()
    app.include_router(ptr.create_page_translate_router(stack=stack))
    return TestClient(app)


def test_route_translates_as_the_signed_in_account(monkeypatch):
    router = _Router(_reply({"1": "你好，<a1>世界</a1>"}))
    client = _client(router, monkeypatch)

    response = client.post(
        "/api/browser/translate",
        json={"segments": [{"id": "1", "pieces": ["Hello, ", "world"], "kinds": ["", "a"]}]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "translations": [{"id": "1", "pieces": ["你好，", "世界"]}],
        "model": "value-model",
        "cached": 0,
    }
    assert router.actors == ["alice"]
    assert current_actor.get() is None


@pytest.mark.parametrize(
    ("error", "status", "text"),
    [
        (OctCredentialsRequired("no current_actor"), 401, "登录 Echo 账号"),
        (RuntimeError("no LLM model configured — add one"), 503, "添加一个模型"),
        (RuntimeError("upstream exploded"), 502, "暂时不可用"),
    ],
)
def test_route_failures_read_as_sentences(monkeypatch, error, status, text):
    client = _client(_Router(error=error), monkeypatch)

    response = client.post(
        "/api/browser/translate",
        json={"segments": [{"id": "1", "pieces": ["Hello"]}]},
    )

    assert response.status_code == status
    assert text in response.json()["detail"]


def test_route_refuses_oversized_batches(monkeypatch):
    router = _Router(_reply({}))
    client = _client(router, monkeypatch)

    response = client.post(
        "/api/browser/translate",
        json={"segments": [{"id": "1", "pieces": ["x" * (ptr.MAX_TOTAL_CHARS + 1)]}]},
    )

    assert response.status_code == 413
    assert router.requests == []


def test_route_translates_into_the_readers_language(monkeypatch):
    router = _Router(lambda request: _reply({"1": "Hello"}))
    client = _client(router, monkeypatch)

    english = client.post(
        "/api/browser/translate",
        json={"target": "en-US", "segments": [{"id": "1", "pieces": ["你好"]}]},
    )
    chinese = client.post(
        "/api/browser/translate",
        json={"target": "zh-CN", "segments": [{"id": "1", "pieces": ["你好"]}]},
    )
    unknown = client.post(
        "/api/browser/translate",
        json={"target": "xx-XX", "segments": [{"id": "1", "pieces": ["你好"]}]},
    )

    assert english.status_code == chinese.status_code == 200
    assert "into English." in router.requests[0].messages[0].content
    # The cache keeps each reader's translation apart.
    assert len(router.requests) == 2
    assert "Simplified Chinese" in router.requests[1].messages[0].content
    assert unknown.status_code == 422


def test_route_uses_the_readers_model_choice(monkeypatch):
    router = _Router(lambda request: _reply({"1": "你好"}))
    client = _client(router, monkeypatch)

    picked = client.post(
        "/api/browser/translate",
        json={"model": "deepseek-chat", "segments": [{"id": "1", "pieces": ["Hi"]}]},
    )
    default = client.post(
        "/api/browser/translate",
        json={"model": "  ", "segments": [{"id": "1", "pieces": ["Hey"]}]},
    )

    assert picked.json()["model"] == "deepseek-chat"
    assert router.requests[0].model == "deepseek-chat"
    assert default.json()["model"] == "value-model"
