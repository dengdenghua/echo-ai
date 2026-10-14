# OpenAI Codex 0.162.0 third-party licenses

The Windows x64 desktop bundle contains four Codex executables represented by
three Rust package/component roots built from the OpenAI Codex `rust-v0.162.0`
source tag. Their normal-runtime license closures are recorded in the
component-specific HTML files beside this note:

- `THIRD_PARTY_LICENSES-codex-cli.html`
- `THIRD_PARTY_LICENSES-code-mode-host.html`
- `THIRD_PARTY_LICENSES-windows-sandbox.html`

The source tag resolves to commit
`c1382380de69521303b416720a52f42d51af6248`. Its original `codex-rs/Cargo.lock`
has SHA-256
`49fe417bcafe3f69f1f6636e23274f90d37e75e388127a76888c39001a4f8117`.
The reports were generated for `x86_64-pc-windows-msvc` with
`cargo-about 0.9.2`, the checked-in `cargo-about.toml`, and the checked-in
template.

That tagged source declares workspace version `0.162.0` while its locked local
workspace packages remain at `0.0.0`. The reproducible generator creates an
exact archive of the pinned commit and changes only the temporary
`[workspace.package]` version to `0.0.0`, allowing Cargo to honor the original
lock file with `--locked`. It verifies the lock hash before and after every
component report. No shipped source or dependency version is changed.

The bundled `rg.exe` is distributed separately by ripgrep and its license texts
are provided in the sibling `ripgrep` directory.
