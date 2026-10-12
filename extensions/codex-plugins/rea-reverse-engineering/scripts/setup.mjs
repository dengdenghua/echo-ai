#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { assertNode, environment, JADX_JAR, JADX_SHA256, JADX_URL, REA_VERSION, RUNTIME_ROOT, runtimeReady, selectedPaths } from './environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = 'rea-reverse-engineering';

async function run(command, argv, env = environment()) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || code})`)));
  });
}

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function ensureJar() {
  if (existsSync(JADX_JAR) && await digest(JADX_JAR) === JADX_SHA256) return;
  await mkdir(dirname(JADX_JAR), { recursive: true });
  const temporary = `${JADX_JAR}.${process.pid}.partial`;
  try {
    console.log('Downloading the pinned headless JADX engine…');
    const response = await fetch(JADX_URL, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`JADX download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    if (await digest(temporary) !== JADX_SHA256) throw new Error('JADX checksum mismatch; the downloaded file was rejected.');
    await rename(temporary, JADX_JAR);
  } finally { await rm(temporary, { force: true }); }
}

async function installPlugin() {
  const destination = join(homedir(), '.codex', 'plugins', name);
  if (root !== destination) {
    if (existsSync(join(destination, 'plugin.json'))) {
      const previous = JSON.parse(await readFile(join(destination, 'plugin.json'), 'utf8'));
      if (previous.name !== name) throw new Error(`Another plugin occupies ${destination}`);
    }
    await cp(root, destination, { recursive: true,
      filter: source => basename(source) !== '__pycache__' && !source.endsWith('.pyc') });
  }
  const marketplacePath = join(homedir(), '.agents', 'plugins', 'marketplace.json');
  await mkdir(dirname(marketplacePath), { recursive: true });
  const previous = existsSync(marketplacePath) ? await readFile(marketplacePath, 'utf8') : null;
  const marketplace = previous ? JSON.parse(previous) : { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] };
  if (!Array.isArray(marketplace.plugins) || !marketplace.name) throw new Error('The personal marketplace has an invalid format.');
  const entry = {
    name,
    source: { source: 'local', path: `./.codex/plugins/${name}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Developer Tools',
  };
  const index = marketplace.plugins.findIndex(plugin => plugin.name === name);
  if (index === -1) marketplace.plugins.push(entry);
  else marketplace.plugins[index] = { ...marketplace.plugins[index], ...entry };
  if (previous) await writeFile(`${marketplacePath}.rea-backup-${Date.now()}`, previous);
  const temporary = `${marketplacePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(marketplace, null, 2) + '\n');
  await rename(temporary, marketplacePath);
  await run(process.env.CODEX_CLI_PATH || 'codex', ['plugin', 'add', `${name}@${marketplace.name}`, '--json']);
}

try {
  assertNode();
  if (args.some(arg => !['--engines', '--install'].includes(arg))) throw new Error('Usage: node scripts/setup.mjs [--engines] [--install]');
  if (args.includes('--engines')) {
    if (process.platform !== 'darwin') throw new Error('--engines currently supports macOS/Homebrew. Supply your own Ghidra and Java on other hosts.');
    await run('brew', ['install', 'ghidra', 'apktool', 'jadx', 'ripgrep'], { ...environment(), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' });
  }
  if (!runtimeReady()) {
    await mkdir(RUNTIME_ROOT, { recursive: true });
    await run('npm', ['install', '--prefix', RUNTIME_ROOT, '--no-audit', '--no-fund', '--save-exact', `rea-agents@${REA_VERSION}`]);
  }
  await ensureJar();
  if (args.includes('--install')) await installPlugin();
  console.log(JSON.stringify(selectedPaths(), null, 2));
  console.log('Ready. Start a new Codex chat or restart Codex to load newly installed plugin tools.');
} catch (error) {
  console.error(`REA setup: ${error.message}`);
  process.exitCode = 1;
}
