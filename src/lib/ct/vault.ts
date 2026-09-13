import { supabaseAdmin } from '../supabaseAdmin';
import { opsRates } from './rates';
import { bannerDate, clockBkk, shortOf, ymdBkk } from './format';
import { vaultBanner, cardRecent, type VaultRow } from './copy';
import type { OutgoingMessage } from '../telegram';
import { dueUsdt as calcDue, stateFromSlip, tapeChip } from './state';
import { listOpenPending } from './store';
import { MAX_SLIP_THB } from './gate';
import { outgoingIndexKeys } from './settleGuard';
import { getRoom } from '../botSessions';
import { VaultEngine } from './vaultEngine';

function midnightIso(): string {
  const now = new Date();
  const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  bkk.setHours(0, 0, 0, 0);
  const offset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getTime();
  return new Date(bkk.getTime() + offset).toISOString();
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short',
  }).toUpperCase();
}

export type VaultMode = 'today' | 'pending' | 'all' | 'wait' | 'done' | 'err';

function chipOf(status: string): 'WAIT' | 'DONE' | 'ERR' | 'SENT' | 'HOLD' {
  if (status === 'HOLD') return 'HOLD';
  if (status === 'DONE') return 'DONE';
  if (status === 'ERR' || status === 'ERROR' || status === 'SCAN') return 'ERR';
  if (status === 'SENT') return 'SENT';
  return 'WAIT';
}

function isOpenWait(status: string): boolean {
  return status === 'WAIT' || status === 'SENT' || status === 'QUEUE' || status === 'LOCK';
}

function matchesFilter(mode: VaultMode, status: string, _pending: boolean): boolean {
  const chip = chipOf(status);
  if (mode === 'wait' || mode === 'pending') {
    return isOpenWait(status) || chip === 'WAIT' || chip === 'SENT' || chip === 'ERR' || chip === 'HOLD';
  }
  if (mode === 'done') return chip === 'DONE';
  if (mode === 'err') return chip === 'ERR' || chip === 'HOLD';
  return true;
}

function bannerModeOf(mode: VaultMode): 'today' | 'pending' | 'all' {
  if (mode === 'wait' || mode === 'pending') return 'pending';
  if (mode === 'all') return 'all';
  return 'today';
}

function isBkkToday(iso: string | null | undefined): boolean {
  if (!iso) return true;
  return ymdBkk(new Date(iso)) === ymdBkk();
}

function isErrChip(status: string): boolean {
  return status === 'ERR' || status === 'ERROR' || status === 'SCAN' || status === 'HOLD';
}

