import { recordIncoming, recordOutgoing } from '../transactions';
import { supabaseAdmin } from '../supabaseAdmin';
import { getRoom } from '../botSessions';
import { opsRates } from './rates';
import { shouldSend } from './format';
import { VaultEngine } from './vaultEngine';
import {
  listLockedToday,
  patchSlip,
  listOpenPending,
  markSettledIfLocked,
  type PendingSlip,
} from './store';
import { listPinnedBanks, matchPinnedBank } from '../banks';
import { dueUsdt } from './state';
import { MAX_SLIP_THB } from './gate';
import {
  HIGH_VALUE_THB,
  outgoingLedgerRef,
  settleBlockReason,
  isOcrJunkAmount,
  type SettleSkip,
} from './settleGuard';
import type { Admin } from '@/types/transactions';

export const BATCH_THB = 10_000;
export { HIGH_VALUE_THB, settleBlockReason };

export interface DueSummary {
  count: number;
  thb: number;
  expected: number;
  sent: number;
  due: number;
  usdt: number;
  target: number;
  remain: number;
  ready: boolean;
  refs: string[];
  skipped: Array<{ short: string; reason: SettleSkip }>;
  batchId: string | null;
}

function payeeLast4(mask?: string | null) {
  const d = String(mask ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : d || null;
}

export function batchProgress(thb: number, target = BATCH_THB) {
  const t = Math.max(0, Number(thb) || 0);
  return {
    thb: t,
    target,
    remain: Math.max(0, Math.round((target - t) * 100) / 100),
    ready: t + 1e-9 >= target,
  };
}

export function newBatchId(): string {
  return `B-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

async function findOutgoingForLedger(ledgerRef: string): Promise<{ id: string; usdt: number } | null> {
  const outRef = outgoingLedgerRef(ledgerRef);
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('id, ledger_ref, usdt_amount')
    .eq('type', 'USDT_SEND')
    .in('ledger_ref', [ledgerRef, outRef])
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { id: String(row.id), usdt: Number(row.usdt_amount || 0) };
}

export async function dueSummary(chatId: number): Promise<DueSummary> {
  const rows = await listLockedToday(chatId);
  const thb = Math.round(rows.reduce((s, r) => s + (r.thb_in ?? 0), 0) * 100) / 100;
  const expected = Math.round(rows.reduce((s, r) => s + (r.should_send ?? 0), 0) * 100) / 100;
  return {
    count: rows.length,
    expected,
    sent: 0,
    due: dueUsdt(expected, 0) ?? expected,
    usdt: expected,
    refs: rows.map((r) => r.short_ref),
    skipped: [],
    batchId: null,
    ...batchProgress(thb),
  };
}

export async function commitIncomingLock(
  p: PendingSlip,
  opts: { chatId: number; userId: number; admin: Admin; force: boolean; queued: boolean; confirmHigh?: boolean },
): Promise<PendingSlip> {
  if (p.status === 'LOCKED' || p.status === 'SETTLED') return p;
  if (!opts.force && !p.pin_match) throw new Error('PIN_MISMATCH');
  if (p.thb_in == null || p.thb_in <= 0) throw new Error('NO_AMOUNT');
  if (isOcrJunkAmount(p.thb_in)) throw new Error('AMOUNT_TOO_LARGE');
  if (p.thb_in >= HIGH_VALUE_THB && !opts.confirmHigh) throw new Error('HIGH_VALUE');
  const desk = p.desk_rate && p.desk_rate > 0
    ? p.desk_rate
    : (await opsRates(opts.chatId)).desk;
  if (!desk || desk <= 0) throw new Error('NO_DESK_RATE');
  const owed = VaultEngine.verifyReceive({ thb: p.thb_in, rate: desk, confidence: p.ocr_confidence, pinMatch: p.pin_match, qrVerified: false }).expectedUsdt;
  const room = await getRoom(opts.chatId);
  const last4 = payeeLast4(p.account_masked);
  const r = await recordIncoming({
    adminTelegramId: opts.userId,
    chatId: opts.chatId,
    thb: p.thb_in,
    sellRate: desk,
    marketRate: p.mkt_rate || desk,
    roomName: room.name,
    ledgerRef: p.ledger_ref,
    ocrConfidence: p.ocr_confidence,
    slipImageUrl: p.slip_url,
    slipFingerprint: p.slip_fingerprint,
    bankAccountId: p.bank_account_id,
    receiver: { name: p.name, bank: p.bank, last4 },
  });
  if (r.transactionId && (p.name || p.bank || last4)) {
    await supabaseAdmin.from('transactions').update({
      receiver_name: p.name,
      receiver_bank: p.bank,
      receiver_last4: last4,
    }).eq('id', r.transactionId);
  }
  return patchSlip(p.id, {
    status: 'LOCKED',
    tx_id: r.transactionId,
    should_send: owed,
    desk_rate: desk,
    undo_until: new Date(Date.now() + 30_000).toISOString(),
    pin_match: opts.force ? p.pin_match : true,
    note: opts.queued ? 'QUEUE' : p.note,
  });
}

export async function settleAllDue(
  chatId: number,
  userId: number,
  opts: { confirmHigh?: boolean; confirmMismatch?: boolean; dryRun?: boolean } = {},
): Promise<DueSummary> {
  const rows = await listLockedToday(chatId);
  const pins = await listPinnedBanks(chatId);
  const batchId = newBatchId();
  let sent = 0;
  const refs: string[] = [];
  const skipped: Array<{ short: string; reason: SettleSkip }> = [];

  for (const p of rows) {
    const block = settleBlockReason(p, pins, opts);
    if (block) {
      skipped.push({ short: p.short_ref, reason: block });
      continue;
    }
    const existing = await findOutgoingForLedger(p.ledger_ref);
    if (existing) {
      if (!opts.dryRun) await markSettledIfLocked(p.id, batchId);
      refs.push(p.short_ref);
      continue;
    }
    if (opts.dryRun) {
      refs.push(p.short_ref);
      sent += p.should_send ?? 0;
      continue;
    }
    try {
      await recordOutgoing({
        adminTelegramId: userId,
        chatId,
        usdt: p.should_send as number,
        ledgerRef: outgoingLedgerRef(p.ledger_ref),
        slipImageUrl: p.slip_url,
      });
    } catch (e: any) {
      const dup = /duplicate key|unique constraint|23505/i.test(String(e?.message ?? e));
      const again = dup ? await findOutgoingForLedger(p.ledger_ref) : null;
      if (!again) {
        console.warn('settle row failed', p.short_ref, e);
        skipped.push({ short: p.short_ref, reason: 'NOT_LOCKED' });
        continue;
      }
    }
    const claimed = await markSettledIfLocked(p.id, batchId);
    if (!claimed) {
      const again = await findOutgoingForLedger(p.ledger_ref);
      if (!again) {
        skipped.push({ short: p.short_ref, reason: 'ALREADY_SETTLED' });
        continue;
      }
    }
    sent += p.should_send ?? 0;
    refs.push(p.short_ref);
  }

  const thb = Math.round(rows.reduce((s, r) => s + (r.thb_in ?? 0), 0) * 100) / 100;
  const expected = Math.round(rows.reduce((s, r) => s + (r.should_send ?? 0), 0) * 100) / 100;
  sent = Math.round(sent * 100) / 100;
  return {
    count: refs.length,
    expected,
    sent,
    due: dueUsdt(expected, sent) ?? 0,
    usdt: sent,
    refs,
    skipped,
    batchId,
    ...batchProgress(thb),
    remain: 0,
    ready: false,
  };
}

export function canAutoQueue(gate: string, thb: number | null, desk: number): boolean {
  return gate === 'IN_READY' && thb != null && thb > 0 && thb <= MAX_SLIP_THB && desk > 0;
}

export async function rematchOpenSlips(chatId: number): Promise<{ matched: string[] }> {
  const pins = await listPinnedBanks(chatId);
  if (!pins.length) return { matched: [] };
  const open = await listOpenPending(chatId, 40);
  const matched: string[] = [];
  for (const p of open) {
    if (p.status !== 'PIN_MISMATCH' || p.pin_match) continue;
    const last4 = payeeLast4(p.account_masked);
    const hit = matchPinnedBank(p.bank, last4, pins);
    if (!hit) continue;
    const nextStatus = p.thb_in && p.thb_in > 0 ? 'IN_READY' : 'PIN_MISMATCH';
    await patchSlip(p.id, {
      pin_match: true,
      bank_account_id: hit.id,
      status: nextStatus,
    });
    matched.push(p.short_ref);
  }
  return { matched };
}
