# OpenCode Zen model adapter

Echo connects to OpenCode Zen as a model gateway, not as a local CLI agent.
The adapter uses Zen's OpenAI-compatible API at
`https://opencode.ai/zen/v1`; it never installs, launches, or scans for an
`opencode` executable.

## Lifecycle

1. Install **OpenCode Zen 模型适配器** from the plugin market.
2. Open the official Zen dashboard, create an API key, and paste it into the
   plugin connection dialog.
3. Echo validates the key against Zen's `/models` endpoint, adopts the model
   ids that endpoint currently serves, and saves the key in the encrypted
   connector credential store.
4. A secret-free `opencode-zen` entry is hot-registered in the normal model
   dispatcher. Streaming, tool calls, context budgeting, memory, approvals,
   and conversation state continue to be owned by Echo.
5. Disabling, disconnecting, or uninstalling the plugin removes its live model
   routes. Disconnecting and uninstalling also remove the stored credential.

The API key is never written to `custom_models.json` or returned to the
browser. That file contains only an opaque connector credential reference.

## Free-model and privacy boundary

Free status follows the provider's own prices, not a reviewed list: the
checked-in price snapshot decides a model that it knows, and a newly published
`*-free` id is still badged free because the snapshot necessarily lags the live
catalog. Kimi models are not treated as free. Some Zen free
endpoints may log requests or use submitted data for service/model improvement;
the connection dialog shows the provider-specific privacy warning before the
key is saved. Do not route secrets or confidential source code through a free
endpoint whose data policy is unsuitable for the workspace.

## Catalog refresh

`custom_models.json` stores the catalog discovered at connection time, so a
model the service publishes afterwards would stay invisible until somebody
reconnected the plugin by hand. Echo re-runs each connected adapter's own
`/models` discovery on a cadence and rewrites the snapshot in place:

- the first pass runs shortly after startup, then repeats every 6 hours;
- the provider's own `/models` stays the only source of candidates, so a
  refresh retires models as well as adding them;
- a failed or empty response leaves the previous catalog untouched, so an
  unreachable provider never empties the picker;
- `ECHO_MODEL_CATALOG_REFRESH_SECONDS=0` turns the loop off and leaves the
  manual reconnect as the only refresh path, and
  `ECHO_MODEL_CATALOG_REFRESH_INITIAL_DELAY_SECONDS` moves the first pass.
