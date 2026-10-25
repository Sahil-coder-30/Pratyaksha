// GET /mcp-ws: the extension dials in here. The extension is the MCP server,
// this side is the MCP client. requireTicket checks the one-time ticket and the
// Origin before the upgrade. ServerSocket then runs the handshake, and a
// DeviceSession connects an MCP Client over the socket and joins the registry.
import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { NodeWebSocket } from "@hono/node-ws";
import { ApiErrorCode, CloseCode, type Hello } from "@bigfish/contracts";
import { HandshakeError, ServerSocket, type FramedTransport, type ServerSocketOptions } from "@bigfish/mcp-ws";
import type { UserEnv } from "../auth/middleware.js";
import type { TicketStore } from "../auth/tickets.js";
import { DeviceSession } from "../mcp/session.js";
import { MAX_DEVICES_PER_USER, type SessionRegistry } from "../mcp/registry.js";

export type SocketTuning = Partial<
  Pick<ServerSocketOptions, "helloTimeoutMs" | "heartbeatIntervalMs" | "heartbeatDeadlineMs">
>;

export interface McpWsOptions {
  registry: SessionRegistry;
  socket?: SocketTuning;
}

// Runs before the upgrade, so a bad ticket gets a plain HTTP 401 and no socket.
// extensionOrigin unset (dev only) skips the Origin check.
export function requireTicket(tickets: TicketStore, extensionOrigin?: string): MiddlewareHandler<UserEnv> {
  return async (c, next) => {
    // Consume first, so a ticket tried from a wrong Origin is burned too.
    const ticket = c.req.query("ticket");
    const userId = ticket ? await tickets.consume(ticket) : undefined;
    if (!userId) {
      return c.json({ ok: false, code: ApiErrorCode.UNAUTHORIZED, message: "Missing, used or expired ticket." }, 401);
    }
    if (extensionOrigin && c.req.header("origin") !== extensionOrigin) {
      return c.json({ ok: false, code: ApiErrorCode.UNAUTHORIZED, message: "Origin not allowed." }, 403);
    }
    c.set("userId", userId);
    await next();
  };
}

export function mcpWsHandler(upgradeWebSocket: NodeWebSocket["upgradeWebSocket"], opts: McpWsOptions) {
  return upgradeWebSocket((c) => {
    const connId = randomUUID();
    // Set by requireTicket.
    const userId: string = c.get("userId");
    let socket: ServerSocket | null = null;

    // A device that is already connected may reconnect (it replaces itself).
    function checkDeviceLimit(deviceId: string): void {
      const others = opts.registry.listForUser(userId).filter((s) => s.info.deviceId !== deviceId);
      if (others.length >= MAX_DEVICES_PER_USER) {
        throw new HandshakeError(CloseCode.TOO_MANY_DEVICES, `max ${MAX_DEVICES_PER_USER} devices per user`);
      }
    }

    async function attach(transport: FramedTransport, hello: Hello): Promise<void> {
      try {
        const session = await DeviceSession.open(transport, {
          connId,
          userId,
          deviceId: hello.deviceId,
          ext: hello.ext,
        });
        if (session.state === "closed") return;
        // Check again: another device of this user may have joined during MCP init.
        try {
          checkDeviceLimit(hello.deviceId);
        } catch (err) {
          session.close(CloseCode.TOO_MANY_DEVICES, (err as Error).message);
          return;
        }
        opts.registry.add(session);
        console.log(`[BigFish] device ${hello.deviceId} connected for ${userId} (${session.tools.length} tools, ext ${hello.ext})`);
        session.onClose(() => console.log(`[BigFish] device ${hello.deviceId} disconnected`));
      } catch (err) {
        console.warn(`[BigFish] device ${hello.deviceId} failed MCP init:`, err instanceof Error ? err.message : err);
      }
    }

    return {
      onOpen(_event, ws) {
        socket = new ServerSocket(
          {
            send: (text) => ws.send(text),
            close: (code, reason) => ws.close(code, reason),
            terminate: () => ws.raw?.terminate(),
          },
          {
            connId,
            ...opts.socket,
            onHello: (hello) => checkDeviceLimit(hello.deviceId),
            onReady: (transport, hello) => void attach(transport, hello),
          },
        );
      },
      onMessage(event) {
        if (typeof event.data !== "string") {
          socket?.close(CloseCode.BAD_FRAME, "binary frames not supported");
          return;
        }
        socket?.receive(event.data);
      },
      onClose() {
        socket?.socketClosed();
      },
    };
  });
}
