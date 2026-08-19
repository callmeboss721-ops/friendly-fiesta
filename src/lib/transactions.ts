// ============================================================
// Service กลางสำหรับบันทึกธุรกรรม — ใช้ร่วมกันทั้ง API route และ Telegram webhook
// ============================================================
import { supabaseAdmin } from './supabaseAdmin';
import { calculateDepositProfit, ProfitResult, round2, thbToUsdt, usdtToThb } from './profit';
import { calculateFee, FeeResult } from './fees';
import { fetchBinanceThUsdtRate } from './binance';
import { notifyIncome, notifyOutflow, notifyEdit, notifyDelete } from './notifier';
import type { Admin } from '@/types/transactions';
import { newLedgerRef } from './ledgerRef';

// ─── RATE CACHE (30s) เพื่อลด Binance API calls ───
let cachedRates: { sellRate: number; marketUsdtRate: number; marketSource: MarketSource } | null = null;
let ratesCacheTime = 0;
const RATES_CACHE_TTL = 30000; // 30 วินาที

function newLedgerReference(): string {
  return newLedgerRef();
}

export class AdminNotFoundError extends Error {
  constructor() {
    super('ADMIN_NOT_FOUND');
    this.name = 'AdminNotFoundError';
  }
}

export class DuplicateSlipError extends Error {
  constructor() {
    super('DUPLICATE_SLIP');
    this.name = 'DuplicateSlipError';
  }
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message ?? '');
}

