#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNode, environment, REA_ROOT, runtimeReady, selectedPaths } from './environment.mjs';

try {
  assertNode();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--paths') {
    process.stdout.write(JSON.stringify(selectedPaths(), null, 2) + '\n');
  } else if (args[0] === 'deep-mcp' || args[0] === 'deep' || args[0] === 'deep-help') {
    Object.assign(process.env, environment());
    const { deepMain } = await import('./deep.mjs');
    await deepMain(args);
  } else {
    if (!runtimeReady()) throw new Error('REA runtime is missing or has the wrong version. Run node scripts/setup.mjs from the plugin directory.');
    Object.assign(process.env, environment());
    const entry = join(REA_ROOT, 'scripts', 'rea.mjs');
    process.argv = [process.execPath, entry, ...args];
    // Load in this process so MCP stdin and REA signal/child-process cleanup remain intact.
    await import(pathToFileURL(entry).href);
  }
} catch (error) {
  process.stderr.write(`REA plugin: ${error.message}\n`);
  process.exitCode = 1;
}
