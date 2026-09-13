import { deflateSync } from 'zlib';

const W = 1080;
const H = 560;
const BG = [3, 8, 20];
const CYAN = [94, 231, 255];
const MINT = [30, 224, 138];
const AMBER = [245, 193, 74];
const INK = [232, 248, 255];
const MUTED = [138, 176, 196];
const PANEL = [8, 18, 34];

export type StillFrame = { data: Uint8Array | Buffer; width: number; height: number };

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(pixels: Buffer, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const dest = y * (w * 3 + 1);
    raw[dest] = 0;
    pixels.copy(raw, dest + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function px(buf: Buffer, x: number, y: number, rgb: number[]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = rgb[0];
  buf[i + 1] = rgb[1];
  buf[i + 2] = rgb[2];
}

function fill(buf: Buffer, x: number, y: number, w: number, h: number, rgb: number[]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) px(buf, xx, yy, rgb);
  }
}

function blend(buf: Buffer, x: number, y: number, rgb: number[], a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const t = Math.min(1, a);
  buf[i] = Math.round(buf[i] * (1 - t) + rgb[0] * t);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - t) + rgb[1] * t);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - t) + rgb[2] * t);
}

function glow(buf: Buffer, cx: number, cy: number, r: number, rgb: number[], strength: number) {
  const r2 = r * r;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d2 = x * x + y * y;
      if (d2 > r2) continue;
      const fall = 1 - Math.sqrt(d2) / r;
      blend(buf, cx + x, cy + y, rgb, fall * fall * strength);
    }
  }
}

function diamond(buf: Buffer, cx: number, cy: number, r: number, rgb: number[]) {
  for (let y = -r; y <= r; y++) {
    const span = r - Math.abs(y);
    for (let x = -span; x <= span; x++) px(buf, cx + x, cy + y, rgb);
  }
}

function ring(buf: Buffer, cx: number, cy: number, r: number, rgb: number[], a: number) {
  const r2 = (r + 1.6) * (r + 1.6);
  const inner = Math.max(0, r - 1.6);
  const inner2 = inner * inner;
  for (let y = -r - 2; y <= r + 2; y++) {
    for (let x = -r - 2; x <= r + 2; x++) {
      const d2 = x * x + y * y;
      if (d2 > r2 || d2 < inner2) continue;
      blend(buf, cx + x, cy + y, rgb, a);
    }
  }
}

function scanBeam(buf: Buffer, y: number, rgb: number[], x0 = 40, x1 = W - 40) {
  for (let x = x0; x < x1; x++) {
    const edge = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2));
    blend(buf, x, y - 10, rgb, 0.06 * edge);
    blend(buf, x, y - 6, rgb, 0.12 * edge);
    blend(buf, x, y - 2, rgb, 0.28 * edge);
    blend(buf, x, y, rgb, 0.75 * edge);
    blend(buf, x, y + 2, rgb, 0.28 * edge);
    blend(buf, x, y + 6, rgb, 0.12 * edge);
  }
}

function cornerBrackets(buf: Buffer, x: number, y: number, w: number, h: number, rgb: number[], arm = 36, t = 3) {
  fill(buf, x, y, arm, t, rgb);
  fill(buf, x, y, t, arm, rgb);
  fill(buf, x + w - arm, y, arm, t, rgb);
  fill(buf, x + w - t, y, t, arm, rgb);
  fill(buf, x, y + h - t, arm, t, rgb);
  fill(buf, x, y + h - arm, t, arm, rgb);
  fill(buf, x + w - arm, y + h - t, arm, t, rgb);
  fill(buf, x + w - t, y + h - arm, t, arm, rgb);
}

function tickBar(buf: Buffer, x: number, y: number, w: number, pct: number, on: number[], off: number[]) {
  const n = 16;
  const gap = 4;
  const tw = Math.max(2, Math.floor((w - gap * (n - 1)) / n));
  const fillN = Math.round(Math.max(0, Math.min(1, pct)) * n);
  for (let i = 0; i < n; i++) {
    fill(buf, x + i * (tw + gap), y, tw, 8, i < fillN ? on : off);
  }
}

