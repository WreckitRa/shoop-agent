import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseSecretKey, getSupabaseUrl } from "@/lib/auth/env";

let adminClient: SupabaseClient | null = null;

/**
 * Node 20 (and tooling under `tsx`) has no global WebSocket. Supabase JS still
 * constructs RealtimeClient at createClient() — admin/server paths never use
 * realtime, so a no-op transport is enough.
 */
function nodeCompatWebSocketTransport(): typeof WebSocket {
  if (typeof WebSocket !== "undefined") return WebSocket;

  class NodeCompatWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = NodeCompatWebSocket.CLOSED;
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    url = "";
    binaryType: BinaryType = "blob";
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
    constructor(_url: string | URL, _protocols?: string | string[]) {}
    close(_code?: number, _reason?: string) {
      this.readyState = NodeCompatWebSocket.CLOSED;
    }
    send(_data: string | ArrayBufferLike | Blob | ArrayBufferView) {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent(_event: Event) {
      return false;
    }
  }

  return NodeCompatWebSocket as unknown as typeof WebSocket;
}

/** Elevated Supabase client (secret key). Bypasses RLS — server routes only. */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        // Admin routes never subscribe — avoid requiring the `ws` package on Node 20.
        transport: nodeCompatWebSocketTransport(),
      },
    });
  }
  return adminClient;
}
