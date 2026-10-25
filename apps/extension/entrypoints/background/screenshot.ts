// Masked screenshots. The visible tab is captured, the local ML daemon finds
// the private data, and each spot is painted over with its vault token (like
// [EMAIL_7F3A]) before the image leaves the extension. This is the image
// version of the DOM text filter: the vault keeps the real value, and the
// model types the token, which is rehydrated at action time.
import { ErrorCode } from "@bigfish/contracts";
import { ML_URL } from "./config.js";
import { screenshotPlaceholder } from "../../safety/privacy.js";

export interface MaskRegion {
  id: string;
  category: string;
  // [x1, y1, x2, y2] in screenshot pixels.
  box: number[];
  text?: string | null;
  sources?: string[];
}

export interface MaskResponse {
  imageSize: { width: number; height: number };
  regions: MaskRegion[];
  readyForRelease: boolean;
}

export interface MaskedScreenshot {
  data: string;
  mimeType: string;
  width: number;
  height: number;
  // Placeholders painted on the image, in order of first appearance.
  tokens: string[];
}

export class ScreenshotError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

// OCR, NER and YOLO on a full screenshot take a few seconds on CPU.
const ML_TIMEOUT_MS = 30_000;
// Wider images cost the model more tokens without helping it read the page.
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.8;
// The fill reaches this far past the detected box, so glyph edges are covered too.
const PAD = 2;
const MIN_FONT_PX = 8;
const CAPTURE_RETRY_MS = 600;

const NO_DAEMON_HINT = "Start it with `pnpm dev:ml`, or use browser_snapshot instead.";

export async function captureMasked(windowId: number, origin: string, signal?: AbortSignal): Promise<MaskedScreenshot> {
  let dataUrl: string;
  try {
    dataUrl = await capture(windowId);
  } catch (err) {
    throw new ScreenshotError(
      ErrorCode.RESTRICTED_PAGE,
      `This page cannot be captured: ${err instanceof Error ? err.message : String(err)}`,
      "Use browser_snapshot instead.",
    );
  }

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const mask = await requestMask(dataUrl, bitmap, signal);
  return paint(bitmap, mask, origin);
}

// Chrome allows 2 captures per second. One over the quota waits and tries once more.
async function capture(windowId: number): Promise<string> {
  try {
    return await browser.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (err) {
    if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(err instanceof Error ? err.message : String(err))) throw err;
    await new Promise((r) => setTimeout(r, CAPTURE_RETRY_MS));
    return browser.tabs.captureVisibleTab(windowId, { format: "png" });
  }
}

async function requestMask(image: string, bitmap: ImageBitmap, signal?: AbortSignal): Promise<MaskResponse> {
  const timeout = AbortSignal.timeout(ML_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ML_URL}/v1/privacy/mask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, viewport: { width: bitmap.width, height: bitmap.height } }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.aborted) {
      throw new ScreenshotError(ErrorCode.TIMEOUT, "The ML privacy service did not answer in time.", "Try once more, or use browser_snapshot.");
    }
    throw new ScreenshotError(ErrorCode.ML_UNAVAILABLE, "The local ML privacy service is not running.", NO_DAEMON_HINT);
  }

  if (res.status === 503) {
    throw new ScreenshotError(ErrorCode.ML_UNAVAILABLE, "The ML privacy service is still loading its models, or a model failed.", "Wait a moment and try once more, or use browser_snapshot.");
  }
  if (!res.ok) {
    throw new ScreenshotError(ErrorCode.PRIVACY_BLOCKED, `The ML privacy service refused the screenshot (HTTP ${res.status}).`, "Use browser_snapshot instead.");
  }

  const mask = (await res.json()) as MaskResponse;
  // Something private was found but could not be located: the image is not safe to send.
  if (!mask.readyForRelease || !Array.isArray(mask.regions)) {
    throw new ScreenshotError(ErrorCode.PRIVACY_BLOCKED, "Private data on this page could not be fully masked.", "Use browser_snapshot instead.");
  }
  return mask;
}

async function paint(bitmap: ImageBitmap, mask: MaskResponse, origin: string): Promise<MaskedScreenshot> {
  // Boxes are in the pixels the daemon saw, which is the captured image.
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ScreenshotError(ErrorCode.PRIVACY_BLOCKED, "Could not draw the masked screenshot.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const tokens: string[] = [];
  for (const region of mask.regions) {
    const rect = scaledRect(region.box, scale, width, height);
    // A box that cannot be placed would leave its value visible: send nothing.
    if (!rect) throw new ScreenshotError(ErrorCode.PRIVACY_BLOCKED, `Mask region ${region.id} is invalid.`, "Use browser_snapshot instead.");
    const label = screenshotPlaceholder(region, origin);
    drawPlaceholder(ctx, rect, label);
    if (!tokens.includes(label)) tokens.push(label);
  }

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return { data: toBase64(new Uint8Array(await blob.arrayBuffer())), mimeType: "image/jpeg", width, height, tokens };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function scaledRect(box: number[], scale: number, width: number, height: number): Rect | null {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [x1, y1, x2, y2] = box as [number, number, number, number];
  if (x2 <= x1 || y2 <= y1) return null;
  const left = Math.max(0, Math.floor(x1 * scale) - PAD);
  const top = Math.max(0, Math.floor(y1 * scale) - PAD);
  const right = Math.min(width, Math.ceil(x2 * scale) + PAD);
  const bottom = Math.min(height, Math.ceil(y2 * scale) + PAD);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// Fills the box with the color around it, so the page still looks like a page,
// then writes the token inside, sized to fit.
function drawPlaceholder(ctx: OffscreenCanvasRenderingContext2D, rect: Rect, label: string): void {
  const [r, g, b] = borderColor(ctx, rect);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  const light = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  let size = Math.max(MIN_FONT_PX, Math.floor(rect.h * 0.75));
  ctx.font = `600 ${size}px monospace`;
  while (size > MIN_FONT_PX && ctx.measureText(label).width > rect.w - 2) {
    size--;
    ctx.font = `600 ${size}px monospace`;
  }

  ctx.save();
  // A label wider than its box is cut, never drawn over the page around it.
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = light ? "#1d4ed8" : "#bfdbfe";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + 1, rect.y + rect.h / 2);
  ctx.restore();
}

// Median color of the pixels just outside the box: the background the value sat on.
function borderColor(ctx: OffscreenCanvasRenderingContext2D, rect: Rect): [number, number, number] {
  const { width, height } = ctx.canvas;
  const x = Math.max(0, rect.x - 1);
  const y = Math.max(0, rect.y - 1);
  const w = Math.min(width, rect.x + rect.w + 1) - x;
  const h = Math.min(height, rect.y + rect.h + 1) - y;
  const { data } = ctx.getImageData(x, y, w, h);
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (row !== 0 && row !== h - 1 && col !== 0 && col !== w - 1) continue;
      const i = (row * w + col) * 4;
      channels[0].push(data[i]!);
      channels[1].push(data[i + 1]!);
      channels[2].push(data[i + 2]!);
    }
  }
  return channels.map((values) => {
    values.sort((a, b) => a - b);
    return values[values.length >> 1] ?? 255;
  }) as [number, number, number];
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
