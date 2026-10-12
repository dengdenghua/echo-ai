import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export const PLUGIN_VERSION = '1.2.0';

export const REA_VERSION = '6.4.0';
export const JADX_VERSION = '0.7.1';
export const JADX_SHA256 = '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75';
export const JADX_URL = `https://github.com/1013503897/jadx-headless-mcp/releases/download/v${JADX_VERSION}/jadx-headless-mcp-${JADX_VERSION}-all.jar`;
export const DATA_ROOT = join(homedir(), '.local', 'share', 'rea-reverse-engineering');
export const RUNTIME_ROOT = join(DATA_ROOT, 'runtime');
export const REA_ROOT = join(RUNTIME_ROOT, 'node_modules', 'rea-agents');
export const JADX_JAR = join(homedir(), '.local', 'share', 'rea-engines', `jadx-headless-mcp-${JADX_VERSION}-all.jar`);

export function assertNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26)) {
    throw new Error('REA requires Node.js 22.19+, 24.11+, or 26+.');
  }
}

export function runtimeReady() {
  try {
    return JSON.parse(readFileSync(join(REA_ROOT, 'package.json'), 'utf8')).version === REA_VERSION
      && existsSync(join(REA_ROOT, 'dist', 'main.js'));
  } catch { return false; }
}

export function environment() {
  const env = { ...process.env };
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || join(homedir(), 'Library', 'Android', 'sdk');
  const prefixes = process.platform === 'darwin' ? ['/opt/homebrew', '/usr/local'] : ['/home/linuxbrew/.linuxbrew', '/usr/local'];
  const first = (paths) => paths.find(existsSync);
  const defaults = {
    JAVA_HOME: first([
      ...prefixes.map(p => join(p, 'opt', 'openjdk@21', 'libexec', 'openjdk.jdk', 'Contents', 'Home')),
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      ...prefixes.map(p => join(p, 'opt', 'openjdk@21', 'libexec', 'openjdk')),
    ]),
    GHIDRA_INSTALL_DIR: first(prefixes.map(p => join(p, 'opt', 'ghidra', 'libexec'))),
    REA_JADX_MCP_JAR: existsSync(JADX_JAR) ? JADX_JAR : undefined,
    REA_APKTOOL_COMMAND: first(prefixes.map(p => join(p, 'bin', 'apktool'))),
    REA_JADX_COMMAND: first(prefixes.map(p => join(p, 'bin', 'jadx'))),
    REA_PYTHON_COMMAND: first([...prefixes.map(p => join(p, 'bin', 'python3')), '/usr/bin/python3']),
    REA_ADB_PATH: first([join(sdk, 'platform-tools', 'adb'), ...prefixes.map(p => join(p, 'bin', 'adb'))]),
    REA_LOG_LEVEL: 'warn',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined && !env[key]) env[key] = value;
  }
  env.PATH = [...new Set([
    dirname(process.execPath),
    ...(env.JAVA_HOME ? [join(env.JAVA_HOME, 'bin')] : []),
    ...prefixes.map(p => join(p, 'bin')),
    join(sdk, 'platform-tools'),
    ...(env.PATH || '').split(delimiter).filter(Boolean),
  ])].join(delimiter);
  if (!env.REA_APKSIGNER_COMMAND) {
    // Discovery is deferred to the workspace worker, which selects an SDK build-tools version.
    env.REA_ANDROID_SDK = sdk;
  }
  return env;
}

export function selectedPaths(env = environment()) {
  return {
    rea_version: REA_VERSION,
    runtime_installed: runtimeReady(),
    runtime: REA_ROOT,
    node: process.execPath,
    java_home: env.JAVA_HOME || null,
    ghidra_install_dir: env.GHIDRA_INSTALL_DIR || null,
    jadx_mcp_jar: env.REA_JADX_MCP_JAR || null,
    apktool: env.REA_APKTOOL_COMMAND || null,
    jadx_cli: env.REA_JADX_COMMAND || null,
    python: env.REA_PYTHON_COMMAND || null,
    adb: env.REA_ADB_PATH || null,
  };
}
