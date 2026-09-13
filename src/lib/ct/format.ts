import { divideMoney } from '../money';
import { randomBytes } from 'crypto';
import { escapeTelegramHtml } from '../botSecurity';
import { RULE, quote } from './tokens';

export const DIV = RULE;
const BKK = 'Asia/Bangkok';

export function esc(s: unknown): string {
  return escapeTelegramHtml(s);
}

export function nowBkk(): Date {
  return new Date();
}

export function ymdBkk(d = nowBkk()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BKK, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}${g('month')}${g('day')}`;
}

export function clockBkk(d = nowBkk()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BKK, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function bannerDate(d = nowBkk()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BKK, day: '2-digit', month: 'short',
  }).format(d);
}

export function makeRef(d = nowBkk()): { ymd: string; short: string; ledger: string } {
  const ymd = ymdBkk(d);
  const short = randomBytes(2).toString('hex').toUpperCase();
  return { ymd, short, ledger: `CE-${ymd}-${short}` };
}

export function displayLedger(ledger: string): string {
  const bare = ledger.replace(/^#/, '');
  return `#${bare}`;
}

export function shortOf(ledger: string): string {
  const m = ledger.replace(/^#/, '').match(/-([A-F0-9]{4})$/i);
  return (m?.[1] ?? ledger.slice(-4)).toUpperCase();
}

export function maskAcct(last4: string | null | undefined): string {
  const t = (last4 ?? '').replace(/\D/g, '').slice(-4);
  return t ? `••••${t}` : '••••????';
}

/** Full account as printed. Never hide digits. */
export function showAcct(acct: string | null | undefined): string {
  const raw = String(acct ?? '').replace(/[•*]+/g, '').trim();
  if (!raw || raw === '????') return '—';
  return raw;
}

export function thbInt(n: number): string {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(v));
}

export function thbCard(n: number): string {
  return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function usdt(n: number): string {
  return (Number(n) || 0).toFixed(2);
}

export function rateCode(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

export function shouldSend(thb: number, desk: number): number {
  return divideMoney(thb, desk);
}

export type BtnStyle = 'success' | 'primary' | 'danger';

export function pnlThb(thb: number, usdtAmt: number, desk: number, mkt: number | null): number | null {
  if (!mkt || mkt <= 0 || !usdtAmt || usdtAmt <= 0) return null;
  return Math.round(usdtAmt * (desk - mkt));
}

export function quoteBlock(d: { thb: number; usdt: number; desk: number; mkt: number | null }): string {
  const p = pnlThb(d.thb, d.usdt, d.desk, d.mkt);
  const pnl = p == null ? '—' : `${p >= 0 ? '+' : ''}${thbInt(p)} THB`;
  const rate = rateCode(d.desk);
  return quote(
    [
      'ฝาก',
      `<b>${thbCard(d.thb)} THB</b>`,
      '',
      `ตีเป็น USDT ที่เรท ${rate}`,
      `<b>${usdt(d.usdt)} USDT</b>`,
      '',
      'กำไร',
      `<b>${pnl}</b>`,
      '',
      `เราขาย <code>${rate}</code>  ·  เรทอ้างอิง <code>${rateCode(d.mkt)}</code>`,
    ].join('\n'),
  );
}

export function totalsBanner(d: { inThb: number; outUsdt: number; pendingUsdt: number }): string {
  return quote(
    [
      '<b>ผลรวมวันนี้</b>',
      '',
      `ฝาก          <b>${thbInt(d.inThb)} THB</b>`,
      `ส่งแล้ว       <b>${usdt(d.outUsdt)} USDT</b>`,
      `ค้างเคลียร์    <b>${usdt(d.pendingUsdt)} USDT</b>`,
    ].join('\n'),
  );
}

export function deskUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://ce-vault.vercel.app';
  if (raw.startsWith('https://') && !/localhost/.test(raw)) return raw.replace(/\/$/, '');
  return 'https://ce-vault.vercel.app';
}

export function btn(text: string, callback_data: string, style?: BtnStyle) {
  return style ? { text, callback_data, style } : { text, callback_data };
}

export function urlBtn(text: string, url: string) {
  return { text, url };
}

export function webAppBtn(text: string, url: string) {
  return { text, web_app: { url } };
}

const DEFAULT_MINIAPP = 'https://ce-empire-miniapp.vercel.app';

export type MiniAppScreen = 'vault' | 'io' | 'done';
export type MiniAppSnap = {
  thb?: number;
  count?: number;
  rate?: number;
  sent?: number | null;
  state?: string;
};

export function miniAppUrl(screen: MiniAppScreen = 'vault', snap?: MiniAppSnap): string {
  const raw = (process.env.NEXT_PUBLIC_MINIAPP_URL || process.env.MINIAPP_URL || DEFAULT_MINIAPP).replace(/\/$/, '');
  const base = raw.startsWith('https://') && !/localhost/.test(raw) ? raw : DEFAULT_MINIAPP;
  const q = new URLSearchParams();
  q.set('screen', screen);
  if (snap) {
    if (Number.isFinite(snap.thb)) q.set('thb', String(Math.round(Number(snap.thb) * 100) / 100));
    if (Number.isFinite(snap.count)) q.set('n', String(Math.max(0, Math.round(Number(snap.count)))));
    if (Number.isFinite(snap.rate) && Number(snap.rate) > 0) q.set('rate', String(Number(snap.rate)));
    if (snap.sent != null && Number.isFinite(snap.sent)) q.set('sent', String(Math.round(Number(snap.sent) * 100) / 100));
    if (snap.state) q.set('st', String(snap.state).slice(0, 12));
  }
  return `${base}/?${q.toString()}`;
}

export function ik(rows: Array<Array<Record<string, unknown>>>) {
  return { inline_keyboard: rows };
}

export function adminKeyboard() {
  return {
    keyboard: [
      [{ text: 'ยอดวันนี้' }, { text: 'รอส่ง' }, { text: 'อัตรา' }],
      [{ text: 'บัญชีรับ' }, { text: 'ตั้งค่า' }, { text: 'วันใหม่' }],
      [{ text: 'เลือกห้อง' }, { text: 'เปิด VAULT', web_app: { url: miniAppUrl('vault') } }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}