export async function loadVault(chatId?: number | null, mode: VaultMode = 'today') {
  const midnight = midnightIso();
  const roomCut = chatId != null ? (await getRoom(chatId)).dayCutAt : null;
  const cut = roomCut && roomCut > midnight ? roomCut : midnight;
  let insQ = supabaseAdmin
      .from('transactions')
      .select('id, ledger_ref, created_at, thb_amount, usdt_amount, sell_rate, status, chat_id, receiver_name, receiver_bank, receiver_last4')
      .eq('type', 'THB_DEPOSIT')
      .gte('created_at', cut)
      .order('created_at', { ascending: false });
  let outsQ = supabaseAdmin
      .from('transactions')
      .select('ledger_ref, created_at, usdt_amount')
      .eq('type', 'USDT_SEND')
      .gte('created_at', cut)
      .order('created_at', { ascending: false });
  if (chatId != null) {
    insQ = insQ.eq('chat_id', chatId);
    outsQ = outsQ.eq('chat_id', chatId);
  }
  const [{ data: ins }, { data: outs }, rates] = await Promise.all([
    insQ,
    outsQ,
    opsRates(chatId ?? 0),
  ]);

  const outByRef = new Map<string, { usdt: number | null; at: string }>();
  for (const o of outs ?? []) {
    const rec = { usdt: numOrNull(o.usdt_amount), at: o.created_at };
    for (const k of outgoingIndexKeys(String(o.ledger_ref || ''))) {
      if (!outByRef.has(k)) outByRef.set(k, rec);
    }
  }

  const inRows: VaultRow[] = [];
  let feeUsdt = 0;
  for (const r of ins ?? []) {
    const thb = numOrNull(r.thb_amount) ?? 0;
    const should = numOrNull(r.usdt_amount) ?? 0;
    const settled = outByRef.has(String(r.ledger_ref || ''));
    feeUsdt += Number((r as any).fee_usdt || 0);
    inRows.push({
      thb,
      usdt: should,
      time: fmtTime(r.created_at),
      short: shortOf(String(r.ledger_ref || '----')),
      pending: !settled,
    });
  }

  const outRows: VaultRow[] = (outs ?? []).map((o) => ({
    usdt: numOrNull(o.usdt_amount) ?? 0,
    time: fmtTime(o.created_at),
    short: shortOf(String(o.ledger_ref || '----')),
    pending: false,
  }));
  const outUsdt = outRows.reduce((s, r) => s + (r.usdt ?? 0), 0);
  const refs = (ins ?? []).map((r: any) => r.ledger_ref).filter(Boolean);
  const extraBy = new Map<string, { bank: string | null; name: string | null; last4: string | null }>();
  if (refs.length) {
    const { data: extras } = await supabaseAdmin
      .from('pending_slips')
      .select('ledger_ref, bank, name, account_masked')
      .in('ledger_ref', refs);
    for (const e of extras ?? []) {
      const d = String(e.account_masked ?? '').replace(/\D/g, '');
      extraBy.set(String(e.ledger_ref), {
        bank: e.bank ?? null,
        name: e.name ?? null,
        last4: d.length >= 4 ? d.slice(-4) : d || null,
      });
    }
  }
  const tape = (ins ?? []).map((r) => {
    const out = outByRef.get(String(r.ledger_ref || ''));
    const expectedUsdt = numOrNull(r.usdt_amount);
    const sentUsdt = out ? out.usdt : null;
    const state = stateFromSlip({ slipStatus: r.status, expectedUsdt, sentUsdt });
    const extra = extraBy.get(String(r.ledger_ref || ''));
    return {
      id: r.id,
      ledger: r.ledger_ref ?? null,
      short: shortOf(String(r.ledger_ref || '----')),
      thb: numOrNull(r.thb_amount),
      usdt: expectedUsdt ?? 0,
      expectedUsdt,
      dueUsdt: calcDue(expectedUsdt, sentUsdt),
      sentUsdt,
      createdAt: r.created_at ?? null,
      dateStamp: r.created_at ? fmtDate(r.created_at) : '\u2014',
      time: r.created_at ? fmtTime(r.created_at) : '\u2014',
      pending: state !== 'DONE',
      status: tapeChip(r.status, state),
      state,
      bank: r.receiver_bank ?? extra?.bank ?? null,
      name: r.receiver_name ?? extra?.name ?? null,
      last4: r.receiver_last4 ?? extra?.last4 ?? null,
    };
  });
  const seen = new Set(tape.map((r) => r.ledger || r.short));
  const openPending = await listOpenPending(chatId ?? null, 40);
  for (const p of openPending) {
    const key = p.ledger_ref || p.short_ref;
    if (seen.has(key) || seen.has(p.short_ref)) continue;
    seen.add(key);
    const last4 = String(p.account_masked ?? '').replace(/\D/g, '');
    const state = stateFromSlip({
      slipStatus: p.status,
      gate: p.status,
      expectedUsdt: p.should_send,
      sentUsdt: null,
    });
    tape.push({
      id: p.id,
      ledger: p.ledger_ref ?? null,
      short: p.short_ref,
      thb: p.thb_in,
      usdt: p.should_send ?? 0,
      expectedUsdt: p.should_send,
      dueUsdt: calcDue(p.should_send, null),
      sentUsdt: null,
      createdAt: p.created_at ?? null,
      dateStamp: p.created_at ? fmtDate(p.created_at) : '\u2014',
      time: p.created_at ? fmtTime(p.created_at) : clockBkk(),
      pending: p.status !== 'SETTLED',
      status: tapeChip(p.status, state),
      state,
      bank: p.bank,
      name: p.name,
      last4: last4.length >= 4 ? last4.slice(-4) : last4 || null,
    });
  }
  tape.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const dayTape = tape.filter((r) => isBkkToday(r.createdAt));
  const viewTape = (mode === 'today' ? dayTape : tape).filter((r) => matchesFilter(mode, r.status, r.pending));

  const counted = new Set<string>();
  let inThbDay = 0;
  let inCountDay = 0;
  let owedDay = 0;
  for (const r of dayTape) {
    const key = r.ledger || r.short;
    if (isErrChip(r.status)) continue;
    if (Number(r.thb || 0) > MAX_SLIP_THB) continue;
    if (counted.has(key)) continue;
    counted.add(key);
    const thb = Number(r.thb || 0);
    const usdt = Number(r.expectedUsdt ?? r.usdt ?? 0);
    inThbDay += thb;
    owedDay += usdt;
    inCountDay += 1;
  }
  let pendingAll = 0;
  const pendingShorts: string[] = [];
  const dueSeen = new Set<string>();
  for (const r of tape) {
    if (!isOpenWait(r.status)) continue;
    if (Number(r.thb || 0) > MAX_SLIP_THB) continue;
    const key = r.ledger || r.short;
    if (dueSeen.has(key)) continue;
    dueSeen.add(key);
    pendingAll += Number(r.dueUsdt ?? r.expectedUsdt ?? r.usdt ?? 0);
    pendingShorts.push(r.short);
  }
  const requiredUsdt = Math.round(owedDay * 100) / 100;
  const pendingUsdt = Math.max(0, Math.round(pendingAll * 100) / 100);
  const coinDelta = Math.round((outUsdt - owedDay) * 100) / 100;
  const viewRows = inRows.filter((r) => viewTape.some((t) => t.short === r.short));
  const kpi = VaultEngine.kpi(tape.map((row) => ({
    ledger: row.ledger,
    short: row.short,
    thb: row.thb,
    expectedUsdt: row.expectedUsdt,
    sentUsdt: row.sentUsdt,
    status: row.status,
    pending: row.pending,
  })));

  return {
    mode,
    dateLabel: bannerDate(),
    clock: clockBkk(),
    inThb: Math.round(inThbDay * 100) / 100,
    inCount: inCountDay,
    inRows: viewRows,
    outUsdt,
    outCount: outRows.length,
    outRows,
    requiredUsdt,
    pendingUsdt,
    coinDelta,
    feeUsdt: Math.round(feeUsdt * 100) / 100,
    desk: rates.desk || null,
    mkt: rates.mkt,
    pendingShorts,
    ymd: ymdBkk(),
    tape: viewTape,
    tapeAll: tape,
    kpi,
  };
}

export async function renderVault(chatId: number, mode: VaultMode = 'today'): Promise<OutgoingMessage> {
  const data = await loadVault(chatId, mode);
  return vaultBanner({ ...data, mode: bannerModeOf(mode) });
}

export async function renderRecent(chatId: number, adminLabel: string): Promise<OutgoingMessage> {
  const data = await loadVault(chatId, 'today');
  return cardRecent({
    adminLabel,
    rows: data.inRows.slice(0, 5).map((r) => ({
      thb: r.thb ?? 0,
      usdt: r.usdt ?? 0,
      desk: data.desk ?? 0,
      time: r.time,
      short: r.short,
      pending: r.pending,
    })),
    inThb: data.inThb,
    outUsdt: data.outUsdt,
    pendingUsdt: data.pendingUsdt,
  });
}
