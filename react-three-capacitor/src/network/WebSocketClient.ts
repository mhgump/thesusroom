import type { ClientMessage, ServerMessage } from './types';

type MessageHandler = (msg: ServerMessage) => void;
type CloseHandler = (event: CloseEvent) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private closeHandlers: Set<CloseHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    // Idempotent: do nothing if a socket is already open or connecting.
    // Prevents React StrictMode's double-invoke from opening two sockets.
    if (
      this.ws !== null &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        if (this.reconnectTimer !== null) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.handlers.forEach((h) => h(msg));
        } catch {
          // malformed message — ignore
        }
      };

      this.ws.onclose = (event) => {
        this.closeHandlers.forEach((h) => h(event));
        // Don't reconnect when the server explicitly terminated with a known code.
        if (event.code === 4004 || event.code === 4010) return;
        this.scheduleReconnect();
      };
      this.ws.onerror = () => this.scheduleReconnect();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  addHandler(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  addCloseHandler(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Nullify callbacks before closing so the onclose doesn't schedule a reconnect
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
