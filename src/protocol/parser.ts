import type { JsonObject, ProtocolError, ServerMessage } from "./types";

type ParseResult = { ok: true; message: ServerMessage } | { ok: false; error: ProtocolError };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasSeq(value: JsonObject): value is JsonObject & { seq: number } {
  return isNumber(value.seq);
}

function validationError(raw: string, message: string): ParseResult {
  return { ok: false, error: { kind: "VALIDATION_ERROR", message, raw, timestamp: Date.now() } };
}

export function parseServerMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: { kind: "PARSE_ERROR", message: "Invalid JSON", raw, timestamp: Date.now() } };
  }

  if (!isObject(parsed) || !isString(parsed.type) || !hasSeq(parsed)) {
    return validationError(raw, "Message must be an object with type and seq");
  }

  switch (parsed.type) {
    case "TOKEN":
      if (isString(parsed.text) && isString(parsed.stream_id)) return { ok: true, message: parsed };
      break;
    case "TOOL_CALL":
      if (isString(parsed.call_id) && isString(parsed.tool_name) && isObject(parsed.args) && isString(parsed.stream_id)) {
        return { ok: true, message: parsed };
      }
      break;
    case "TOOL_RESULT":
      if (isString(parsed.call_id) && isObject(parsed.result) && isString(parsed.stream_id)) return { ok: true, message: parsed };
      break;
    case "CONTEXT_SNAPSHOT":
      if (isString(parsed.context_id) && isObject(parsed.data)) return { ok: true, message: parsed };
      break;
    case "PING":
      if (isString(parsed.challenge)) return { ok: true, message: parsed };
      break;
    case "STREAM_END":
      if (isString(parsed.stream_id)) return { ok: true, message: parsed };
      break;
    case "ERROR":
      if (isString(parsed.code) && isString(parsed.message)) return { ok: true, message: parsed };
      break;
  }

  return validationError(raw, `Invalid ${parsed.type} payload`);
}
