import asyncio
import time
from pathlib import Path

import pytest

from runtime.execution.codex_backend.account import CodexAccountService, CodexAccountLeaseError, _has_control_waiter
from runtime.execution.codex_backend.model_profile import CodexModelPreferenceStore,CodexModelPreference
from runtime.execution.codex_backend.types import RequestTimeoutError,ConfigurationError
from runtime.safety.auth.scope import TenantScope


class Client:
    def __init__(self,tracker):
        self.tracker=tracker
        self.closed=False
        self.gate=None
    async def start(self):
        self.loop=asyncio.get_running_loop()
        self.tracker['active']+=1
        self.tracker['peak']=max(self.tracker['peak'],self.tracker['active'])
    async def close(self):
        if not self.closed:
            self.closed=True
            self.tracker['active']-=1
    async def next_notification(self,**kwargs):raise RequestTimeoutError('empty')
    async def account_read(self,**kwargs):
        if self.gate:
            self.gate[0].set()
            await self.gate[1].wait()
        await asyncio.sleep(.01)
        return {'account':{'type':'chatgpt'},'requiresOpenaiAuth':False}
    async def cancel_login(self,*args):return {}


def services(tmp_path,timeout=2):
    tracker={'active':0,'peak':0,'clients':[]}
    def factory(config):
        c=Client(tracker);tracker['clients'].append(c);return c
    def build(wait=timeout):
        return CodexAccountService(tmp_path/'state',command=('fake','app-server'),client_factory=factory,cooperative_lease_timeout_s=wait)
    return build(),build(),tracker,build


@pytest.mark.asyncio
async def test_peer_handoff_preserves_auth_preferences_and_bindings(tmp_path):
    first,second,tracker,_=services(tmp_path)
    scope=TenantScope('tenant','owner')
    home=first.account_home(scope);home.mkdir(parents=True)
    auth=home/'auth.json';auth.write_text('{"test":"synthetic-credential"}');auth.chmod(0o600)
    prefs=CodexModelPreferenceStore(first.state_root/'model_profile.json')
    expected=CodexModelPreference(mode='chatgpt',model='test-model',reasoning_effort='high')
    prefs.write(scope,expected)
    binding=first.state_root/'realms/test/binding.json';binding.parent.mkdir(parents=True)
    binding.write_text('{"test":"existing-session-binding"}')
    before={p:p.read_bytes() for p in (auth,prefs.path_for(scope),binding)}
    try:
        await first.read_account(scope)
        await asyncio.wait_for(second.read_account(scope),3)
        await asyncio.wait_for(first.read_account(scope),3)
        assert tracker['peak']==1
        assert second.account_home(scope)==home
        assert prefs.read(scope)==expected
        assert all(p.read_bytes()==data for p,data in before.items())
        assert not list(home.parent.glob('.control-wait-*.json'))
    finally:
        await first.close_all();await second.close_all()
    assert tracker['active']==0


@pytest.mark.asyncio
async def test_inflight_request_is_not_interrupted_by_handoff(tmp_path):
    first,second,tracker,_=services(tmp_path)
    try:
        await first.read_account(None)
        owner=tracker['clients'][0]
        entered,release=asyncio.Event(),asyncio.Event();owner.gate=(entered,release)
        request=asyncio.create_task(first.read_account(None));await entered.wait()
        peer=asyncio.create_task(second.read_account(None));await asyncio.sleep(.3)
        assert not owner.closed and not peer.done()
        release.set();await request;await asyncio.wait_for(peer,3)
        assert tracker['peak']==1 and owner.closed
    finally:
        await first.close_all();await second.close_all()


@pytest.mark.asyncio
async def test_pending_login_remains_owned_and_wait_is_bounded(tmp_path):
    first,second,tracker,_=services(tmp_path,timeout=.35)
    try:
        await first.read_account(None)
        runtime=first._runtimes['local'];runtime.active_login_id='pending';runtime.login_started_at=time.monotonic()
        with pytest.raises(CodexAccountLeaseError):await asyncio.wait_for(second.read_account(None),1)
        assert not tracker['clients'][0].closed
        assert not list(runtime.home.parent.glob('.control-wait-*.json'))
    finally:
        await first.close_all();await second.close_all()


@pytest.mark.asyncio
async def test_cancelled_waiter_removes_own_request_and_can_retry(tmp_path):
    unused,second,tracker,build=services(tmp_path)
    first=build(wait=0)
    try:
        await first.read_account(None)
        task=asyncio.create_task(second.read_account(None));await asyncio.sleep(.03)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        assert not list(first.account_home(None).parent.glob('.control-wait-*.json'))
        assert not tracker['clients'][0].closed
        await first.close_all();await second.read_account(None)
        assert tracker['peak']==1
    finally:
        await first.close_all();await second.close_all();await unused.close_all()