function blitStill(buf: Buffer, still: StillFrame, dx: number, dy: number, dw: number, dh: number) {
  const src = still.data;
  const sw = still.width;
  const sh = still.height;
  if (sw < 2 || sh < 2 || dw < 2 || dh < 2) return;
  const srcRatio = sw / sh;
  const boxRatio = dw / dh;
  let rw = dw;
  let rh = dh;
  if (srcRatio > boxRatio) rh = Math.round(dw / srcRatio);
  else rw = Math.round(dh * srcRatio);
  const ox = dx + Math.floor((dw - rw) / 2);
  const oy = dy + Math.floor((dh - rh) / 2);
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / rh));
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / rw));
      const si = (sy * sw + sx) * 4;
      px(buf, ox + x, oy + y, [src[si], src[si + 1], src[si + 2]]);
    }
  }
}

function canvas(): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = BG[0]; buf[i + 1] = BG[1]; buf[i + 2] = BG[2];
  }
  return buf;
}

function chrome(buf: Buffer, accent: number[]) {
  glow(buf, 540, -40, 520, accent, 0.28);
  glow(buf, 980, 80, 280, accent, 0.16);
  glow(buf, 120, 90, 110, accent, 0.5);
  fill(buf, 0, 0, W, 3, accent);
  fill(buf, 0, 0, 4, H, accent);
  fill(buf, 0, H - 3, W, 3, accent);
  fill(buf, W - 4, 0, 4, H, accent);
  const GOLD = [212, 175, 88];
  const tick = 28;
  fill(buf, 18, 18, tick, 2, GOLD);
  fill(buf, 18, 18, 2, tick, GOLD);
  fill(buf, W - 18 - tick, 18, tick, 2, GOLD);
  fill(buf, W - 20, 18, 2, tick, GOLD);
  fill(buf, 18, H - 20, tick, 2, GOLD);
  fill(buf, 18, H - 18 - tick, 2, tick, GOLD);
  fill(buf, W - 18 - tick, H - 20, tick, 2, GOLD);
  fill(buf, W - 20, H - 18 - tick, 2, tick, GOLD);
  diamond(buf, 72, 64, 16, accent);
  ring(buf, 72, 64, 22, GOLD, 0.55);
}

// 5x7 glyphs, bit rows
const G: Record<string, number[]> = {
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [14, 17, 1, 6, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [14, 16, 30, 17, 17, 17, 14],
  '7': [31, 1, 2, 4, 4, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 17, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  P: [30, 17, 17, 30, 16, 16, 16],
  R: [30, 17, 17, 30, 20, 18, 17],
  W: [17, 17, 17, 21, 21, 27, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  '+': [0, 4, 4, 31, 4, 4, 0],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  I: [14, 4, 4, 4, 4, 4, 14],
  F: [31, 16, 16, 30, 16, 16, 16],
  H: [17, 17, 17, 31, 17, 17, 17],
  G: [14, 17, 16, 19, 17, 17, 14],
  X: [17, 17, 10, 4, 10, 17, 17],
  '.': [0, 0, 0, 0, 0, 4, 4],
  ',': [0, 0, 0, 0, 0, 4, 8],
  ':': [0, 4, 4, 0, 4, 4, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 14, 0, 0, 0],
  '#': [10, 31, 10, 31, 10, 0, 0],
  '%': [25, 26, 4, 8, 16, 11, 19],
  '/': [1, 2, 4, 4, 8, 16, 16],
  '*': [0, 4, 21, 14, 21, 4, 0],
  _: [0, 0, 0, 0, 0, 0, 31],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '?': [14, 17, 1, 2, 4, 0, 4],
};

function glyph(buf: Buffer, ch: string, x: number, y: number, s: number, rgb: number[]) {
  const rows = G[ch] || G[' '];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (rows[gy] & (16 >> gx)) fill(buf, x + gx * s, y + gy * s, s, s, rgb);
    }
  }
}

function text(buf: Buffer, str: string, x: number, y: number, s: number, rgb: number[]) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    glyph(buf, ch, cx, y, s, rgb);
    cx += 6 * s;
  }
}

