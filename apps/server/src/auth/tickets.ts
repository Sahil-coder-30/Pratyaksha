// One-time tickets for opening /mcp-ws. Browsers cannot set headers on a
// WebSocket, and a JWT in the URL would end up in logs, so the extension trades
// its JWT for a short-lived, single-use ticket and puts that in the URL.
// Async interface so a Redis store can replace the in-memory one later.
import { randomBytes } from "node:crypto";

export const TICKET_TTL_MS = 30_000;

export interface TicketStore {
  issue(userId: string): Promise<string>;
  // Returns the userId once. Unknown, used or expired tickets return undefined.
  consume(ticket: string): Promise<string | undefined>;
}

export class MemoryTicketStore implements TicketStore {
  private readonly tickets = new Map<string, { userId: string; expiresAt: number }>();

  constructor(private readonly ttlMs = TICKET_TTL_MS) {}

  async issue(userId: string): Promise<string> {
    this.sweep();
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(ticket, { userId, expiresAt: Date.now() + this.ttlMs });
    return ticket;
  }

  async consume(ticket: string): Promise<string | undefined> {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.userId;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}