function constraintName(error: { message?: string; details?: string } | null | undefined): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`;
}

function isSlipFingerprintCollision(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  return isUniqueViolation(error) && /slip_fingerprint/i.test(constraintName(error));
}

function isLedgerRefCollision(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  return isUniqueViolation(error) && /ledger_ref/i.test(constraintName(error));
}

export async function findTransactionByFingerprint(fingerprint: string): Promise<{
  id: string;
  ledger_ref: string | null;
  thb_amount: number | null;
  usdt_amount: number | null;
  sell_rate: number | null;
  receiver_bank: string | null;
  receiver_last4: string | null;
  ocr_confidence: number | null;
  admin_name: string | null;
} | null> {
  if (!fingerprint) return null;
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('id, ledger_ref, thb_amount, usdt_amount, sell_rate, receiver_bank, receiver_last4, ocr_confidence, admins(name)')
    .eq('slip_fingerprint', fingerprint)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    ledger_ref: data.ledger_ref ?? null,
    thb_amount: data.thb_amount == null ? null : Number(data.thb_amount),
    usdt_amount: data.usdt_amount == null ? null : Number(data.usdt_amount),
    sell_rate: data.sell_rate == null ? null : Number(data.sell_rate),
    receiver_bank: data.receiver_bank ?? null,
    receiver_last4: data.receiver_last4 ?? null,
    ocr_confidence: data.ocr_confidence == null ? null : Number(data.ocr_confidence),
    admin_name: (data.admins as { name?: string } | null)?.name ?? null,
  };
}

export async function getAdminByTelegramId(telegramId: number): Promise<Admin | null> {
  const { data, error } = await supabaseAdmin
    .from('admins')
    .select('*')
    .eq('telegram_user_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return (data as Admin) ?? null;
}

/** Bootstrap admin เฉพาะ Telegram ID ที่ผ่าน allowlist ใน webhook แล้ว */
export async function upsertAdmin(telegramId: number, name: string): Promise<Admin> {
  const { data, error } = await supabaseAdmin
    .from('admins')
    .upsert(
      { telegram_user_id: telegramId, name },
      { onConflict: 'telegram_user_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as Admin;
}

export type MarketSource = 'binance_th' | 'manual' | 'default';

/**
 * เรตที่ใช้คำนวณ:
 * - sellRate       = เรตขายของเรา (แอดมินตั้งผ่าน /rate → ตาราง rates → ENV)
 * - marketUsdtRate = เรตตลาดจริง อ้างอิง Binance TH real-time (fallback: rates → ENV)
 */
export async function getLatestRates(): Promise<{
  sellRate: number;
  marketUsdtRate: number;
  marketSource: MarketSource;
}> {
  const now = Date.now();
  if (cachedRates && now - ratesCacheTime < RATES_CACHE_TTL) {
    return cachedRates; // จาก cache ตอบเลย
  }

  // ยิง DB + Binance พร้อมกัน (เดิม sequential เสียเวลา ~300-800ms ทุกธุรกรรม)
  const [{ data }, live] = await Promise.all([
    supabaseAdmin
      .from('rates')
      .select('sell_rate, market_usdt_rate')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchBinanceThUsdtRate(),
  ]);

  const sellRate = Number(data?.sell_rate) || Number(process.env.DEFAULT_SELL_RATE);
  if (!Number.isFinite(sellRate) || sellRate <= 0) throw new Error('SELL_RATE_NOT_CONFIGURED');
  let marketUsdtRate: number;
  let marketSource: MarketSource;
  if (live) {
    marketUsdtRate = live;
    marketSource = 'binance_th';
  } else if (data?.market_usdt_rate) {
    marketUsdtRate = Number(data.market_usdt_rate);
    marketSource = 'manual';
  } else {
    marketUsdtRate = Number(process.env.DEFAULT_MARKET_RATE);
    if (!Number.isFinite(marketUsdtRate) || marketUsdtRate <= 0) {
      throw new Error('MARKET_RATE_UNAVAILABLE');
    }
    marketSource = 'default';
  }

  const result = { sellRate, marketUsdtRate, marketSource };
  cachedRates = result;
  ratesCacheTime = now;
  return result;
}

/** ดึง ledger รายวัน (ทั้งระบบ) — ใช้กับคำสั่ง /ยอด และ /summary */
export async function getTodayLedger(
  sinceIso?: string | null,
  chatId?: number | null,
): Promise<{
  incomingList: { time: string; date: string; thb: number; usdt: number }[];
  outgoingList: { time: string; usdt: number }[];
  totalThb: number;
  totalIncomingUsdt: number;
  totalOutgoingUsdt: number;
  netProfitThb: number;
  lastAdminName: string | null;
}> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  // นับจากจุดที่ช้ากว่า: เที่ยงคืน หรือ จุดตัดวันที่ตั้งเอง (เริ่มวันใหม่)
  const cut = sinceIso && new Date(sinceIso) > midnight ? sinceIso : midnight.toISOString();
  let q = supabaseAdmin
    .from('transactions')
    .select('created_at, type, thb_amount, usdt_amount, net_profit_thb, admins(name)')
    .gte('created_at', cut)
    .order('created_at', { ascending: true });
  if (chatId != null) q = q.eq('chat_id', chatId); // แยกห้อง
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
    });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('th-TH', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });
  const incomingList = rows
    .filter((r) => r.type === 'THB_DEPOSIT')
    .map((r) => ({
      time: fmtTime(r.created_at),
      date: fmtDate(r.created_at),
      thb: Number(r.thb_amount),
      usdt: Number(r.usdt_amount),
    }));
  const outgoingList = rows
    .filter((r) => r.type === 'USDT_SEND')
    .map((r) => ({ time: fmtTime(r.created_at), usdt: Number(r.usdt_amount) }));
  const totalThb = incomingList.reduce((s, r) => s + r.thb, 0);
  const totalIncomingUsdt = incomingList.reduce((s, r) => s + r.usdt, 0);
  const totalOutgoingUsdt = outgoingList.reduce((s, r) => s + r.usdt, 0);
  const netProfitThb = rows
    .filter((r) => r.type === 'THB_DEPOSIT')
    .reduce((s, r) => s + Number(r.net_profit_thb || 0), 0);
  const last = rows[rows.length - 1];
  return {
    incomingList,
    outgoingList,
    totalThb,
    totalIncomingUsdt,
    totalOutgoingUsdt,
    netProfitThb,
    lastAdminName: last?.admins?.name ?? null,
  };
}

/** ดึงยอดสะสมของบัญชีธนาคารในวันนี้ */
export async function getTodayBankAccountTotals(
  bankAccountId: string,
): Promise<{ count: number; totalThb: number; totalUsdt: number }> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('type, thb_amount, usdt_amount')
    .eq('bank_account_id', bankAccountId)
    .eq('type', 'THB_DEPOSIT')
    .gte('created_at', midnight.toISOString());
  if (error) throw error;

  const rows = (data ?? []) as any[];
  return {
    count: rows.length,
    totalThb: rows.reduce((s, r) => s + Number(r.thb_amount || 0), 0),
    totalUsdt: rows.reduce((s, r) => s + Number(r.usdt_amount || 0), 0),
  };
}

/** ตั้งเรตใหม่ (บันทึกลงตาราง rates พร้อมผู้ตั้ง) */
export async function insertRate(
  adminId: string,
  sellRate: number,
  marketUsdtRate: number,
): Promise<void> {
  const { error } = await supabaseAdmin.from('rates').insert({
    sell_rate: sellRate,
    market_usdt_rate: marketUsdtRate,
    set_by_admin_id: adminId,
  });
  if (error) throw error;
}

/** เลือกบัญชีธนาคารเริ่มต้น: ENV > บัญชีแรกในตาราง */
export async function getDefaultBankAccountId(): Promise<string | null> {
  if (process.env.DEFAULT_BANK_ACCOUNT_ID) return process.env.DEFAULT_BANK_ACCOUNT_ID;
  const { data } = await supabaseAdmin
    .from('bank_accounts')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// อัปเดตยอดแบบ read-modify-write (ไม่พึ่ง RPC — ทำงานได้ทุกโปรเจกต์)
async function addAdminHolding(adminId: string, delta: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from('admins')
    .select('holding_usdt')
    .eq('id', adminId)
    .single();
  const next = Number(data?.holding_usdt || 0) + delta;
  await supabaseAdmin.from('admins').update({ holding_usdt: next }).eq('id', adminId);
  return next;
}

async function addBankBalance(bankId: string, delta: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', bankId)
    .single();
  const next = Number(data?.current_balance || 0) + delta;
  await supabaseAdmin.from('bank_accounts').update({ current_balance: next }).eq('id', bankId);
  return next;
}

export interface RecordThbInput {
  adminTelegramId: number;
  bankAccountId?: string | null;
  thbAmount: number;
  usdtAmount: number;
  sellRate: number;
  marketUsdtRate: number;
  note?: string;
  slipImageUrl?: string;
}
export interface ThbResult {
  transactionId: string;
  admin: { id: string; name: string; holdingUsdt: number };
  profit: ProfitResult;
  fee: FeeResult;
}

export async function recordThbDeposit(input: RecordThbInput): Promise<ThbResult> {
  const admin = await getAdminByTelegramId(input.adminTelegramId);
  if (!admin) throw new AdminNotFoundError();

  // โมเดลฝาก: กำไร = THB − usdt×เรตตลาด, ค่าธรรมเนียม = ส่วนต่าง USDT (มูลค่าตลาด − ที่ส่งจริง)
  const profit = calculateDepositProfit(input.thbAmount, input.usdtAmount, input.marketUsdtRate);
  const fee = calculateFee(input.thbAmount, input.marketUsdtRate, input.usdtAmount);

  const ledgerRef = newLedgerReference();
  const { data: transactionId, error } = await supabaseAdmin.rpc('ce_vault_record_incoming', {
    p_admin_id: admin.id,
    p_bank_account_id: input.bankAccountId ?? null,
    p_chat_id: 0,
    p_thb: input.thbAmount,
    p_usdt: input.usdtAmount,
    p_sell_rate: input.sellRate,
    p_market_rate: input.marketUsdtRate,
    p_room_name: 'API',
    p_ocr_confidence: null,
    p_ledger_ref: ledgerRef,
    p_slip_image_url: input.slipImageUrl ?? '',
    p_slip_fingerprint: null,
    p_receiver_name: null,
    p_receiver_bank: null,
    p_receiver_last4: null,
  });
  if (error || !transactionId) throw new Error(`DATABASE_MIGRATION_REQUIRED: ${error?.message ?? 'INSERT_FAILED'}`);

  // แจ้งเตือนกลุ่ม CEempire (fire-and-forget)
  notifyIncome({ adminName: admin.name, usdt: input.usdtAmount, thb: input.thbAmount }).catch(() => undefined);

  return {
    transactionId: String(transactionId),
    admin: { id: admin.id, name: admin.name, holdingUsdt: Number(admin.holding_usdt ?? 0) },
    profit,
    fee,
  };
}

/**
 * แก้ไขธุรกรรมที่บันทึกไปแล้ว — คำนวณ delta เทียบของเดิมแล้วปรับ holding/bank balance ให้ถูกต้อง
 * newThb + newUsdt ใช้กับ THB_DEPOSIT / newUsdt อย่างเดียวสำหรับ USDT_SEND
 */
export async function editTransaction(
  txId: string,
  patch: { newThb?: number; newUsdt: number },
): Promise<{ tx: any; admin: { name: string; holdingUsdt: number } }> {
  const { data: old } = await supabaseAdmin
    .from('transactions')
    .select('*, admins(name, holding_usdt)')
    .eq('id', txId)
    .single();
  if (!old) throw new Error('ไม่พบธุรกรรม');

  if (old.ledger_ref) {
    const newThb = old.type === 'THB_DEPOSIT' ? (patch.newThb ?? Number(old.thb_amount)) : 0;
    const newUsdt = patch.newUsdt;
    if (newThb < 0 || newUsdt <= 0) throw new Error('INVALID_AMOUNT');
    const marketRate = Number(old.cost_per_unit) || (await getLatestRates()).marketUsdtRate;
    const { data, error } = await supabaseAdmin.rpc('ce_vault_update_ledger_transaction', {
      p_tx_id: txId,
      p_new_thb: newThb,
      p_new_usdt: newUsdt,
      p_market_rate: marketRate,
    });
    if (error) throw new Error(`DATABASE_MIGRATION_REQUIRED: ${error.message}`);
    let tx = { ...old, ...(data as object) };
    notifyEdit({ adminName: old.admins?.name ?? '-', note: String(old.ledger_ref) }).catch(() => undefined);
    return {
      tx,
      admin: { name: old.admins?.name ?? '-', holdingUsdt: Number(old.admins?.holding_usdt ?? 0) },
    };
  }

  if (old.type === 'THB_DEPOSIT') {
    const rates = await getLatestRates();
    const sellRate = Number(old.sell_rate) || rates.sellRate;
    let marketUsdtRate = rates.marketUsdtRate;
    const newThb = patch.newThb ?? Number(old.thb_amount);
    const newUsdt = patch.newUsdt;

    const profit = calculateDepositProfit(newThb, newUsdt, marketUsdtRate);
    const fee = calculateFee(newThb, marketUsdtRate, newUsdt);

    await supabaseAdmin
      .from('transactions')
      .update({
        thb_amount: newThb,
        usdt_amount: newUsdt,
        sell_rate: sellRate,
        cost_per_unit: profit.costPerUnit,
        sell_value_thb: profit.sellValueThb,
        net_profit_thb: profit.netProfitThb,
        profit_percent: profit.profitPercent,
        expected_usdt: fee.expectedUsdt,
        fee_usdt: fee.feeUsdt,
        fee_percent: fee.feePercent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txId);

    const holdingDelta = newUsdt - Number(old.usdt_amount);
    const thbDelta = newThb - Number(old.thb_amount);
    const newHolding = await addAdminHolding(old.admin_id, holdingDelta);
    if (old.bank_account_id) await addBankBalance(old.bank_account_id, thbDelta);

    notifyEdit({ adminName: old.admins?.name ?? '-', note: 'ฝาก THB → USDT' }).catch(() => undefined);

    return {
      tx: { ...old, thb_amount: newThb, usdt_amount: newUsdt, ...profit, ...fee },
      admin: { name: old.admins?.name ?? '-', holdingUsdt: newHolding },
    };
  } else {
    // USDT_SEND: หัก holding ตอน insert → -old, ตอนแก้ต้องบวก old กลับก่อนแล้วหัก new
    const newUsdt = patch.newUsdt;
    await supabaseAdmin
      .from('transactions')
      .update({ usdt_amount: newUsdt, updated_at: new Date().toISOString() })
      .eq('id', txId);
    const delta = -(newUsdt - Number(old.usdt_amount)); // เดิม -oldUsdt, ใหม่ -newUsdt → net = old - new
    const newHolding = await addAdminHolding(old.admin_id, delta);

    notifyEdit({ adminName: old.admins?.name ?? '-', note: 'ส่ง USDT' }).catch(() => undefined);

    return {
      tx: { ...old, usdt_amount: newUsdt },
      admin: { name: old.admins?.name ?? '-', holdingUsdt: newHolding },
    };
  }
}

/** ลบธุรกรรม (คืน holding/bank balance ให้ถูกต้อง) */
export async function deleteTransaction(txId: string): Promise<{ name: string; holdingUsdt: number }> {
  const { data: old } = await supabaseAdmin
    .from('transactions')
    .select('*, admins(name, holding_usdt)')
    .eq('id', txId)
    .single();
  if (!old) throw new Error('ไม่พบธุรกรรม');

  if (old.ledger_ref) {
    const { error } = await supabaseAdmin.rpc('ce_vault_delete_ledger_transaction', { p_tx_id: txId });
    if (error) throw new Error(`DATABASE_MIGRATION_REQUIRED: ${error.message}`);
    notifyDelete({ adminName: old.admins?.name ?? '-' }).catch(() => undefined);
    return { name: old.admins?.name ?? '-', holdingUsdt: Number(old.admins?.holding_usdt ?? 0) };
  }

  // คืนค่า: THB_DEPOSIT บวกไป holding แล้ว → ต้องหักออก;  USDT_SEND หักไป → ต้องบวกคืน
  const delta = old.type === 'THB_DEPOSIT' ? -Number(old.usdt_amount) : Number(old.usdt_amount);
  const newHolding = await addAdminHolding(old.admin_id, delta);
  if (old.type === 'THB_DEPOSIT' && old.bank_account_id) {
    await addBankBalance(old.bank_account_id, -Number(old.thb_amount));
  }
  await supabaseAdmin.from('transactions').delete().eq('id', txId);

  notifyDelete({ adminName: old.admins?.name ?? '-' }).catch(() => undefined);

  return { name: old.admins?.name ?? '-', holdingUsdt: newHolding };
}

// ============================================================
// Unified Deal (v5): THB slip + USDT confirm ในธุรกรรมเดียว
//   BuyRate = THB / USDT (คำนวณ) · SellRate = เรตห้อง (snapshot)
//   Profit  = USDT × SellRate − THB
// เก็บ type = 'THB_DEPOSIT' เพื่อ backward-compat กับ dashboard เดิม
// ไม่แตะ holding (ดีลนี้ THB เข้า + USDT ออก ในตัวเดียว → net 0)
// ============================================================
export interface RecordDealInput {
  adminTelegramId: number;
  chatId?: number | null;         // ห้อง (กลุ่มเทเลแกรม) ที่ทำรายการ
  thb: number;
  usdt: number;
  sellRate: number;               // เรตห้อง (snapshot)
  roomName?: string | null;
  ocrConfidence?: number | null;
  ledgerRef: string;
  slipImageUrl?: string | null;   // สลิป THB
  usdtImageUrl?: string | null;   // สกรีนช็อต USDT
  usdtNetwork?: string | null;
  usdtTxid?: string | null;
  receiver?: { name?: string | null; bank?: string | null; last4?: string | null } | null;
  bankAccountId?: string | null;
}
export interface DealResult {
  transactionId: string;
  adminName: string;
  buyRate: number;
  sellRate: number;
  profitThb: number;
}

export async function recordDeal(input: RecordDealInput): Promise<DealResult> {
  const admin = await getAdminByTelegramId(input.adminTelegramId);
  if (!admin) throw new AdminNotFoundError();

  const thb = round2(input.thb);
  const usdt = round2(input.usdt);
  const sellRate = round2(input.sellRate);
  if (!(thb > 0) || !(usdt > 0) || !(sellRate > 0)) throw new Error('INVALID_AMOUNT_OR_RATE');
  const buyRate = round2(thb / usdt);
  const profitThb = round2(usdtToThb(usdt, sellRate) - thb);

  // คอลัมน์เสริม (patch-v5/v7) — ถ้ายังไม่ได้รัน migration จะ strip ออกแล้ว retry
  const extra: Record<string, any> = {
    chat_id: input.chatId ?? null,
    buy_rate: buyRate,
    room_name: input.roomName ?? null,
    ocr_confidence: input.ocrConfidence ?? null,
    usdt_network: input.usdtNetwork ?? null,
    usdt_txid: input.usdtTxid ?? null,
    usdt_image_url: input.usdtImageUrl ?? null,
    receiver_name: input.receiver?.name ?? null,
    receiver_bank: input.receiver?.bank ?? null,
    receiver_last4: input.receiver?.last4 ?? null,
    ledger_ref: input.ledgerRef,
  };
  const core = {
    admin_id: admin.id,
    bank_account_id: input.bankAccountId ?? null,
    type: 'THB_DEPOSIT',
    thb_amount: thb,
    usdt_amount: usdt,
    sell_rate: sellRate,
    cost_per_unit: buyRate,
    sell_value_thb: usdtToThb(usdt, sellRate),
    net_profit_thb: profitThb,
    profit_percent: thb > 0 ? round2((profitThb / thb) * 100) : 0,
    slip_image_url: input.slipImageUrl ?? '',
    note: input.ledgerRef,
  };

  let tx: { id: string } | null = null;
  {
    const res = await supabaseAdmin.from('transactions').insert({ ...core, ...extra }).select('id').single();
    if (res.error) {
      // migration ยังไม่ครบ → บันทึกเฉพาะคอลัมน์หลัก (ไม่ให้ดีลหาย)
      const res2 = await supabaseAdmin.from('transactions').insert(core).select('id').single();
      if (res2.error || !res2.data) throw res2.error ?? new Error('INSERT_FAILED');
      tx = res2.data;
    } else {
      tx = res.data;
    }
  }
  if (!tx) throw new Error('INSERT_FAILED');

  if (input.bankAccountId) await addBankBalance(input.bankAccountId, input.thb);

  notifyIncome({ adminName: admin.name, usdt: input.usdt, thb: input.thb }).catch(() => undefined);

  return { transactionId: tx.id, adminName: admin.name, buyRate, sellRate: input.sellRate, profitThb };
}

// ============================================================
// v8: บันทึกทันที แยกขาเข้า/ขาออก (ไม่ต้องจับคู่ deal, ไม่ถามกลับ)
//   ขาเข้า  = รับ THB → usdt_amount = ยอดที่ต้องส่ง (thb / sellRate)
//   ขาออก   = ส่ง USDT จริง
// ============================================================
export async function recordIncoming(input: {
  adminTelegramId: number;
  chatId: number;
  thb: number;
  sellRate: number;
  marketRate: number;
  roomName?: string | null;
  ledgerRef: string;
  ocrConfidence?: number | null;
  slipImageUrl?: string | null;
  slipFingerprint?: string | null;
  bankAccountId?: string | null;
  receiver?: { name?: string | null; bank?: string | null; last4?: string | null } | null;
}): Promise<{ transactionId: string; adminName: string; usdtOwed: number; profitThb: number; ledgerRef: string }> {
  const admin = await getAdminByTelegramId(input.adminTelegramId);
  if (!admin) throw new AdminNotFoundError();

  const thb = round2(input.thb);
  const sellRate = round2(input.sellRate);
  const marketRate = round2(input.marketRate);
  if (!(thb > 0) || !(sellRate > 0) || !(marketRate > 0)) {
    throw new Error('INVALID_AMOUNT_OR_RATE');
  }

  const usdtOwed = thbToUsdt(thb, sellRate);
  if (!(usdtOwed > 0)) throw new Error('INVALID_AMOUNT_OR_RATE');
  const profitThb = round2(thb - usdtToThb(usdtOwed, marketRate));

  let ledgerRef = input.ledgerRef?.trim() || newLedgerReference();
  let res = await supabaseAdmin.rpc('ce_vault_record_incoming', {
    p_admin_id: admin.id,
    p_bank_account_id: input.bankAccountId ?? null,
    p_chat_id: input.chatId,
    p_thb: thb,
    p_usdt: usdtOwed,
    p_sell_rate: sellRate,
    p_market_rate: marketRate,
    p_room_name: input.roomName ?? null,
    p_ocr_confidence: input.ocrConfidence ?? null,
    p_ledger_ref: ledgerRef,
    p_slip_image_url: input.slipImageUrl ?? '',
    p_slip_fingerprint: input.slipFingerprint ?? null,
    p_receiver_name: input.receiver?.name ?? null,
    p_receiver_bank: input.receiver?.bank ?? null,
    p_receiver_last4: input.receiver?.last4 ?? null,
  });
  if (isLedgerRefCollision(res.error)) {
    ledgerRef = newLedgerReference();
    res = await supabaseAdmin.rpc('ce_vault_record_incoming', {
      p_admin_id: admin.id,
      p_bank_account_id: input.bankAccountId ?? null,
      p_chat_id: input.chatId,
      p_thb: thb,
      p_usdt: usdtOwed,
      p_sell_rate: sellRate,
      p_market_rate: marketRate,
      p_room_name: input.roomName ?? null,
      p_ocr_confidence: input.ocrConfidence ?? null,
      p_ledger_ref: ledgerRef,
      p_slip_image_url: input.slipImageUrl ?? '',
      p_slip_fingerprint: input.slipFingerprint ?? null,
      p_receiver_name: input.receiver?.name ?? null,
      p_receiver_bank: input.receiver?.bank ?? null,
      p_receiver_last4: input.receiver?.last4 ?? null,
    });
  }
  if (res.error) {
    if (isSlipFingerprintCollision(res.error) || (isUniqueViolation(res.error) && input.slipFingerprint)) {
      throw new DuplicateSlipError();
    }
    throw new Error(`DATABASE_MIGRATION_REQUIRED: ${res.error.message}`);
  }
  const transactionId = String(res.data ?? '');
  if (!transactionId) throw new Error('INSERT_FAILED');

  notifyIncome({ adminName: admin.name, usdt: usdtOwed, thb }).catch(() => undefined);
  return { transactionId, adminName: admin.name, usdtOwed, profitThb, ledgerRef };
}

export async function recordOutgoing(input: {
  adminTelegramId: number;
  chatId: number;
  usdt: number;
  ledgerRef: string;
  slipImageUrl?: string | null;
  usdtNetwork?: string | null;
  usdtTxid?: string | null;
  slipFingerprint?: string | null;
}): Promise<{ transactionId: string; adminName: string }> {
  const admin = await getAdminByTelegramId(input.adminTelegramId);
  if (!admin) throw new AdminNotFoundError();

  const usdt = round2(input.usdt);
  if (!(usdt > 0)) throw new Error('INVALID_AMOUNT_OR_RATE');

  const res = await supabaseAdmin.rpc('ce_vault_record_outgoing', {
    p_admin_id: admin.id,
    p_chat_id: input.chatId,
    p_usdt: usdt,
    p_ledger_ref: input.ledgerRef,
    p_slip_image_url: input.slipImageUrl ?? '',
    p_slip_fingerprint: input.slipFingerprint ?? null,
    p_usdt_network: input.usdtNetwork ?? null,
    p_usdt_txid: input.usdtTxid ?? null,
  });
  if (res.error) {
    if (isUniqueViolation(res.error) && input.slipFingerprint) throw new DuplicateSlipError();
    throw new Error(`DATABASE_MIGRATION_REQUIRED: ${res.error.message}`);
  }
  const transactionId = String(res.data ?? '');
  if (!transactionId) throw new Error('INSERT_FAILED');

  notifyOutflow({ adminName: admin.name, usdt: input.usdt }).catch(() => undefined);
  return { transactionId, adminName: admin.name };
}

/** 5 รายการล่าสุด: จับคู่ขาเข้า → ขาออกที่ตามมา + ระยะห่างเวลา */
export interface RecentPair {
  ledgerRef: string;
  outgoingLedgerRef: string | null;
  time: string;      // HH:MM ของขาเข้า
  thb: number;
  usdt: number;      // ยอดที่ส่งจริง (ถ้ายังไม่ส่ง = ยอดที่ต้องส่ง)
  gapMin: number | null; // นาทีระหว่างบันทึกขาเข้า → ส่งออก (null = ยังไม่ส่ง)
}
export async function getRecentPairs(
  chatId: number,
  sinceIso?: string | null,
  limit = 5,
): Promise<RecentPair[]> {
  let q = supabaseAdmin
    .from('transactions')
    .select('created_at, type, thb_amount, usdt_amount, ledger_ref')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as any[]).reverse();

  const sends = rows.filter((r) => r.type === 'USDT_SEND');
  const usedSend = new Set<number>();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
    });

  const pairs: RecentPair[] = [];
  for (const inRow of rows.filter((r) => r.type === 'THB_DEPOSIT')) {
    const inTime = new Date(inRow.created_at).getTime();
    // ขาออกตัวแรกหลังขาเข้านี้ ที่ยังไม่ถูกจับคู่
    const idx = sends.findIndex(
      (s, i) => !usedSend.has(i) && new Date(s.created_at).getTime() >= inTime,
    );
    if (idx >= 0) {
      usedSend.add(idx);
      const sendTime = new Date(sends[idx].created_at).getTime();
      pairs.push({
        ledgerRef: String(inRow.ledger_ref || '—'),
        outgoingLedgerRef: sends[idx].ledger_ref ? String(sends[idx].ledger_ref) : null,
        time: fmt(inRow.created_at),
        thb: Number(inRow.thb_amount || 0),
        usdt: Number(sends[idx].usdt_amount || 0),
        gapMin: Math.max(0, Math.round((sendTime - inTime) / 60000)),
      });
    } else {
      pairs.push({
        ledgerRef: String(inRow.ledger_ref || '—'),
        outgoingLedgerRef: null,
        time: fmt(inRow.created_at),
        thb: Number(inRow.thb_amount || 0),
        usdt: Number(inRow.usdt_amount || 0),
        gapMin: null,
      });
    }
  }
  return pairs.slice(-limit).reverse(); // ล่าสุดอยู่บน
}

/**
 * รายการสลิปล่าสุดแบบละเอียด (สำหรับ /recent_slips) — ดึงจาก Supabase จริง
 * เรียงล่าสุดก่อน จำกัดตาม limit และคืนฟิลด์ครบ: ledger ref, THB, USDT, rate,
 * เวลา, admin (+ telegram id สำหรับ mention), และผู้รับเมื่อมีข้อมูล
 */
export interface RecentSlip {
  ledgerRef: string | null;
  type: string;
  createdAt: string;
  time: string;
  date: string;
  thb: number;
  usdt: number;
  sellRate: number | null;
  adminName: string | null;
  adminTelegramId: number | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverLast4: string | null;
}

const BANGKOK_TZ = 'Asia/Bangkok';

function fmtBangkokTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BANGKOK_TZ,
  });
}

function fmtBangkokDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: BANGKOK_TZ,
  });
}

function mapRecentSlipRow(
  row: any,
  adminById: Map<string, { name?: string | null; telegram_user_id?: number | null }>,
): RecentSlip {
  const admin = adminById.get(String(row.admin_id ?? '')) ?? {};
  const telegramId = Number(admin.telegram_user_id);
  return {
    ledgerRef: row.ledger_ref ?? null,
    type: String(row.type ?? ''),
    createdAt: row.created_at,
    time: fmtBangkokTime(row.created_at),
    date: fmtBangkokDate(row.created_at),
    thb: Number(row.thb_amount) || 0,
    usdt: Number(row.usdt_amount) || 0,
    sellRate: row.sell_rate == null ? null : Number(row.sell_rate),
    adminName: admin.name ?? null,
    adminTelegramId: Number.isSafeInteger(telegramId) && telegramId > 0 ? telegramId : null,
    receiverName: row.receiver_name ?? null,
    receiverBank: row.receiver_bank ?? null,
    receiverLast4: row.receiver_last4 ?? null,
  };
}

export async function getRecentSlips(
  chatId: number,
  limit = 5,
  sinceIso?: string | null,
): Promise<RecentSlip[]> {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 20 ? limit : 5;
  const numericChatId = Number(chatId);
  let query = supabaseAdmin
    .from('transactions')
    .select(
      'ledger_ref, type, created_at, thb_amount, usdt_amount, sell_rate, receiver_name, receiver_bank, receiver_last4, admin_id, chat_id',
    )
    .eq('chat_id', numericChatId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (sinceIso) query = query.gte('created_at', sinceIso);
  const { data, error } = await query;
  if (error) throw new Error('RECENT_SLIPS_QUERY_FAILED');
  const rows = (data ?? []) as any[];

  const adminIds = [...new Set(rows.map((row) => String(row.admin_id || '')).filter(Boolean))];
  const adminById = new Map<string, { name?: string | null; telegram_user_id?: number | null }>();
  if (adminIds.length > 0) {
    const { data: admins } = await supabaseAdmin
      .from('admins')
      .select('id, name, telegram_user_id')
      .in('id', adminIds);
    for (const admin of admins ?? []) {
      adminById.set(String((admin as any).id), admin as any);
    }
  }

  return rows.map((row) => mapRecentSlipRow(row, adminById));
}

/** สร้าง CSV ธุรกรรมของห้อง (สำหรับ /export → ส่งเป็นไฟล์ในแชต) */
export async function exportRoomCsv(chatId: number, sinceIso?: string | null): Promise<{ csv: string; rows: number }> {
  let q = supabaseAdmin
    .from('transactions')
    .select('ledger_ref, created_at, room_name, thb_amount, usdt_amount, buy_rate, sell_rate, net_profit_thb, receiver_name, receiver_bank, receiver_last4, usdt_network, usdt_txid, ocr_confidence, admins(name)')
    .eq('type', 'THB_DEPOSIT')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const cols = ['ledger_ref', 'created_at', 'staff', 'room_name', 'thb_amount', 'usdt_amount', 'buy_rate', 'sell_rate', 'net_profit_thb', 'receiver_name', 'receiver_bank', 'receiver_last4', 'usdt_network', 'usdt_txid', 'ocr_confidence'];
  const cell = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    cols.map((c) => (c === 'staff' ? cell(r.admins?.name) : cell(r[c]))).join(','),
  );
  return { csv: [cols.join(','), ...lines].join('\n'), rows: rows.length };
}

/** เริ่มรอบใหม่โดยคง ledger เดิมไว้ — คืนจำนวนรายการที่ archive ด้วย day-cut */
export async function resetRoom(chatId: number): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId);
  if (error) throw error;
  return count ?? 0;
}

/** สรุปกำไรแยกห้อง (วันนี้ + ทั้งหมด) — ใช้กับ dashboard/leaderboard */
export interface RoomStat {
  chatId: number | null;
  roomName: string | null;
  txCount: number;
  totalThb: number;
  totalUsdt: number;
  profitThb: number;
}
export async function getRoomLeaderboard(sinceIso?: string | null): Promise<RoomStat[]> {
  let q = supabaseAdmin
    .from('transactions')
    .select('chat_id, room_name, thb_amount, usdt_amount, net_profit_thb')
    .eq('type', 'THB_DEPOSIT');
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const byRoom = new Map<string, RoomStat>();
  for (const r of rows) {
    const key = String(r.chat_id ?? 'unknown');
    const cur =
      byRoom.get(key) ??
      { chatId: r.chat_id ?? null, roomName: r.room_name ?? null, txCount: 0, totalThb: 0, totalUsdt: 0, profitThb: 0 };
    cur.txCount += 1;
    cur.totalThb += Number(r.thb_amount || 0);
    cur.totalUsdt += Number(r.usdt_amount || 0);
    cur.profitThb += Number(r.net_profit_thb || 0);
    if (!cur.roomName && r.room_name) cur.roomName = r.room_name;
    byRoom.set(key, cur);
  }
  return [...byRoom.values()].sort((a, b) => b.profitThb - a.profitThb);
}

/** Top Staff — จัดอันดับพนักงานตามกำไร/จำนวนดีล (ต่อห้อง + ช่วงเวลา) */
export interface StaffStat {
  name: string;
  count: number;
  totalThb: number;
  profitThb: number;
}
export async function getStaffLeaderboard(
  sinceIso?: string | null,
  chatId?: number | null,
): Promise<StaffStat[]> {
  let q = supabaseAdmin
    .from('transactions')
    .select('thb_amount, net_profit_thb, admins(name)')
    .eq('type', 'THB_DEPOSIT');
  if (sinceIso) q = q.gte('created_at', sinceIso);
  if (chatId != null) q = q.eq('chat_id', chatId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const map = new Map<string, StaffStat>();
  for (const r of rows) {
    const name = r.admins?.name ?? '-';
    const cur = map.get(name) ?? { name, count: 0, totalThb: 0, profitThb: 0 };
    cur.count += 1;
    cur.totalThb += Number(r.thb_amount || 0);
    cur.profitThb += Number(r.net_profit_thb || 0);
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.profitThb - a.profitThb);
}

/** ดึงข้อมูลสรุปวันเก่าของห้อง (ใช้โพสต์ก่อนเริ่มวันใหม่) — รวม staff */
export async function getRoomDaySummary(
  chatId: number,
  sinceIso?: string | null,
): Promise<{ ledger: Awaited<ReturnType<typeof getTodayLedger>>; staff: StaffStat[] }> {
  const [ledger, staff] = await Promise.all([
    getTodayLedger(sinceIso, chatId),
    getStaffLeaderboard(sinceIso, chatId),
  ]);
  return { ledger, staff };
}

export interface RecordSendInput {
  adminTelegramId: number;
  usdtAmount: number;
  note?: string;
  slipImageUrl?: string;
}
export interface SendResult {
  transactionId: string;
  admin: { id: string; name: string; holdingUsdt: number };
}

export async function recordUsdtSend(input: RecordSendInput): Promise<SendResult> {
  const admin = await getAdminByTelegramId(input.adminTelegramId);
  if (!admin) throw new AdminNotFoundError();

  const ledgerRef = newLedgerReference();
  const { data: transactionId, error } = await supabaseAdmin.rpc('ce_vault_record_outgoing', {
    p_admin_id: admin.id,
    p_chat_id: 0,
    p_usdt: input.usdtAmount,
    p_ledger_ref: ledgerRef,
    p_slip_image_url: input.slipImageUrl ?? '',
    p_slip_fingerprint: null,
    p_usdt_network: null,
    p_usdt_txid: null,
  });
  if (error || !transactionId) throw new Error(`DATABASE_MIGRATION_REQUIRED: ${error?.message ?? 'INSERT_FAILED'}`);

  notifyOutflow({ adminName: admin.name, usdt: input.usdtAmount }).catch(() => undefined);

  return {
    transactionId: String(transactionId),
    admin: { id: admin.id, name: admin.name, holdingUsdt: Number(admin.holding_usdt ?? 0) },
  };
}
