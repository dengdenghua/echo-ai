from pathlib import Path

import pytest

from runtime.execution.codex_backend import paths
from runtime.execution.codex_backend.account import CodexAccountService, CodexAccountLeaseError
from runtime.execution.codex_backend.types import RequestTimeoutError
from runtime.safety.auth.scope import TenantScope


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch,tmp_path):
    for key in ('ECHO_CODEX_STATE_DIR','ECHO_DATA_DIR','ECHO_HOME'):
        monkeypatch.delenv(key,raising=False)
    monkeypatch.setattr(paths,'_platform_codex_state_root',lambda:tmp_path/'platform-fallback')


@pytest.mark.parametrize('key,suffix',[('ECHO_DATA_DIR','codex_backend'),('ECHO_HOME','data/codex_backend')])
def test_application_profiles_keep_legacy_state_until_verified_migration(tmp_path,monkeypatch,key,suffix):
    roots=[]
    for kind in ('ai','os'):
        profile=tmp_path/kind
        monkeypatch.setenv(key,str(profile))
        roots.append(paths.resolve_codex_state_root())
        assert roots[-1] == (tmp_path/'platform-fallback').resolve()
    assert roots[0] == roots[1]


def test_operator_state_override_still_wins(tmp_path,monkeypatch):
    monkeypatch.setenv('ECHO_DATA_DIR',str(tmp_path/'ai'))
    monkeypatch.setenv('ECHO_CODEX_STATE_DIR',str(tmp_path/'custom'))
    assert paths.resolve_codex_state_root() == (tmp_path/'custom').resolve()


def test_unconfigured_checkout_still_uses_private_fallback(tmp_path,monkeypatch):
    checkout=tmp_path/'checkout'
    checkout.mkdir()
    monkeypatch.chdir(checkout)
    monkeypatch.setattr(paths,'_platform_codex_state_root',lambda:tmp_path/'private')
    assert paths.resolve_codex_state_root() == (tmp_path/'private').resolve()


def test_configured_state_inside_workspace_remains_forbidden(tmp_path,monkeypatch):
    from runtime.execution.codex_backend.role_runner import state_root_for_workspace
    from runtime.execution.codex_backend.security import CodexSecurityError
    workspace=tmp_path/'workspace'
    workspace.mkdir()
    monkeypatch.setenv('ECHO_CODEX_STATE_DIR',str(workspace/'data'))
    with pytest.raises(CodexSecurityError,match='overlap'):
        state_root_for_workspace(workspace)


class FakeClient:
    async def start(self): pass
    async def close(self): pass
    async def account_read(self,**kwargs): return {'account':None,'requiresOpenaiAuth':True}
    async def next_notification(self,**kwargs): raise RequestTimeoutError('empty')


@pytest.mark.asyncio
async def test_default_noncooperative_services_still_enforce_shared_lease(tmp_path,monkeypatch):
    services=[]
    scope=TenantScope('same-tenant','same-actor')
    try:
        for index,kind in enumerate(('ai','os')):
            monkeypatch.setenv('ECHO_DATA_DIR',str(tmp_path/kind/'data'))
            service=CodexAccountService(paths.resolve_codex_state_root(),command=('fake','app-server'),client_factory=lambda _:FakeClient())
            services.append(service)
            if index == 0:
                assert (await service.read_account(scope)).account is None
            else:
                with pytest.raises(CodexAccountLeaseError):
                    await service.read_account(scope)
    finally:
        for service in services:
            await service.close_all()
