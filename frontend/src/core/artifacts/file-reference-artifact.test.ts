import { describe, expect, it } from "vitest";

import {
  artifactsNamed,
  findArtifactForFileReference,
} from "./file-reference-artifact";

const artifacts = [
  "workspace-output:final:hello.py",
  "workspace-output:final:README.md",
  "workspace-output:final:docs/guide.md",
  "workspace-output:output:notes/todo-list.txt",
];

describe("findArtifactForFileReference", () => {
  it("matches a bare file name the run produced", () => {
    expect(findArtifactForFileReference("hello.py", artifacts)).toBe(
      "workspace-output:final:hello.py",
    );
    expect(findArtifactForFileReference("guide.md", artifacts)).toBe(
      "workspace-output:final:docs/guide.md",
    );
  });

  it("matches the workspace paths an answer may cite", () => {
    for (const reference of [
      "output/final/hello.py",
      "./output/final/hello.py",
      "final/hello.py",
      "docs/guide.md",
      "/home/me/.echo/workspaces/t1/output/final/hello.py",
      "D:\\echo\\workspaces\\t1\\output\\final\\hello.py",
    ]) {
      expect(findArtifactForFileReference(reference, artifacts)).toMatch(
        /^workspace-output:final:/,
      );
    }
    expect(
      findArtifactForFileReference("output/notes/todo-list.txt", artifacts),
    ).toBe("workspace-output:output:notes/todo-list.txt");
  });

  it("leaves workspace files that only share a name alone", () => {
    expect(findArtifactForFileReference("src/hello.py", artifacts)).toBeNull();
    expect(findArtifactForFileReference("app.py", artifacts)).toBeNull();
    expect(findArtifactForFileReference("hello.py", [])).toBeNull();
  });

  it("needs a unique name when the reference has no directory", () => {
    const twins = [
      "workspace-output:final:a/report.md",
      "workspace-output:final:b/report.md",
    ];
    expect(findArtifactForFileReference("report.md", twins)).toBeNull();
    expect(findArtifactForFileReference("b/report.md", twins)).toBe(
      "workspace-output:final:b/report.md",
    );
  });

  it("understands legacy sandbox artifact paths", () => {
    const legacy = ["/mnt/user-data/outputs/hello.py"];
    expect(findArtifactForFileReference("hello.py", legacy)).toBe(legacy[0]);
    expect(findArtifactForFileReference("outputs/hello.py", legacy)).toBe(
      legacy[0],
    );
    expect(findArtifactForFileReference("lib/hello.py", legacy)).toBeNull();
  });
});

describe("artifactsNamed", () => {
  it("lists every artifact with the reference's file name", () => {
    expect(artifactsNamed("src/hello.py", artifacts)).toEqual([
      "workspace-output:final:hello.py",
    ]);
    expect(artifactsNamed("missing.py", artifacts)).toEqual([]);
  });
});
