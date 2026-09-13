import { readFileSync } from 'fs';
import { join } from 'path';
import { renderHeroPng } from './cardImage';

export type BrandKind = 'success' | 'wait' | 'start' | 'vault' | 'scan' | 'process';

const FILE: Record<BrandKind, string> = {
  success: 'webhook-success-1080x560.jpg',
  wait: 'webhook-wait-1080x560.jpg',
  start: 'webhook-welcome-1080x560.jpg',
  vault: 'webhook-steps-1080x560.jpg',
  scan: 'webhook-ocr-1080x560.jpg',
  process: 'webhook-process-1080x560.jpg',
};

function fromDisk(name: string): Buffer | null {
  for (const root of [join(process.cwd(), 'assets/brand'), join(process.cwd(), 'public/brand')]) {
    try {
      return readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ root, name));
    } catch {
      /* next */
    }
  }
  return null;
}

export function brandCard(
  kind: BrandKind,
  d?: { hero?: string; sub?: string; meta?: string },
): Buffer {
  const disk = fromDisk(FILE[kind]);
  if (disk && disk.length > 100) return disk;
  const mapped = kind === 'success' ? 'settled' : kind === 'wait' || kind === 'process' ? 'locked' : 'vault';
  return renderHeroPng(mapped, {
    hero: d?.hero || (kind === 'success' ? 'DONE' : kind === 'wait' ? 'WAIT' : kind === 'scan' ? 'OCR' : 'CE VAULT'),
    sub: d?.sub,
    meta: d?.meta || 'CE',
  });
}

export function stickerKind(key: string): BrandKind | null {
  const k = String(key || '').toUpperCase();
  if (k === 'SUCCESS' || k === 'THANK_YOU') return 'success';
  if (k === 'OCR_DONE' || k === 'OCR') return 'scan';
  if (k === 'WAITING' || k === 'QUEUE') return 'wait';
  if (k === 'PROCESSING' || k === 'LOADING' || k === 'RETRY') return 'process';
  if (k === 'WELCOME') return 'start';
  return null;
}

export function heroPng(
  kind: 'vault' | 'locked' | 'settled',
  d?: { hero?: string; sub?: string; meta?: string },
): Buffer {
  if (kind === 'settled') return brandCard('success', d);
  if (kind === 'locked') return brandCard('wait', d);
  return brandCard('vault', d);
}
