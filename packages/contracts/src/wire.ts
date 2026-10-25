// BigFish wire protocol for the /mcp-ws socket.
// Every frame is one JSON envelope. "mcp" frames carry JSON-RPC for the MCP SDK.
// "ctl" frames (hello, ready, heartbeat) stay in the socket layer.
import { z } from "zod";

export const WIRE_VERSION = 1;
export const CONTRACTS_VERSION = 1;
// Contract versions this build can talk to.
export const SUPPORTED_CONTRACTS = { min: 1, max: 1 } as const;

export const WS_PATH = "/mcp-ws";
export const HELLO_TIMEOUT_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const HEARTBEAT_DEADLINE_MS = 45_000;
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

// App close codes live in 4000-4999. Standard ones are listed for clarity.
export const CloseCode = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  SERVICE_RESTART: 1012,
  UNAUTHORIZED: 4001,
  BAD_FRAME: 4002,
  REPLACED: 4003,
  HELLO_TIMEOUT: 4004,
  HEARTBEAT_TIMEOUT: 4005,
  INIT_FAILED: 4006,
  TOO_MANY_DEVICES: 4008,
  UPGRADE_REQUIRED: 4426,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

// Codes after which the extension must not reconnect on its own.
export const NO_RECONNECT_CODES: ReadonlySet<number> = new Set([
  CloseCode.REPLACED,
  CloseCode.TOO_MANY_DEVICES,
  CloseCode.UPGRADE_REQUIRED,
]);

const Hello = z.object({
  t: z.literal("hello"),
  deviceId: z.string().min(8).max(64),
  ext: z.string().max(32),
  contracts: z.number().int(),
});
const Ready = z.object({ t: z.literal("ready"), connId: z.string() });
const Heartbeat = z.object({ t: z.literal("hb") });

const Control = z.discriminatedUnion("t", [Hello, Ready, Heartbeat]);
export type Control = z.infer<typeof Control>;
export type Hello = z.infer<typeof Hello>;

// Only the JSON-RPC version is checked here. The MCP SDK validates the rest.
const JsonRpc = z.looseObject({ jsonrpc: z.literal("2.0") });

const Frame = z.discriminatedUnion("k", [
  z.object({ v: z.literal(WIRE_VERSION), k: z.literal("mcp"), m: JsonRpc }),
  z.object({ v: z.literal(WIRE_VERSION), k: z.literal("ctl"), c: Control }),
]);
export type Frame = z.infer<typeof Frame>;

export function encodeMcp(message: unknown): string {
  return JSON.stringify({ v: WIRE_VERSION, k: "mcp", m: message });
}

export function encodeCtl(control: Control): string {
  return JSON.stringify({ v: WIRE_VERSION, k: "ctl", c: control });
}

// Returns null for anything that is not a valid frame. The caller closes with BAD_FRAME.
export function decodeFrame(raw: string): Frame | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = Frame.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function isSupportedContracts(version: number): boolean {
  return version >= SUPPORTED_CONTRACTS.min && version <= SUPPORTED_CONTRACTS.max;
}
