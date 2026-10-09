/**
 * Ratchet on TypeScript type assertions (`value as T`, `<T>value`) in src/.
 *
 * An assertion tells the compiler to trust a shape nobody checked. Narrow
 * the value instead: a type guard (`isFoo(value): value is Foo`), a parse
 * function at the API boundary, an exact OpenAPI type, or a precise generic
 * argument. `as const` is not an assertion and is not counted.
 *
 * The baseline records the current count per file, plus the subset that are
 * double casts (`as unknown as T`). A file may not gain either, a new file
 * may not have any, and a file whose count dropped must lower its baseline
 * so the cleanup is locked in. Refresh the baseline with:
 *
 *   UPDATE_TYPE_ASSERTION_BASELINE=1 vitest run src/test/type-assertion-ratchet.test.ts
 *
 * Test files, `.d.ts` files and the generated OpenAPI types are excluded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SRC_ROOT = path.join(FRONTEND_ROOT, "src");
const BASELINE_PATH = path.join(
  FRONTEND_ROOT,
  "src/test/type-assertion-baseline.json",
);
const UPDATE_COMMAND =
  "UPDATE_TYPE_ASSERTION_BASELINE=1 vitest run src/test/type-assertion-ratchet.test.ts";
const SKIPPED_FILE = /\.(test|spec)\.tsx?$|openapi-types\.ts$|\.d\.ts$/;

type Counts = Record<string, number>;

interface Baseline {
  assertions: Counts;
  doubleCasts: Counts;
}

function isConstAssertion(type: ts.TypeNode): boolean {
  return (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "const"
  );
}

function isDoubleCast(node: ts.AssertionExpression): boolean {
  const inner = node.expression;
  return (
    (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) &&
    inner.type.kind === ts.SyntaxKind.UnknownKeyword
  );
}

function countFile(file: string): { assertions: number; doubleCasts: number } {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    kind,
  );
  let assertions = 0;
  let doubleCasts = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      !isConstAssertion(node.type)
    ) {
      assertions += 1;
      if (isDoubleCast(node)) doubleCasts += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { assertions, doubleCasts };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Baseline {
  const assertions: Counts = {};
  const doubleCasts: Counts = {};
  for (const file of sourceFiles(SRC_ROOT).sort()) {
    const rel = path.relative(FRONTEND_ROOT, file).split(path.sep).join("/");
    const counts = countFile(file);
    if (counts.assertions) assertions[rel] = counts.assertions;
    if (counts.doubleCasts) doubleCasts[rel] = counts.doubleCasts;
  }
  return { assertions, doubleCasts };
}

function toCounts(value: unknown): Counts {
  const counts: Counts = {};
  if (value && typeof value === "object") {
    for (const [rel, n] of Object.entries(value)) {
      if (typeof n === "number") counts[rel] = n;
    }
  }
  return counts;
}

function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return { assertions: {}, doubleCasts: {} };
  const parsed: unknown = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const sections = new Map<string, unknown>(
    parsed && typeof parsed === "object" ? Object.entries(parsed) : [],
  );
  return {
    assertions: toCounts(sections.get("assertions")),
    doubleCasts: toCounts(sections.get("doubleCasts")),
  };
}

function sum(counts: Counts): number {
  return Object.values(counts).reduce((total, n) => total + n, 0);
}

function diff(before: Counts, after: Counts) {
  const grew: string[] = [];
  const lowered: string[] = [];
  for (const rel of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[rel] ?? 0;
    const now = after[rel] ?? 0;
    if (now > was) grew.push(`${rel}: ${was} -> ${now}`);
    if (now < was) lowered.push(`${rel}: ${was} -> ${now}`);
  }
  return { grew: grew.sort(), lowered: lowered.sort() };
}

const current = scan();
const updating = Boolean(process.env.UPDATE_TYPE_ASSERTION_BASELINE);

if (updating) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
}

const baseline = updating ? current : readBaseline();

describe("type assertion ratchet", () => {
  for (const key of ["assertions", "doubleCasts"] as const) {
    const label =
      key === "assertions" ? "type assertions" : "`as unknown as` casts";
    const { grew, lowered } = diff(baseline[key], current[key]);

    it(`does not add ${label} (${sum(current[key])} in src/)`, () => {
      expect(
        grew,
        `These files gained ${label}. Narrow the value with a type guard, a ` +
          "parse function, an exact OpenAPI type or a precise generic " +
          "argument instead of asserting:\n" +
          grew.join("\n"),
      ).toEqual([]);
    });

    it(`locks in removed ${label}`, () => {
      expect(
        lowered,
        `These files dropped ${label}; lower the baseline with\n  ` +
          `${UPDATE_COMMAND}\n` +
          lowered.join("\n"),
      ).toEqual([]);
    });
  }
});
