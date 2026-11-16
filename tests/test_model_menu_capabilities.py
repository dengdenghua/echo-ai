import json
from runtime.execution.codebuddy_model_capabilities import model_capabilities
from runtime.platform.models.official_capabilities import account_context_metadata
from runtime.sensing.gateway._config_helpers import _entry_context_window

def test_unknown_context_is_not_256k():
    assert _entry_context_window({'id': 'unpublished'}, ['unpublished']) is None

def test_variants_resolve_their_own_context():
    entry = {'id': 'shared-endpoint'}
    assert _entry_context_window(entry, ['deepseek-flash']) == 1_000_000
    assert _entry_context_window(entry, ['gpt-6-luna']) == 1_050_000
    assert _entry_context_window({**entry, 'context_window': 64_000}, ['gpt-6-luna']) == 64_000

def test_account_capacity_preserves_engine_limit_and_labels_api_fallback():
    assert account_context_metadata({}, 'gpt-6.1-sol') == {'context_window': 500000, 'context_source': 'official_engine_default'}
    assert account_context_metadata({'contextWindow': 272000}, 'gpt-6-luna') == {'context_window': 272000, 'context_source': 'engine'}
    assert account_context_metadata({}, 'gpt-6-luna') == {'context_window': 1050000, 'context_source': 'official_api'}
    assert account_context_metadata({}, 'future-unknown')['context_window'] is None

def test_buddy_cache_does_not_leak_or_invent_tiers(tmp_path):
    cache = [{'userId':'private', 'ts':2, 'data': {'secret':'private', 'models':[
        {'id':'hy4std','maxInputTokens':960000,'reasoning':{'supportedEfforts':['high'],'defaultEffort':'high'}},
        {'id':'step','maxInputTokens':1000000,'reasoning':{'supportedEfforts':['low','medium','high']}},
        {'id':'hidden','maxInputTokens':123456},
    ]}}]
    (tmp_path/'catalog.info').write_text(json.dumps(cache))
    result = model_capabilities(['hy4std','step'],tmp_path)
    assert result['hy4std']['reasoning_efforts'] == ['high']
    assert result['step']['reasoning_efforts'] == ['low','medium','high']
    assert result['hy4std']['context_window'] == 960000
    assert 'private' not in json.dumps(result)
    assert 'hidden' not in result

def test_buddy_corrupt_cache_is_unknown(tmp_path):
    (tmp_path/'bad.info').write_text('{bad')
    assert model_capabilities(['hy4std'],tmp_path) == {}
