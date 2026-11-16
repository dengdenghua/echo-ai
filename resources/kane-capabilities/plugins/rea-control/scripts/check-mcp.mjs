import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the installed transport and tools, without relying on Codex's UI cache.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = process.argv[2];
if (!reportDir || !path.isAbsolute(reportDir)) throw new Error('Pass an absolute report directory.');
await mkdir(reportDir, { recursive: true });
const config = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8')).mcpServers.rea;
const child = spawn(config.command, config.args, {
  cwd: config.cwd, env: { ...process.env, ...config.env },
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let nextId = 1;
let buffer = '';
let stderr = '';
const pending = new Map();
child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
function failAll(error) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
child.on('error', failAll);
child.on('exit', (code, signal) => failAll(new Error(`MCP exited: ${code ?? signal}; ${stderr}`)));
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); }
    catch { failAll(new Error(`Non-JSON stdout: ${line.slice(0, 200)}`)); continue; }
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
});
function rpc(method, params, timeoutMs = 90000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
async function save(name, data) { await writeFile(path.join(reportDir, name), JSON.stringify(data, null, 2) + '\n'); }
try {
  const identity = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'rea-control-plugin-check', version: '0.1.0' },
  });
  notify('notifications/initialized');
  const tools = [];
  let cursor;
  do {
    const page = await rpc('tools/list', cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  const selectedNames = ['binary_session', 'analyze_javascript_application',
    'open_binary', 'procedure_pseudo_code', 'list_procedures', 'close_binary'];
  for (const name of selectedNames) {
    if (!tools.some(tool => tool.name === name)) throw new Error(`Required tool missing: ${name}`);
  }
  await save('tool-schemas.json', tools.filter(tool => selectedNames.includes(tool.name)));
  const session = await rpc('tools/call', { name: 'binary_session', arguments: {} });
  await save('binary-session.json', session);
  if (session.isError) throw new Error('binary_session returned isError; see binary-session.json.');
  const report = {
    checkedAt: new Date().toISOString(), transport: 'stdio', identity,
    toolCount: tools.length, toolNames: tools.map(tool => tool.name),
    binarySessionPassed: true,
  };
  if (process.argv[3] && process.argv[3] !== '-') {
    const args = JSON.parse(await readFile(process.argv[3], 'utf8'));
    const result = await rpc('tools/call', { name: 'analyze_javascript_application', arguments: args });
    await save('javascript-analysis.json', result);
    if (result.isError) throw new Error('JavaScript analysis returned isError; see javascript-analysis.json.');
    const evidence = result.structuredContent;
    if (!evidence?.evidence_id || evidence.operation !== 'analyze_javascript_application'
        || !evidence.normalized_result?.graph) {
      throw new Error('JavaScript call did not return an analysis evidence graph.');
    }
    report.javascriptAnalysisPassed = true;
    report.javascript = {
      evidenceId: evidence.evidence_id,
      sources: evidence.normalized_result.route_inventory?.sources?.map(source => ({
        path: source.path, status: source.status,
      })),
      graphEdgeCount: evidence.normalized_result.graph.edges.length,
    };
  }
  if (process.argv[4]) {
    const fixture = path.resolve(process.argv[4]);
    const provider = process.argv[5] || 'ghidra';
    try {
      console.log(`Opening native fixture with ${provider}...`);
      const opened = await rpc('tools/call', { name: 'open_binary', arguments: {
        path: fixture, provider_id: provider,
      } }, 450000);
      await save('native-open.json', opened);
      if (opened.isError) throw new Error('Native open failed; see native-open.json.');
      console.log('Requesting pseudocode for rea_smoke_add...');
      const pseudo = await rpc('tools/call', { name: 'procedure_pseudo_code', arguments: {
        procedure: 'rea_smoke_add',
      } }, 450000);
      await save('native-pseudocode.json', pseudo);
      if (pseudo.isError) throw new Error('Native decompilation failed; see native-pseudocode.json.');
      report.nativeDecompilationPassed = true;
      report.nativeProvider = provider;
    } finally {
      const closed = await rpc('tools/call', { name: 'close_binary', arguments: {} }, 450000);
      await save('native-close.json', closed);
      if (closed.isError) throw new Error('Native session cleanup failed; see native-close.json.');
    }
  }
  await save('mcp-check.json', report);
  console.log(JSON.stringify({ ...report, identity: identity.serverInfo, toolNames: undefined }, null, 2));
} finally {
  await writeFile(path.join(reportDir, 'server-stderr.log'), stderr);
  child.stdin.end();
  child.kill();
  failAll(new Error('MCP check closed.'));
}
