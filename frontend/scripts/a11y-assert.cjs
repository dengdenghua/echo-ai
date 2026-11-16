const fs = require("node:fs");
const path = require("node:path");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/a11y-assert.cjs <report.json> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    failed = true;
    console.error(`${file}: report missing`);
    continue;
  }
  const report = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const violations = (report.reports ?? []).filter(
    (page) => page.violations.length > 0,
  );
  const keyboard = (report.keyboardChecks ?? []).filter(
    (check) => !check.pass,
  );
  if (violations.length || keyboard.length) {
    failed = true;
    for (const page of violations) {
      console.error(
        `${file} A11Y ${page.page}: ${page.violations.map((v) => v.id).join(", ")}`,
      );
    }
    for (const check of keyboard) {
      console.error(
        `${file} KEYBOARD ${check.name}${check.detail ? `: ${check.detail}` : ""}`,
      );
    }
  } else {
    console.log(
      `${file} ok: ${(report.reports ?? []).length} surfaces, ${(report.keyboardChecks ?? []).length} keyboard checks (${report.theme ?? "light"})`,
    );
  }
}

if (failed) process.exit(1);
