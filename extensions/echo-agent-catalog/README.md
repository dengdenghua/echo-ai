# Echo Agent Catalog

This is the Echo-owned catalog for on-demand roles. It contains the reviewed
digital employees, expert roles, and expert teams moved out of the local
runtime roster. Each role keeps its original `profile.jsonc`, prompt, skills,
and provenance metadata.

The runtime must treat this directory as a catalog source: show entries in the
unified Digital Employee / Expert Team directory, download a role only when
the user selects **Add**, and record the enabled role in the user's Echo
account. Catalog contents are not enabled merely because they are present
here.

The `agents/` tree is ready to publish as a separate `echo-agent-catalog`
GitHub repository. Do not put account state, private memories, credentials, or
model API keys in this repository.
