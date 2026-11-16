import json
import shutil
from pathlib import Path

import pytest

from tools.kane_capabilities import install, merge_block, rollback, verify_bundle

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'resources/kane-capabilities'


@pytest.fixture
def target(tmp_path):
    agent = tmp_path / 'agents/kane'
    (agent / 'agent-core').mkdir(parents=True)
    (agent / 'profile.jsonc').write_text('{"id":"kane","name":"My Kane","model":{"name":"my-model"}}')
    (agent / 'agent-core/tool-registry.jsonc').write_text('{"private_skills":["custom_skill"],"arms":[]}')
    (agent / 'agent-core/AGENTS.md').write_text('Owner custom rules\n')
    (agent / 'agent-core/USER.md').write_text('private user preference')
    (agent / 'agent-core/MEMORY.md').write_text('private verified memory')
    return agent, tmp_path / 'plugins', tmp_path / 'state'


def test_integrity_and_platform_inventory():
    manifest = verify_bundle(BUNDLE)
    assert len(manifest['actions']) >= 40
    availability = json.loads((BUNDLE / 'availability.json').read_text(encoding='utf8'))
    assert availability['solidworks-control']['native_platforms'] == ['Windows']
    assert availability['rea-control']['status'] == 'requires_host_configuration'


def test_all_actions_load_in_real_registry():
    from runtime.execution.suckers.codex_plugin_skills import load_codex_plugin_skills
    from runtime.execution.suckers.registry import SkillRegistry
    bundle = verify_bundle(BUNDLE)
    registry = SkillRegistry()
    report = load_codex_plugin_skills(registry, bundle['plugins'], roots=[BUNDLE / 'plugins'])
    assert all(item.found and not item.error for item in report.loads)
    assert set(bundle['actions']).issubset(registry.all_names())


def test_preview_has_no_side_effects(target):
    agent, plugins, state = target
    result = install(BUNDLE, agent, plugins, state)
    assert result['status'] == 'preview'
    assert not plugins.exists() and not state.exists()
    assert (agent / 'agent-core/AGENTS.md').read_text() == 'Owner custom rules\n'


def test_install_load_idempotence_and_rollback(target):
    from runtime.execution.agents.loader import parse_template
    agent, plugins, state = target
    result = install(BUNDLE, agent, plugins, state, True)
    profile = json.loads((agent / 'profile.jsonc').read_text())
    assert profile['name'] == 'My Kane' and profile['model']['name'] == 'my-model'
    assert (agent / 'agent-core/USER.md').read_text() == 'private user preference'
    assert (agent / 'agent-core/MEMORY.md').read_text() == 'private verified memory'
    parsed = parse_template(agent, agent.parent / '_shared')
    assert 'kane-engineering__engineering-resource-hygiene' in parsed.private_skills
    assert 'Owner custom rules' in parsed.soul
    assert 'Kane 工程能力与个人工作规则' in parsed.soul
    assert install(BUNDLE, agent, plugins, state, True)['status'] == 'unchanged'
    rollback(Path(result['journal']))
    assert (agent / 'agent-core/AGENTS.md').read_text() == 'Owner custom rules\n'
    assert json.loads((agent / 'profile.jsonc').read_text())['model']['name'] == 'my-model'


def test_owner_edit_blocks_update_and_rollback(target):
    agent, plugins, state = target
    result = install(BUNDLE, agent, plugins, state, True)
    path = agent / 'agent-core/AGENTS.md'
    path.write_text(path.read_text(encoding='utf8').replace('Kane 工程能力', 'Owner changed 工程能力'),encoding='utf8')
    with pytest.raises(ValueError, match='User edit conflict'):
        install(BUNDLE, agent, plugins, state, True)
    with pytest.raises(ValueError, match='changed after'):
        rollback(Path(result['journal']))


def test_tampered_bundle_rejected_before_install(target, tmp_path):
    copy = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, copy)
    (copy / 'availability.json').write_text('{}')
    with pytest.raises(ValueError, match='checksum'):
        install(copy, *target, True)
    assert not target[1].exists()


def test_managed_block_preserves_surrounding_edits():
    text = merge_block('owner before', 'v1') + 'owner after'
    updated = merge_block(text, 'v2')
    assert 'owner before' in updated and 'owner after' in updated
    assert 'v1' not in updated
    with pytest.raises(ValueError, match='Malformed'):
        merge_block('<!-- kane-capabilities:start -->broken', 'new')


def test_locked_plugin_rolls_back_prior_changes(target, monkeypatch):
    from runtime.platform.plugins import plugin_lifecycle
    real = plugin_lifecycle.install_local_plugin
    count = 0
    def locked(*args, **kwargs):
        nonlocal count
        count += 1
        if count == 3:
            raise PermissionError('plugin in use')
        return real(*args, **kwargs)
    monkeypatch.setattr(plugin_lifecycle, 'install_local_plugin', locked)
    with pytest.raises(PermissionError): install(BUNDLE, *target, True)
    agent, plugins, state = target
    assert (agent / 'agent-core/AGENTS.md').read_text() == 'Owner custom rules\n'
    assert not (plugins / 'blender-control').exists()
    journal = next(state.glob('*/transaction.json'))
    assert json.loads(journal.read_text())['status'] == 'failed_rolled_back'
