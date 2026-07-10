import { randomInt } from "node:crypto";

/** JSON-RPC `id` for MCP `tools/call` requests. */
export function mcpToolsCallId(): number {
  return randomInt(1, 1_000_000_000);
}
