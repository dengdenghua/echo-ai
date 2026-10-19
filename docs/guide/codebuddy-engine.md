# CodeBuddy CLI execution engine

Echo can run a local conversation with the official CodeBuddy CLI, using the
same host task, journal, role instructions, tool broker and approval boundary
as the existing OpenCode integration.

Install the CLI with `npm install -g @tencent-ai/codebuddy-code`, then run
`codebuddy --setting-sources local` (or `codebuddy.cmd` in PowerShell), complete
`/login`, and choose the Chinese site. In Echo,
select a **CodeBuddy 官方积分** model from the conversation's unified model menu.
The selection binds the engine and model together. Codex, OpenCode and configured
API models appear in that same menu with their account/billing source. The model
menu uses the installed CLI's advertised official models, excluding custom-local
models. **Auto** follows the official CLI default. Explicit model selections are stored as `codebuddy/<model-id>`.

The Echo CLI also supports:

```console
echo code --engine codebuddy --cwd /path/to/project "Explain this project"
echo code --engine codebuddy --model codebuddy/hy3 "Answer this question"
```

`ECHO_CODEBUDDY_BIN` can select a particular official CLI installation. On
Windows, npm's `.cmd` entry is resolved to Node and the package's executable
without evaluating a shell command string. This integration uses a preinstalled
CLI; it does not add a vendored engine-store download.

## Ownership and limits

In **Settings → Models**, **Add connection → CodeBuddy** opens the official
account panel. **Sign in / Reauthorize** opens the official CLI on Windows;
enter `/login` and choose the Chinese site. Other platforms use the linked
official terminal instructions. Login remains owned by the CLI; Echo never
imports a token. **Refresh connection** rereads installation/model metadata;
only an actual conversation confirms that the account can make requests.

The remaining-credit button opens the official account's **Plans and usage**
page. Echo does not currently synchronize the balance and never converts token
counts to an estimated remaining allowance. Codex allowances remain in its
account panel; OpenCode connects to its official console for Zen/Go usage.

The default model in Settings uses the same model/source menu as conversations.
Choosing a default saves both its exact provider route and its execution engine
for new, unpicked conversations. Existing conversation choices stay in place.

- Only local deployments may inherit the machine's CLI account. Hosted
  deployments reject this engine before reading account configuration.
- CodeBuddy handles its login and upstream requests. Echo does not expose a
  substitute model API or copy its authentication token into a model provider.
- Echo uses the official Chinese site account and credits. Third-party endpoint,
  API key and model environment overrides are removed from the child process.
  User/project settings, hooks and MCP servers are excluded. The CLI receives
  `--setting-sources local` in a fresh directory: an empty sources argument
  actually restores the CLI's default scopes. The user's CLI settings stay intact.
  No credentials enter process arguments or Echo traces.
- The official CLI runs in a fresh temporary directory with no transcript
  persistence. Echo supplies bounded conversation history for each invocation.
- Only exact names from the current role's Echo tool catalog are exposed.
  `NoDefer` keeps those MCP tools callable without native tool discovery.
  Approvals, identity, workspace scope and cancellation remain in Echo.
- Execution stays bound to CodeBuddy through verification and repair; a failed
  invocation never silently switches to another engine.
- This adapter currently accepts text input. Image input is rejected by engine
  admission before execution. Team scheduling is performed by the host.
- Calls use the official account's billing. Authentication failure never falls
  back to a third-party API. No credit balance is inferred from token counts;
  check the official account's usage page for actual deductions.

## Verification

`tests/test_codebuddy_backend.py` covers stream reconciliation, tool identities,
failures, exact process arguments, cancellation and account isolation.
`tests/test_codebuddy_roles.py` checks authenticated host-tool identity.

The opt-in test below runs the installed official CLI against a local synthetic
model endpoint and the real Echo MCP transport. It checks that the model sees
only the host tool, calls it once, receives its result and completes. It uses no
cloud account, credentials or paid requests:

```console
ECHO_CODEBUDDY_LIVE=1 pytest tests/test_codebuddy_cli_live.py
```
