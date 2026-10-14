"""Exercise real stdio MCP; regression-test save ordering without vendor software."""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from zemax_mcp.connection import ZemaxSession

def test_save():
    calls = []
    session = object.__new__(ZemaxSession)
    session.mode = 'standalone'
    session.system = SimpleNamespace(Save=lambda: calls.append('save'))
    session.application = SimpleNamespace(CloseApplication=lambda: calls.append('close'))
    session.close(save=True)
    assert calls == ['save', 'close']
    assert session.system is None
    session = object.__new__(ZemaxSession)
    session.mode = 'extension'
    def fail():
        raise RuntimeError('save failed')
    session.system = SimpleNamespace(Save=fail)
    session.application = object()
    try:
        session.close(save=True)
        raise AssertionError('Expected save failure')
    except RuntimeError:
        assert session.system is not None, 'Failed save must preserve session'

async def main():
    test_save()
    cfg = json.loads((ROOT / '.mcp.json').read_text())['mcpServers']['zemax']
    params = StdioServerParameters(command=cfg['command'], args=cfg['args'],
        cwd=cfg['cwd'], env={**os.environ, **cfg['env']})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            names = [t.name for t in listed.tools]
            assert len(names) == 32, names
            env = await session.call_tool('zemax_environment', {})
            assert not env.isError, env
            info = await session.call_tool('zemax_info', {})
            assert info.isError, 'Unconnected info must not fabricate a session'
            invalid = await session.call_tool('zemax_connect', {'mode': 'invalid'})
            assert invalid.isError
            report = {'timestamp_utc': datetime.now(timezone.utc).isoformat(),
                'protocol': 'passed', 'tool_count': len(names),
                'save_regression': 'passed', 'invalid_mode': 'passed',
                'environment': [c.text for c in env.content if hasattr(c, 'text')],
                'live_opticstudio': 'not tested', 'tools': names}
            (ROOT / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