export function renderHeroPng(kind: 'vault' | 'locked' | 'settled', d: {
  hero: string;
  sub?: string;
  meta?: string;
}): Buffer {
  const buf = canvas();
  const accent = kind === 'settled' ? MINT : kind === 'locked' ? AMBER : CYAN;
  chrome(buf, accent);
  text(buf, 'CE', 108, 42, 5, INK);
  const tag = kind === 'vault' ? 'VAULT' : kind === 'locked' ? 'WAIT' : 'DONE';
  fill(buf, 108, 88, tag.length * 14 + 20, 28, accent);
  text(buf, tag, 118, 92, 2, BG);
  fill(buf, 40, 132, W - 80, 2, accent);
  fill(buf, 48, 168, W - 96, 250, PANEL);
  glow(buf, 240, 250, 240, accent, 0.32);
  glow(buf, 240, 250, 90, accent, 0.22);
  scanBeam(buf, 300, accent);
  text(buf, d.hero.replace(/,/g, ''), 64, 196, 10, kind === 'settled' ? MINT : CYAN);
  if (d.sub) text(buf, d.sub.replace(/,/g, ''), 64, 330, 4, INK);
  if (d.meta) text(buf, d.meta.replace(/,/g, ''), 64, 468, 3, MUTED);
  return encodePng(buf, W, H);
}

export type ScanReadout = {
  amount?: string;
  payee?: string;
  time?: string;
  ref?: string;
  ocr?: string;
  payout?: string;
};

/** Wallet-News-style scan: still frame of the slip + sweeping cyan beam + OCR HUD. */
export function renderScanPng(opts: {
  still?: StillFrame | null;
  sweep: number;
  live?: boolean;
  readout?: ScanReadout | null;
}): Buffer {
  const buf = canvas();
  const accent = opts.live ? MINT : CYAN;
  chrome(buf, accent);
  text(buf, 'CE', 108, 42, 5, INK);
  const tag = opts.live ? 'LIVE' : 'SCAN';
  fill(buf, 108, 88, tag.length * 14 + 20, 28, accent);
  text(buf, tag, 118, 92, 2, BG);
  fill(buf, 40, 132, W - 80, 2, accent);

  const hasReadout = Boolean(
    opts.readout &&
      (opts.readout.amount || opts.readout.payee || opts.readout.time || opts.readout.ref || opts.readout.ocr || opts.readout.payout),
  );
  const hudW = hasReadout ? 360 : 0;
  const panelX = 48;
  const panelY = 150;
  const panelW = W - 96 - (hasReadout ? hudW + 16 : 0);
  const panelH = 360;
  fill(buf, panelX, panelY, panelW, panelH, PANEL);
  cornerBrackets(buf, panelX + 6, panelY + 6, panelW - 12, panelH - 12, accent, 34, 3);
  if (opts.still) {
    blitStill(buf, opts.still, panelX + 8, panelY + 8, panelW - 16, panelH - 16);
    for (let y = panelY; y < panelY + panelH; y++) {
      const edgeY = Math.min(y - panelY, panelY + panelH - y);
      const a = edgeY < 28 ? (1 - edgeY / 28) * 0.35 : 0.08;
      for (let x = panelX; x < panelX + panelW; x++) blend(buf, x, y, BG, a);
    }
  } else {
    const cx = panelX + Math.round(panelW / 2);
    const cy = 330;
    glow(buf, cx, cy, 220, accent, 0.28);
    ring(buf, cx, cy, 70, accent, 0.35);
    ring(buf, cx, cy, 120, accent, 0.22);
    ring(buf, cx, cy, 170, accent, 0.14);
    diamond(buf, cx, cy, 14, accent);
  }

  const t = Math.max(0, Math.min(1, opts.sweep));
  const beamY = panelY + 12 + Math.round(t * (panelH - 24));
  scanBeam(buf, beamY, accent, panelX + 4, panelX + panelW - 4);

  if (hasReadout && opts.readout) {
    const hx = panelX + panelW + 16;
    fill(buf, hx, panelY, hudW, panelH, PANEL);
    fill(buf, hx, panelY, 3, panelH, accent);
    let y = panelY + 18;
    const rows: Array<[string, string | undefined]> = [
      ['AMOUNT', opts.readout.amount],
      ['PAYEE', opts.readout.payee],
      ['TIME', opts.readout.time],
      ['REF', opts.readout.ref],
      ['PAYOUT', opts.readout.payout],
      ['OCR', opts.readout.ocr],
    ];
    for (const [label, value] of rows) {
      text(buf, label, hx + 16, y, 2, MUTED);
      const shown = (value || '....').replace(/,/g, '').slice(0, 18);
      text(buf, shown, hx + 16, y + 22, value ? 3 : 2, value ? INK : MUTED);
      y += 56;
    }
  }

  text(buf, opts.live ? 'STILL FRAME' : 'READING SLIP', 64, 524, 2, MUTED);
  tickBar(buf, 360, 528, 280, t, accent, MUTED);
  return encodePng(buf, W, H);
}