@pytest.mark.parametrize('value',['nan','inf','bad','0'])
def test_invalid_or_expired_requests_do_not_trigger_handoff(tmp_path,value):
    marker=tmp_path/'.control-wait-test.json';marker.write_text(value);marker.chmod(0o600)
    assert not _has_control_waiter(tmp_path)


@pytest.mark.parametrize('timeout',[-1,float('nan'),float('inf'),31])
def test_wait_configuration_is_bounded(tmp_path,timeout):
    with pytest.raises(ConfigurationError):CodexAccountService(tmp_path/'state',cooperative_lease_timeout_s=timeout)


@pytest.mark.asyncio
async def test_busy_peers_alternate_without_overlapping_clients(tmp_path):
    first,second,tracker,_=services(tmp_path)
    try:
        async def reads(service):
            for _ in range(8):
                assert (await service.read_account(None)).account is not None
                await asyncio.sleep(.02)
        await asyncio.wait_for(asyncio.gather(reads(first),reads(second)),8)
        assert tracker['peak']==1
    finally:
        await first.close_all();await second.close_all()


@pytest.mark.asyncio
async def test_two_principals_do_not_form_a_pool_lock_wait_cycle(tmp_path):
    first,second,tracker,_=services(tmp_path,timeout=1.5)
    alice,bob=TenantScope('tenant','alice'),TenantScope('tenant','bob')
    try:
        await first.read_account(alice);await second.read_account(bob)
        results=await asyncio.wait_for(asyncio.gather(first.read_account(bob),second.read_account(alice)),2)
        assert all(result.account is not None for result in results)
    finally:
        await first.close_all();await second.close_all()
    assert tracker['active']==0


def test_local_desktop_enables_handoff_but_server_defaults_keep_exclusive_owner(tmp_path,monkeypatch):
    from runtime.sensing.gateway.config_router import create_config_router
    monkeypatch.setenv('ECHO_DESKTOP','1')
    for mode,expected in [('local',8),('production',0),('shared',0)]:
        bundle=create_config_router(codex_state_root=tmp_path/mode,deployment_mode=mode)
        assert bundle.codex_accounts._cooperative_lease_timeout_s==expected
    monkeypatch.delenv('ECHO_DESKTOP')
    bundle=create_config_router(codex_state_root=tmp_path/'server',deployment_mode='local')
    assert bundle.codex_accounts._cooperative_lease_timeout_s==0


@pytest.mark.asyncio
async def test_idle_runtime_closes_on_its_own_live_event_loop(tmp_path):
    import threading
    first,_,tracker,_build=services(tmp_path,timeout=0)
    loop=asyncio.new_event_loop()
    thread=threading.Thread(target=loop.run_forever,daemon=True);thread.start()
    try:
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(first.read_account(None),loop))
        client=tracker['clients'][0]
        original=client.close
        async def close_on_owner():
            assert asyncio.get_running_loop() is loop
            await original()
        client.close=close_on_owner
        await first.close_all()
        assert tracker['active']==0
    finally:
        loop.call_soon_threadsafe(loop.stop);thread.join(timeout=2);loop.close()


@pytest.mark.asyncio
async def test_first_worker_refresh_uses_service_owner_loop_and_shutdown_routes_back(tmp_path):
    import threading
    first,unused,tracker,_=services(tmp_path)
    loop=asyncio.new_event_loop()
    thread=threading.Thread(target=loop.run_forever,daemon=True);thread.start()
    async def initialize():first.start_idle_reaper()
    try:
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(initialize(),loop))
        await first.refresh_for_execution_any_loop(None)
        assert tracker['clients'][0].loop is loop
        await first.close_all()
        assert tracker['active']==0 and first._reaper_task is None
    finally:
        await unused.close_all()
        loop.call_soon_threadsafe(loop.stop);thread.join(timeout=2);loop.close()


@pytest.mark.asyncio
async def test_failed_control_connection_is_recreated_without_clearing_account(tmp_path):
    first, second, tracker, _ = services(tmp_path)
    try:
        await first.read_account(None)
        original = tracker['clients'][0]
        original.ready = False
        result = await first.read_account(None)
        assert original.closed
        assert len(tracker['clients']) == 2
        assert tracker['peak'] == 1
        assert result is not None
    finally:
        await first.close_all()
        await second.close_all()


@pytest.mark.asyncio
async def test_connector_catalog_uses_small_pages(tmp_path):
    first, second, tracker, _ = services(tmp_path)
    try:
        await first.read_account(None)
        calls=[]
        async def apps(**kwargs):
            calls.append(kwargs)
            return {'data': [], 'nextCursor': 'second' if len(calls)==1 else None}
        tracker['clients'][0].list_apps=apps
        assert await first.list_apps(None)==[]
        assert [c['limit'] for c in calls]==[10,10]
        assert calls[1]['cursor']=='second'
    finally:
        await first.close_all()
        await second.close_all()
