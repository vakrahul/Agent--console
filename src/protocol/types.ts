export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ClientMessage =
  | { type: "USER_MESSAGE"; content: string }
  | { type: "PONG"; echo: string }
  | { type: "RESUME"; last_seq: number }
  | { type: "TOOL_ACK"; call_id: string };

export type ServerMessage =
  | { type: "TOKEN"; seq: number; text: string; stream_id: string }
  | { type: "TOOL_CALL"; seq: number; call_id: string; tool_name: string; args: JsonObject; stream_id: string }
  | { type: "TOOL_RESULT"; seq: number; call_id: string; result: JsonObject; stream_id: string }
  | { type: "CONTEXT_SNAPSHOT"; seq: number; context_id: string; data: JsonObject }
  | { type: "PING"; seq: number; challenge: string }
  | { type: "STREAM_END"; seq: number; stream_id: string }
  | { type: "ERROR"; seq: number; code: string; message: string };

export type ProtocolError = {
  kind: "PARSE_ERROR" | "VALIDATION_ERROR";
  message: string;
  raw: string;
  timestamp: number;
};

export type ProtocolEventType = ServerMessage["type"] | ClientMessage["type"] | "PROTOCOL_ERROR";

export type JournalEntry = {
  seq: number;
  type: ServerMessage["type"];
  timestamp: number;
  event: ServerMessage;
  replayed?: boolean;
};

export function getServerSeq(message: ServerMessage): number {
  return message.seq;
}
