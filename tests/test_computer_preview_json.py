"""Regression for actual model calls serializing the nested action object."""
import json

import pytest

from runtime.execution.suckers import computer_api_skills as bridge


@pytest.mark.parametrize('encoded', [False, True])
def test_preview_preserves_action_and_target_without_executing(monkeypatch, encoded):
    action = {'action': 'type', 'text': '你好，Echo🙂',
              'automation_target': {'kind': 'desktop_window', 'id': 'win32:123:456'}}
    seen = []

    def call(method, route, body):
        seen.append((method, route, body))
        return {'ok': True, 'token': 'preview-only', 'expires_in_seconds': 90}

    monkeypatch.setattr(bridge, '_call', call)
    result = bridge._computer_preview_action(json.dumps(action) if encoded else action)
    assert result['token'] == 'preview-only'
    assert seen == [('POST', '/actions/preview', action)]


@pytest.mark.parametrize('value', [None, [], 42, '', '{bad', '[]', 'null', '42', '"text"'])
def test_invalid_preview_never_reaches_gateway(monkeypatch, value):
    def forbidden(*args, **kwargs):
        pytest.fail('invalid preview must not issue a gateway request')

    monkeypatch.setattr(bridge, '_call', forbidden)
    result = bridge._computer_preview_action(value)
    assert result['ok'] is False
    assert 'object' in result['error']
    assert 'token' not in result
