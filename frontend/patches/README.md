# extract-zip 2.0.1 security patch

Electron's installer currently resolves `extract-zip@2.0.1`. Upstream has no
published patched release for [CVE-2026-19693](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)
and [CVE-2026-56876](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) as checked
on 2026-09-27. `pnpm-workspace.yaml` applies this patch and the lockfile pins its
hash. Do not remove it merely because installation works.

The patch checks paths before creating directories, rejects escaping link
targets, checks existing parent links, and creates files exclusively after
unlinking only an existing regular file. It never follows or overwrites a final
symlink. Internal relative framework links remain supported. `onEntry` mutations
are revalidated. Symlink content is limited to 4096 bytes.

Regression tests: `pnpm exec vitest run src/core/security/extract-zip.test.ts`.
Use a private extraction directory: this patch does not defend against another
local process concurrently replacing ancestor directories during extraction.
Version-based `pnpm audit` still reports both advisories; no ignore rule was added.
When upstream ships a fix, upgrade, rerun the tests (including on Linux/macOS),
and only then remove the patch.
