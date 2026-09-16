import httpx
import pytest

from runtime.execution.suckers import kimi_compat_skills as media
from runtime.execution.suckers import media_gateway as gateway


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("ECHO_MEDIA_BASE_URL", "https://gateway.test/v1")
    monkeypatch.setenv("ECHO_MEDIA_API_KEY", "server-secret")
    monkeypatch.setenv("ECHO_IMAGE_MODEL", "image-default")
    monkeypatch.setenv("ECHO_VIDEO_MODEL", "video-default")
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path.endswith("images/generations"):
            return httpx.Response(200, json={"data": [{"url": "https://assets.test/image.png"}]})
        return httpx.Response(200, json={"id": "task-1", "status": "queued"})

    factory = httpx.Client
    monkeypatch.setattr(gateway.httpx, "Client", lambda **kw: factory(transport=httpx.MockTransport(handle), **kw))
    return calls


def test_existing_tools_use_server_gateway_and_poll_without_resubmitting(configured):
    assert media._generate_image("海报")["provider"] == "echo"
    assert media._generate_video("短片")["task_id"] == "task-1"
    assert media._generate_video(task_id="task-1")["task_id"] == "task-1"
    assert [r.method for r in configured] == ["POST", "POST", "GET"]
    assert all(r.url.host == "gateway.test" for r in configured)


def test_missing_gateway_key_does_not_fall_back(configured, monkeypatch):
    monkeypatch.delenv("ECHO_MEDIA_API_KEY")
    monkeypatch.setenv("OPENAI_API_KEY", "other-key")
    assert media._generate_image("海报")["ok"] is False
    assert not configured


def test_model_allowlist(configured, monkeypatch):
    assert media._generate_image("海报", model="other")["ok"] is False
    assert not configured
    monkeypatch.setenv("ECHO_IMAGE_MODELS", "other")
    assert media._generate_image("海报", model="other")["model"] == "other"


def test_task_selection_overrides_agent_argument(configured, monkeypatch):
    from runtime.platform.process.session import Session, session_scope

    monkeypatch.setenv("ECHO_IMAGE_MODELS", "selected-image")
    with session_scope(Session(metadata={"design_capabilities": {"image_model": "selected-image"}})):
        result = media._generate_image("海报", model="image-default")
    assert result["model"] == "selected-image"


def test_public_catalog_contains_models_but_no_credentials(configured):
    catalog = gateway.model_catalog()
    assert catalog["image"]["models"] == ["image-default"]
    assert "server-secret" not in str(catalog)
    assert "gateway.test" not in str(catalog)
