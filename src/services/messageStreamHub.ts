




import { Message } from "../types/index.ts";
import {
  STREAM_HEADER_USER_ID,
  STREAM_HEADER_CLIENT_ID,
  STREAM_HEADER_TOKEN_LOOKUP,
  type StreamClientBinding
} from "./streamClientActivity.ts";


export interface MessageStreamHub {
  connect(
    userId: number,
    clientId: number | undefined,
    request: Request,
    binding?: StreamClientBinding
  ): Promise<Response>;
  disconnectClient(userId: number, clientId: number): Promise<void>;
  broadcast(userId: number, message: Message): Promise<void>;
}


export class DurableObjectMessageStreamHub implements MessageStreamHub {
  constructor(private namespace: DurableObjectNamespace) {}


  private getStub(userId: number): DurableObjectStub {
    const id = this.namespace.idFromName(`user:${userId}`);
    return this.namespace.get(id);
  }











  async connect(
    userId: number,
    clientId: number | undefined,
    request: Request,
    binding?: StreamClientBinding
  ): Promise<Response> {
    const stub = this.getStub(userId);
    const connectUrl = new URL(request.url);
    connectUrl.protocol = "https:";
    connectUrl.hostname = "message-stream-hub.internal";
    connectUrl.pathname = "/connect";

    connectUrl.search = clientId === undefined ? "" : `?clientId=${encodeURIComponent(String(clientId))}`;

    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.delete("x-gotify-key");
    headers.delete("cookie");
    for (const name of [...headers.keys()]) {
      if (name.startsWith("x-woe-stream-")) headers.delete(name);
    }
    if (binding) {
      headers.set(STREAM_HEADER_USER_ID, String(binding.userId));
      headers.set(STREAM_HEADER_CLIENT_ID, String(binding.clientId));
      headers.set(STREAM_HEADER_TOKEN_LOOKUP, binding.tokenLookup);
    }

    return stub.fetch(new Request(connectUrl.toString(), { method: request.method, headers }));
  }

  async disconnectClient(userId: number, clientId: number): Promise<void> {
    const stub = this.getStub(userId);
    const response = await stub.fetch(
      new Request(`https://message-stream-hub.internal/disconnect?clientId=${encodeURIComponent(String(clientId))}`, {
        method: "POST",
      })
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Message stream disconnect failed with status ${response.status}: ${body}`);
    }
  }


  async broadcast(userId: number, message: Message): Promise<void> {
    const stub = this.getStub(userId);
    const response = await stub.fetch(
      new Request("https://message-stream-hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Message stream broadcast failed with status ${response.status}: ${body}`);
    }
  }
}
