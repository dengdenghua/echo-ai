# CodeBuddy CLI execution engine

Echo can run a local conversation with the official CodeBuddy CLI, using the
same host task, journal, role instructions, tool broker and approval boundary
as the existing OpenCode integration.

Install the CLI with `npm install -g @tencent-ai/codebuddy-code`, then run
`codebuddy` (or `codebuddy.cmd` in PowerShell) and complete `/login`. In Echo,
select **CodeBuddy** from the conversation's execution engine menu. The model
menu uses the installed CLI's advertised models. **Auto** follows that CLI's
current default. Explicit model selections are stored as `codebuddy/<model-id>`.

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

- Only local deployments may inherit the machine's CLI account. Hosted
  deployments reject this engine before reading account configuration.
- CodeBuddy handles its login and upstream requests. Echo does not expose a
  substitute model API or copy its authentication token into a model provider.
- The trusted user's supported authentication/model environment settings are
  passed to the official process. Other user/project settings, hooks and MCP
  servers are excluded. No credentials enter process arguments or Echo traces.
- The official CLI runs in a fresh temporary directory with no transcript
  persistence. Echo supplies bounded conversation history for each invocation.
- Only exact names from the current role's Echo tool catalog are exposed.
  `NoDefer` keeps those MCP tools callable without native tool discovery.
  Approvals, identity, workspace scope and cancellation remain in Echo.
- Execution stays bound to CodeBuddy through verification and repair; a failed
  invocation never silently switches to another engine.
- This adapter currently accepts text input. Image input is rejected by engine
  admission before execution. Team scheduling is performed by the host.
- Billing follows the CLI's selected configuration. A custom third-party model
  uses that provider's billing rather than CodeBuddy credits. No credit balance
  is inferred from token counts.

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
