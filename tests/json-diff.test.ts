import { describe, expect, it } from "vitest";
import { diffJson } from "@/state/json-diff";

describe("diffJson", () => {
  it("reports added, removed, changed, and nested paths", () => {
    const diffs = diffJson(
      { a: 1, b: 2, nested: { c: "old" } },
      { a: 1, nested: { c: "new" }, d: true }
    );
    expect(diffs.map((diff) => `${diff.kind}:${diff.path}`).sort()).toEqual([
      "added:d",
      "changed:nested.c",
      "removed:b"
    ]);
  });
});
