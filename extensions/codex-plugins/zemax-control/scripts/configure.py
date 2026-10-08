"""Configure this local plugin for an existing Windows Python runtime."""
import argparse
import json
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--python', default=sys.executable)
parser.add_argument('--zemax-root', help='Zemax data directory, not the install directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
python = Path(args.python).resolve()
if not python.is_file():
    parser.error('Python executable does not exist')
env = {'PYTHONUTF8': '1', 'ZEMAX_MCP_ALLOW_EVAL': '1'}
if args.zemax_root:
    data = Path(args.zemax_root).resolve()
    if not (data / 'ZOS-API/Libraries/ZOSAPI_NetHelper.dll').is_file():
        parser.error('No ZOSAPI_NetHelper.dll under the specified Zemax data directory')
    env['ZEMAX_ROOT'] = str(data)
config = {'mcpServers': {'zemax': {
    'command': str(python), 'args': [str(root / 'scripts/run_server.py')],
    'cwd': str(root), 'env': env,
    'startup_timeout_sec': 30, 'tool_timeout_sec': 600
}}}
(root / '.mcp.json').write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
print('Configured ' + str(root / '.mcp.json'))
