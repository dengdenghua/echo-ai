"""Run the builder with inert filesystem/process adapters; never invoke PyInstaller."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "extras/desktop/build-backend-win.cjs"
HARNESS = r"""
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const [file, scenario] = process.argv.slice(1);
const repo = path.resolve(path.dirname(file), '../..');
const locked = path.join(repo, '.venv', 'Scripts', 'python.exe');
const calls = {spawn: [], remove: [], rename: []};
const fakeFs = {
  existsSync(p) { return !(scenario === 'missing-file' && p === locked); },
  statSync() { return {isFile: () => true}; },
  rmSync(p) { calls.remove.push(p); }, mkdirSync() {},
  readdirSync() { return ['echo-backend.exe', '_internal']; },
  renameSync(from, to) { calls.rename.push([from, to]); }, rmdirSync() {},
};
const env = scenario === 'absent' ? {} : {
  PYTHON_EXE: scenario === 'wrong' ? path.join(repo, 'unlocked', 'python.exe') : locked,
};
let error = null;
try {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), console: {log() {}},
    process: {env, exit(code) { throw new Error('exit ' + code); }},
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return {
        spawnSync(exe, args, options) { calls.spawn.push({exe, args, cwd: options.cwd}); return {status: 0}; }
      };
      throw new Error('unexpected import: ' + name);
    },
  });
} catch (e) { error = e.message; }
console.log(JSON.stringify({error, calls, locked, repo}));
"""


@pytest.mark.parametrize("scenario", ["valid", "absent", "wrong", "missing-file"])
def test_builder_validates_interpreter_before_touching_outputs(scenario):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is needed to exercise the desktop builder")
    completed = subprocess.run(
        [node, "-e", HARNESS, str(BUILDER), scenario],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    result = json.loads(completed.stdout)
    if scenario != "valid":
        assert result["error"]
        assert result["calls"] == {"spawn": [], "remove": [], "rename": []}
        return
    assert result["error"] is None
    calls = result["calls"]
    assert len(calls["spawn"]) == 1
    assert calls["spawn"][0]["exe"] == result["locked"]
    assert calls["spawn"][0]["args"][:2] == ["-m", "PyInstaller"]
    assert calls["spawn"][0]["cwd"] == result["repo"]
    output = ROOT / "extras/desktop/build/backend"
    assert calls["rename"] == [
        [str(output / "echo-backend" / name), str(output / name)]
        for name in ("echo-backend.exe", "_internal")
    ]
