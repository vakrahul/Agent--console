import type { JsonObject, JsonValue } from "@/protocol/types";

export type DiffKind = "added" | "removed" | "changed";

export type JsonDiff = {
  path: string;
  kind: DiffKind;
  before?: JsonValue;
  after?: JsonValue;
};

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equalJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffJson(before: JsonObject | undefined, after: JsonObject): JsonDiff[] {
  const diffs: JsonDiff[] = [];

  function walk(path: string, left: JsonValue | undefined, right: JsonValue | undefined): void {
    if (left === undefined && right !== undefined) {
      diffs.push({ path, kind: "added", after: right });
      return;
    }
    if (left !== undefined && right === undefined) {
      diffs.push({ path, kind: "removed", before: left });
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) walk(path ? `${path}.${key}` : key, left[key], right[key]);
      return;
    }
    if (!equalJson(left, right)) {
      diffs.push({ path, kind: "changed", before: left, after: right });
    }
  }

  walk("", before, after);
  return diffs.filter((diff) => diff.path.length > 0);
}
