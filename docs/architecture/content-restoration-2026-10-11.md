# Bundled content restoration

The source distribution was missing tracked content while its loaders, package
configuration and offline catalog tests still expected those packages. Restore
only absent files; retain every existing destination file and upstream license.

Sources reviewed on 2026-10-11:

- Echo OS commit `f35f298c`: creative skills and references, financial-services
  packages, Agnes image/video scripts, database-inspector and repo-audit.
- The OS connector submodule commit
  `cc020be5ad14ccfadde3b77bdf5b5e3d02f7a278`: connector SKILL.md files and their
  referenced resources. The AI checkout keeps its existing flattened layout.

In total, 2,074 missing files were restored with byte-for-byte SHA256 comparison
against those Git objects. The restored creative catalog contains 58 skills,
financial-services contains 51 SKILL.md files, and the connector catalog contains
319 SKILL.md files. This does not activate financial twin presets: their intentional
move to `extensions/echo-agent-catalog` in commit `42fbe67b` remains in effect.

Content validation covers catalog discovery and source/wheel inclusion. The
standalone database explorer opens SQLite read-only and uses PRAGMA table_info
for schema introspection; it is not a runtime schema migration.
