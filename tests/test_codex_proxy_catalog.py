import json
from types import SimpleNamespace
from runtime.execution.codex_backend.proxy_catalog import configure_proxy_catalog

def test_proxy_catalog_is_current_model_only_and_account_is_untouched(tmp_path):
    config = tmp_path / "config.toml"
    config.write_text("# security policy\n")
    ctx = SimpleNamespace(config_path=config, codex_home=tmp_path)
    req = SimpleNamespace(use_system_model_proxy=False, model="custom", model_context_window=1000000, auto_compact_token_limit=32000)
    configure_proxy_catalog(ctx, req)
    assert config.read_text() == "# security policy\n"
    req.provider_profile = SimpleNamespace(provider_id="echo_proxy")
    configure_proxy_catalog(ctx, req)
    model = json.loads((tmp_path / "echo-proxy-model.json").read_text())["models"][0]
    assert model["slug"] == "custom"
    assert model["context_window"] == 1000000
    assert model["auto_compact_token_limit"] == 32000
    assert "# security policy" in config.read_text()
