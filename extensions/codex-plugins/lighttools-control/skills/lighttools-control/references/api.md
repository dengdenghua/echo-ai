# Local API reference and troubleshooting

Installation: `C:/Program Files/Optical Research Associates/LightTools 2026`. Override discovery with `LIGHTTOOLS_HOME` when another version is intended.

Vendor manuals:

- `Doc/APIReferenceGuide.pdf`: LTAPI4, data access, JumpStart, Python examples.
- `Doc/CommandReferenceGuide.pdf`: command syntax and prerequisites.
- `Help/api/*.html`, `Help/cmd/*_cmd.html`, `Help/dbhlp/*.html`: searchable local pages used by the MCP documentation tools.

The server uses an isolated virtual environment at `C:/Users/Administrator/.codex/runtimes/lighttools-control`, with the official MCP Python SDK 1.26.0 and pywin32. It serializes COM work on one STA worker and uses a named Windows mutex per PID across instances. This mutex coordinates these MCP instances; it does not prevent the user or unrelated COM clients from editing LightTools while a job runs.

Startup requires the machine's `OSG_LICENSE_FILE` environment variable to reach the child process. Codex configuration forwards it using `env_vars`; no license value is hardcoded or copied into the skill. The official SDK stdio client forwards only a small default environment, so diagnostics explicitly pass the relevant license variables. An existing session can still be queried without that variable, which can hide a startup-only configuration error.

The Core startup error observed on 2026-10-08 was traced to a stopped local license service: its log recorded loss of communication with `lmgrd` and exit at 13:46. The configured endpoint was `27000@127.0.0.1`, with no listener. Starting the existing `agileesofd License Server` service restored that port, both license daemons, and a successful LTAPI4 connection with Core checked out. This diagnosis does not establish a concurrent-session limit. For recurrence, inspect `Get-Service -Name 'agileesofd License Server'` and the configured endpoint; if that same service is stopped, `Start-Service -Name 'agileesofd License Server'` restores the existing configuration. Use the installed Keysight `lmutil.exe lmstat -c <configured-endpoint>` to check daemon status. Re-list LightTools PIDs after recovery and connect to the intended actual model window; a launcher process can also be named `lt.exe`.

To bind a running session, dynamically dispatch `LTCOM64.JSNET`, call `GetLTAPI4FromPID(pid)`, check its status, then use typed dispatch on the returned LTAPI4 object and verify `GetServerID()`. Avoid typed dispatch for JSNET: the installed type library generates a Python default `nan` without defining it. Do not patch vendor libraries to work around this.

Observed LTAPI4 Python return shapes:

| Method | Return |
|---|---|
| `GetServerID()` | integer PID, no status tuple |
| `Version`, `GetActiveView`, `DbGet`, `DbList`, `ListSize`, `ListNext`, `DbKeyStr` | `(value, status)` |
| `Cmd`, `DbSet`, `ListDelete`, `SetOption` | status integer |
| `DbKeyDump` | `(status, file_name)` |
| `GetMeshData` | `(status, values, cell_filter)` |

All wrapped calls check status `0`. An unexpected shape is an error, not a successful empty result. Error detail comes from `GetLastMsg(1)`.

For receiver `GetMeshData`, allocate `X_Dimension` outer lists and `Y_Dimension` inner values. The native array order is `values[x_index][y_index]`. The vendor Python example reverses those allocation dimensions, which only works for a square mesh; a live 8-by-5 test verified the corrected order. CSV rows are x indices and columns are y indices. Physical direction and coordinates still depend on the receiver's local axes.

Native SaveAs uses versioned names such as `sample.1.lts`. The server normalizes an unversioned requested path before checking whether the output exists and returns the actual file path; use that returned path when reopening the file.

On the tested disk-source/plane-receiver model, the `CellFlux` sum differed from `TotalPower` by about 1.36%, matching the native `TOTAL FLUX ERROR` value. Bulk `GetMeshData` and 40 individual 1-based `DbGet(CellFlux)` calls agreed. Preserve the two native quantities rather than forcing equality or silently renormalizing the mesh.

`DbList` allocates temporary database lists. Release them with `ListDelete(list_key)` (one input argument). Optional API argument counts differ among functions: use the vendor documentation and generated LTAPI4 signature rather than assuming all accept an output status argument.

Read job events at `C:/Users/Administrator/plugins/lighttools-control/logs/jobs.jsonl` if the MCP process restarted. Job IDs are scoped to the process. A restarted server cannot determine the outcome of a job solely from its lost in-memory status; inspect the model and event log before repeating writes.

The model replacement recovery copies are real native `.lts` files. SaveAs changes the current model's filename; return to the required output filename with another save to a new path if necessary. This first version checks PID, process creation time and current view, but it cannot provide transactional isolation against simultaneous manual edits.

Live verification script: `C:/Users/Administrator/plugins/lighttools-control/scripts/smoke_test.py`. Without `--live` it tests protocol discovery and documentation only. With `--live` it builds a test model, traces it, reads a rectangular receiver mesh, compares bulk data with individually indexed cells and the native flux error, exports CSV, saves/reopens `.lts`, and verifies stale views and overwrites are rejected. Default live mode launches an isolated LightTools session. Use a new output directory each time.

Nested read-only `lt_read_child_fields` accepts a root, parent/child filters and 1–10 fields per level. Parent limit is 1–10, child limit 1–5000, and requested parent_limit × child_limit × child-field count must not exceed 50000. Lists are released in reverse order even when child traversal fails. Temporary handles stay inside the job; paths and indices are scope/provenance, not permanent identity. Check each parent child_count/child_returned/child_truncated and every api_status before claiming complete coverage. A parent count field can disagree with the actual table; retain the discrepancy and check its version-specific purpose. Read relative spectral weights on their actual wavelength grid; conditional external interpolation is not proof of the vendor sampling implementation or absolute power. A fresh server must expose the tool; code installation does not refresh an existing desktop client.

For nested parent pagination, parent_offset is the number of native parent items skipped (wrapper offset 0-based; not a vendor field index). count is total parent-domain size, returned is this page size, and truncated describes remaining parents after the page. A last page with truncated=false can still omit preceding parents; use all_parents_returned or validate contiguous page indices and unchanged count/parent identity before claiming whole-domain coverage. The server keeps parent/child handles within each job. Between pages, preserve source SHA, view and model state; enumeration indices are not persistent identities.
