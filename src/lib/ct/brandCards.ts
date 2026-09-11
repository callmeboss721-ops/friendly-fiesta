import { readFileSync } from 'fs';
import { join } from 'path';
import { renderHeroPng } from './cardImage';

export type BrandKind = 'success' | 'wait' | 'start' | 'vault';

const FILE: Record<BrandKind, string> = {
  success: 'webhook-success-1080x560.jpg',
  wait: 'webhook-wait-1080x560.jpg',
  start: 'og-1200x630.jpg',
  vault: 'og-1200x630.jpg',
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
  const mapped = kind === 'success' ? 'settled' : kind === 'wait' ? 'locked' : 'vault';
  return renderHeroPng(mapped, {
    hero: d?.hero || (kind === 'success' ? 'DONE' : kind === 'wait' ? 'WAIT' : 'CE VAULT'),
    sub: d?.sub,
    meta: d?.meta || 'CE',
  });
}

export function stickerKind(key: string): BrandKind | null {
  const k = String(key || '').toUpperCase();
  if (k === 'SUCCESS' || k === 'OCR_DONE' || k === 'THANK_YOU' || k === 'VIP') return 'success';
  if (k === 'WAITING' || k === 'QUEUE') return 'wait';
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
