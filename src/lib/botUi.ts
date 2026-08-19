// ============================================================
// CE VAULT — Fintech Enterprise Telegram UI (v2)
// สไตล์: Apple × Stripe × ChatGPT
//   ทุกการ์ดใช้ Layout เดียวกัน:
//     {icon} <b>ชื่อไทย</b>
//     <i>(English Title)</i>
//     ━━━━━━━━━━━━━━━━━━
//     {icon} label ไทย (English)
//     {value}
//   ไทยเป็นหลัก · English ในวงเล็บเฉพาะคำสำคัญ
// ============================================================
import { randomBytes } from 'crypto';
import type { OutgoingMessage } from './telegram';
import { escapeTelegramHtml, telegramUserMention } from './botSecurity';

const APP_RAW = (process.env.APP_URL || '').replace(/\/$/, '');
const APP = APP_RAW.startsWith('https://') && !APP_RAW.includes('localhost') ? APP_RAW : '';
const FEE_WARN = Number(process.env.FEE_WARNING_THRESHOLD || 3);

const SEP = '━━━━━━━━━━━━━━━━━━';
const BRAND_TAG = '<i>AI Transaction Intelligence</i>';
const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const money = (n: number) => nf.format(Number(n) || 0);
const pct = (n: number) => `${(Number(n) || 0).toFixed(2)}%`;

export const escapeHtml = escapeTelegramHtml;

function mono(s: string | number | null | undefined): string {
  if (s == null || s === '') return '<code>—</code>';
  return `<code>${escapeHtml(s)}</code>`;
}
function amount(n: number | null | undefined, currency = 'THB'): string {
  if (n == null) return `<b><code>—</code></b>`;
  return `<b><code>${money(n)} ${currency}</code></b>`;
}

// ═══════════════ Card builder ═══════════════
interface Field {
  icon?: string;                // optional — skip for less emoji noise
  labelTh: string;              // Thai label (required)
  labelEn?: string;             // English label in parens (optional)
  value: string;                // pre-formatted (safe HTML)
}

interface CardOpts {
  icon?: string;                // title icon (optional)
  titleTh: string;              // Thai title
  titleEn?: string;             // English title in italics on next line
  groups?: Field[][];           // separated by SEP
  note?: string;                // italic footer (single line)
  tag?: boolean;                // include AI Transaction Intelligence tagline
  keyboard?: unknown;
}

function fieldLine(f: Field): string {
  const icon = f.icon ? `${f.icon} ` : '';
  const en = f.labelEn ? ` (${escapeHtml(f.labelEn)})` : '';
  return `${icon}${escapeHtml(f.labelTh)}${en}\n${f.value}`;
}

function card(o: CardOpts): OutgoingMessage {
  const parts: string[] = [];
  const icon = o.icon ? `${o.icon} ` : '';
  parts.push(`${icon}<b>${escapeHtml(o.titleTh)}</b>`);
  if (o.titleEn) parts.push(`<i>(${escapeHtml(o.titleEn)})</i>`);
  if (o.tag) parts.push(BRAND_TAG);
  const groups = o.groups ?? [];
  for (const group of groups) {
    if (!group.length) continue;
    parts.push(SEP);
    parts.push(group.map(fieldLine).join('\n\n'));
  }
  if (o.note) {
    parts.push(SEP);
    parts.push(`<i>${escapeHtml(o.note)}</i>`);
  }
  return { text: parts.join('\n'), reply_markup: o.keyboard };
}

// ═══════════════ Keyboards ═══════════════
const QA_ROWS: any[][] = [
  [
    { text: '📊 ยอดวันนี้', callback_data: 'qa:today' },
    { text: '👤 ผู้รับ', callback_data: 'qa:receiver' },
  ],
  [
    { text: '📄 Export', callback_data: 'qa:export' },
    { text: '📈 Rate', callback_data: 'qa:rate' },
  ],
];

function successKeyboard(transactionId?: string): unknown {
  const rows: any[][] = [];
  if (transactionId) {
    rows.push([
      { text: '✏️ แก้ไข', callback_data: `edit:${transactionId}` },
      { text: '🗑 ลบ', callback_data: `del:${transactionId}` },
    ]);
  }
  rows.push(...QA_ROWS.map((r) => r.slice()));
  if (APP && transactionId) rows.push([{ text: '🔎 รายละเอียด', url: `${APP}/dashboard/transactions/${transactionId}` }]);
  return { inline_keyboard: rows };
}

export function quickActionKeyboard(transactionId?: string): unknown {
  return successKeyboard(transactionId);
}

// ═══════════════ Ledger reference ═══════════════
export function refCode(txId: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const tail = (txId || '').replace(/-/g, '').slice(0, 4).toUpperCase() || '----';
  return `CE-${ymd}-${tail}`;
}

export function newLedgerRef(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = randomBytes(4).toString('hex').toUpperCase();
  return `CE-${ymd}-${rand}`;
}

// ═══════════════ Common field builders ═══════════════
const F = {
  amountIn: (thb: number): Field => ({ icon: '💵', labelTh: 'ยอดเงิน', labelEn: 'Amount', value: amount(thb, 'THB') }),
  amountOut: (usdt: number): Field => ({ icon: '🚀', labelTh: 'ส่ง USDT', labelEn: 'Send USDT', value: amount(usdt, 'USDT') }),
  shouldSend: (usdt: number): Field => ({ icon: '🎯', labelTh: 'ต้องส่ง', labelEn: 'Should Send', value: amount(usdt, 'USDT') }),
  sellRate: (r: number): Field => ({ icon: '📈', labelTh: 'เรทขาย', labelEn: 'Sell Rate', value: mono(`${money(r)} THB / USDT`) }),
  marketRate: (r: number): Field => ({ icon: '📉', labelTh: 'เรทซื้อ', labelEn: 'Buy Rate', value: mono(money(r)) }),
  netProfit: (thb: number): Field => ({ icon: '💹', labelTh: 'กำไรสุทธิ', labelEn: 'Net Profit', value: amount(thb, 'THB') }),
  balance: (usdt: number): Field => ({ icon: '📦', labelTh: 'ยอดคงเหลือ', labelEn: 'Balance', value: amount(usdt, 'USDT') }),
  reference: (ref: string): Field => ({ icon: '🧾', labelTh: 'อ้างอิง', labelEn: 'Reference', value: mono(ref) }),
  operator: (name: string): Field => ({ icon: '👤', labelTh: 'ผู้ดูแล', labelEn: 'Operator', value: mono(name) }),
  receiver: (name: string): Field => ({ icon: '👤', labelTh: 'ผู้รับ', labelEn: 'Receiver', value: mono(name) }),
  bank: (b: string): Field => ({ icon: '🏦', labelTh: 'ธนาคาร', labelEn: 'Bank', value: mono(b) }),
  last4: (l: string): Field => ({ icon: '🔢', labelTh: 'เลขท้าย', labelEn: 'Last 4', value: mono(l) }),
  time: (t: string): Field => ({ labelTh: 'เวลา', labelEn: 'Time', value: mono(t) }),
  confidence: (c: number): Field => ({
    icon: '🎯',
    labelTh: 'ความแม่นยำ',
    labelEn: 'Confidence',
    value: `${c >= 90 ? '🟢' : c >= 75 ? '🟡' : '🔴'} ${mono(`${c.toFixed(1)}%`)}`,
  }),
};

// ═══════════════ Onboarding ═══════════════
export function welcomeRegistered(name: string): OutgoingMessage {
  return card({
    icon: '👋',
    titleTh: 'ยินดีต้อนรับ',
    titleEn: 'Welcome Back',
    tag: true,
    groups: [[F.operator(name)]],
    note: 'ระบบพร้อมใช้งาน — ส่งสลิปเพื่อเริ่มธุรกรรม',
    keyboard: { inline_keyboard: QA_ROWS.map((r) => r.slice()) },
  });
}

export function askName(): OutgoingMessage {
  return card({
    icon: '🔐',
    titleTh: 'ตั้งชื่อผู้ดูแล',
    titleEn: 'Operator Setup',
    tag: true,
    note: 'พิมพ์ชื่อที่ต้องการให้ระบบแสดง เช่น "แอดมิน A"',
  });
}

export function registered(name: string): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'ยืนยันตัวตนแล้ว',
    titleEn: 'Authenticated',
    tag: true,
    groups: [[F.operator(name)]],
    note: 'ตั้งบัญชีรับด้วย /pin แล้วส่งสลิปได้เลย',
    keyboard: { inline_keyboard: QA_ROWS.map((r) => r.slice()) },
  });
}

// ═══════════════ Upload progress (edit-in-place friendly) ═══════════════
export function uploading(step = 0): OutgoingMessage {
  const steps = [
    { icon: '⏳', th: 'กำลังอัปโหลด', en: 'Uploading' },
    { icon: '🔄', th: 'กำลังประมวลผล', en: 'Processing' },
    { icon: '🛡', th: 'กำลังตรวจสอบ', en: 'Validating' },
    { icon: '✅', th: 'พร้อมดำเนินการ', en: 'Ready' },
  ];
  const s = steps[Math.min(step, steps.length - 1)];
  return card({ icon: s.icon, titleTh: s.th, titleEn: s.en });
}

// ═══════════════ Slip preview (post-OCR) ═══════════════
export interface SlipReadyData {
  type: 'THB_DEPOSIT' | 'USDT_SEND';
  thb?: number | null;
  date?: string | null;
  time?: string | null;
  last4?: string | null;
  bank?: string | null;
  receiverName?: string | null;
  confidence?: number | null;
  chatRate?: number | null;
  historyLine?: string | null;
}

export function slipReady(d: SlipReadyData): OutgoingMessage {
  if (d.type === 'USDT_SEND') {
    return card({
      icon: '⌛',
      titleTh: 'รอ USDT',
      titleEn: 'Waiting USDT',
      note: 'ยืนยันยอดออก เช่น -13.6U',
    });
  }
  const conf = d.confidence ?? null;
  const gotAmount = d.thb != null && d.thb > 0;
  const lowConf = conf != null && conf < 90;

  const fields: Field[] = [];
  if (gotAmount) fields.push(F.amountIn(d.thb!));
  if (d.receiverName) fields.push(F.receiver(d.receiverName));
  if (d.bank) fields.push(F.bank(d.bank));
  if (d.last4) fields.push(F.last4(d.last4));
  if (d.time) fields.push(F.time(d.time));
  if (conf != null) fields.push(F.confidence(conf));

  const isOk = gotAmount && !lowConf;
  const usdtAuto = d.chatRate && gotAmount ? d.thb! / d.chatRate! : null;
  let note: string;
  if (!gotAmount) note = 'กรุณาส่งรูปใหม่ หรือกรอกยอดด้วย /save_slip +500B';
  else if (usdtAuto != null) note = `คำนวณอัตโนมัติ: ${money(d.thb!)} ÷ ${money(d.chatRate!)} = ${money(usdtAuto)} USDT — ยืนยันด้วย /save_slip`;
  else note = 'ระบุอัตราแลกเปลี่ยนด้วย /rate 36.65 แล้วใช้ /save_slip';

  const suffix = d.historyLine ?? '';
  const msg = card({
    icon: isOk ? '✅' : '⚠️',
    titleTh: isOk ? 'ตรวจสอบสลิปสำเร็จ' : 'ไม่สามารถอ่านข้อมูลได้',
    titleEn: isOk ? 'OCR Verified' : 'OCR Failed',
    groups: fields.length ? [fields] : [],
    note,
  });
  if (suffix) msg.text += `\n${suffix}`;
  return msg;
}

// ═══════════════ Amount format helpers ═══════════════
const FORMAT_LINE = 'ต้องระบุสกุลเสมอ — เช่น +500B (เข้า) หรือ -13.6U (ออก)';

export function amountFormatHelp(): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'รูปแบบยอดไม่ถูกต้อง',
    titleEn: 'Invalid Amount Format',
    note: FORMAT_LINE,
  });
}

export function wrongDirection(cur: 'THB' | 'USDT'): OutgoingMessage {
  const msg = cur === 'THB' ? 'บาทในดีลนี้คือเงินเข้า — ใช้ +500B' : 'USDT ในดีลนี้คือเหรียญออก — ใช้ -13.6U';
  return card({
    icon: '⚠️',
    titleTh: 'ทิศทางไม่ถูกต้อง',
    titleEn: 'Invalid Direction',
    note: msg,
  });
}

export function thbSetWaitUsdt(thb: number): OutgoingMessage {
  return card({
    icon: '⌛',
    titleTh: 'รอ USDT',
    titleEn: 'Waiting USDT',
    groups: [[F.amountIn(thb)]],
    note: 'ส่งหลักฐาน USDT หรือพิมพ์ -13.6U',
  });
}

export function needThb(): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'ยังไม่ทราบยอดเงิน',
    titleEn: 'Amount Required',
    note: 'อ่านจากสลิปไม่ได้ — พิมพ์ยอดบาทเพิ่ม เช่น +500B -13.6U',
  });
}

// ═══════════════ Recent slips (list) ═══════════════
export function recentListTemplate(pairs: any[], adminMentions?: string): OutgoingMessage {
  if (!pairs || pairs.length === 0) {
    return card({
      icon: '🧾',
      titleTh: 'รายการล่าสุด',
      titleEn: 'Recent Transactions',
      note: 'ยังไม่มีรายการในวันนี้',
    });
  }
  const rows = pairs.map((p, i) => {
    const state = p.gapMin == null ? '🟡 Pending' : `🟢 Settled · ${Number(p.gapMin) || 0}m`;
    return `${i + 1}. ${mono(p.time)} · ${amount(p.thb, 'THB')} → ${amount(p.usdt, 'USDT')}\n   ${state}`;
  }).join('\n');
  const parts: string[] = [];
  parts.push('🧾 <b>รายการล่าสุด</b>');
  parts.push('<i>(Recent Transactions)</i>');
  parts.push(SEP);
  parts.push(rows);
  if (adminMentions) {
    parts.push(SEP);
    parts.push(`👤 <b>ผู้ดูแล</b> <i>(Operator)</i>\n${adminMentions}`);
  }
  return { text: parts.join('\n') };
}

// Telegram hard limit per message
const TELEGRAM_MAX_LEN = 4096;

export interface RecentSlipView {
  ledgerRef?: string | null;
  type?: string | null;
  time?: string | null;
  thb?: number | null;
  usdt?: number | null;
  sellRate?: number | null;
  adminName?: string | null;
  adminTelegramId?: number | null;
  receiverName?: string | null;
  receiverBank?: string | null;
  receiverLast4?: string | null;
}

/**
 * รายการสลิปล่าสุด (/recent_slips) — แสดง ledger ref, THB, USDT, เรท, เวลา, ผู้ดูแล,
 * และผู้รับเมื่อมีข้อมูล · escape ทุกค่าที่มาจากฐานข้อมูล · ไม่เกิน Telegram limit
 */
export function recentSlipsList(slips: RecentSlipView[]): OutgoingMessage {
  if (!slips || slips.length === 0) {
    return card({
      icon: '🧾',
      titleTh: 'สลิปล่าสุด',
      titleEn: 'Recent Slips',
      note: 'ยังไม่มีรายการ — ส่งสลิปหรือใช้ /save_slip เพื่อบันทึกรายการแรก',
    });
  }

  const header = ['🧾 <b>สลิปล่าสุด</b>', '<i>(Recent Slips)</i>'];
  const renderRow = (s: RecentSlipView, i: number): string => {
    const isOut = String(s.type) === 'USDT_SEND';
    const dirTh = isOut ? 'ส่งออก' : 'รับเข้า';
    const dirEn = isOut ? 'OUT' : 'IN';
    const dirIcon = isOut ? '🔻' : '🟢';
    const admin = s.adminTelegramId
      ? telegramUserMention(s.adminTelegramId, s.adminName || 'Admin')
      : mono(s.adminName || '—');
    const lines: string[] = [];
    lines.push(`${i + 1}. ${dirIcon} ${mono(s.ledgerRef || '—')} · <i>${dirTh} (${dirEn})</i>`);
    const money2 = `💵 ${amount(s.thb ?? 0, 'THB')} → 🚀 ${amount(s.usdt ?? 0, 'USDT')}`;
    const rate = s.sellRate != null && s.sellRate > 0 ? ` · 📈 ${mono(money(s.sellRate))}` : '';
    lines.push(`   ${money2}${rate}`);
    let meta = `   ⏱ ${mono(s.time || '—')} · 👤 ${admin}`;
    if (s.receiverName || s.receiverLast4) {
      const recvName = s.receiverName ? escapeHtml(s.receiverName) : '';
      const recvAcct = [s.receiverBank ? escapeHtml(s.receiverBank) : null, s.receiverLast4 ? `••${escapeHtml(s.receiverLast4)}` : null]
        .filter(Boolean)
        .join(' ');
      const recv = [recvName, recvAcct ? `(${recvAcct})` : ''].filter(Boolean).join(' ');
      if (recv) meta += ` · 👥 ${recv}`;
    }
    lines.push(meta);
    return lines.join('\n');
  };

  // ไม่ให้ยาวเกิน Telegram limit — ตัดแล้วแจ้ง pagination
  const rows: string[] = [];
  let shown = 0;
  let length = header.join('\n').length + SEP.length + 2;
  for (let i = 0; i < slips.length; i++) {
    const row = renderRow(slips[i], i);
    if (length + row.length + 2 > TELEGRAM_MAX_LEN - 120) break;
    rows.push(row);
    length += row.length + 2;
    shown += 1;
  }

  const parts: string[] = [...header, SEP, rows.join('\n\n')];
  if (shown < slips.length) {
    parts.push(SEP);
    parts.push(`<i>แสดง ${shown} จาก ${slips.length} รายการ — ระบุจำนวนที่น้อยลง เช่น /recent_slips ${Math.max(1, shown)}</i>`);
  }
  return { text: parts.join('\n') };
}

// ═══════════════ Live workflow ═══════════════
export function liveInitial(ledgerRef: string, adminName?: string): OutgoingMessage {
  const fields: Field[] = [F.reference(ledgerRef)];
  if (adminName) fields.push(F.operator(adminName));
  return card({
    icon: '🔄',
    titleTh: 'กำลังประมวลผล',
    titleEn: 'Processing',
    groups: [fields],
  });
}

export function liveOcrUpdate(opts: {
  ledgerRef: string;
  thb?: number | null;
  receiver?: string | null;
  bank?: string | null;
  time?: string | null;
  confidence?: number | null;
  sellRate?: number | null;
  marketRate?: number | null;
  shouldSend?: number | null;
}): OutgoingMessage {
  const slip: Field[] = [
    F.reference(opts.ledgerRef),
    opts.thb != null ? F.amountIn(opts.thb) : { icon: '💵', labelTh: 'ยอดเงิน', labelEn: 'Amount', value: mono('—') },
  ];
  if (opts.receiver) slip.push(F.receiver(opts.receiver));
  if (opts.bank) slip.push(F.bank(opts.bank));
  if (opts.time) slip.push(F.time(opts.time));
  if (opts.confidence != null) slip.push(F.confidence(opts.confidence));

  const rate: Field[] = [];
  if (opts.sellRate != null) rate.push(F.sellRate(opts.sellRate));
  if (opts.marketRate != null) rate.push(F.marketRate(opts.marketRate));
  if (opts.shouldSend != null) rate.push(F.shouldSend(opts.shouldSend));

  const groups: Field[][] = [slip];
  if (rate.length) groups.push(rate);
  return card({
    icon: '⌛',
    titleTh: 'รอ USDT',
    titleEn: 'Waiting USDT',
    groups,
  });
}

export function liveCompleted(opts: {
  ledgerRef: string;
  thb: number;
  usdt: number;
  profitThb: number;
  remaining: number;
  todayTotalThb?: number;
}): OutgoingMessage {
  const amountFields: Field[] = [
    { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(opts.thb, 'THB') },
    { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(opts.usdt, 'USDT') },
    F.netProfit(opts.profitThb),
    F.balance(opts.remaining),
  ];
  const ref: Field[] = [F.reference(opts.ledgerRef)];
  if (opts.todayTotalThb != null) {
    ref.push({ icon: '📊', labelTh: 'สรุปวันนี้', labelEn: 'Today Summary', value: amount(opts.todayTotalThb, 'THB') });
  }
  return card({
    icon: '🎉',
    titleTh: 'เสร็จสมบูรณ์',
    titleEn: 'Completed',
    groups: [amountFields, ref],
  });
}

export function liveRefreshPlaceholder(transactionId: string): OutgoingMessage {
  return card({
    icon: '🔄',
    titleTh: 'กำลังซิงก์ข้อมูล',
    titleEn: 'Syncing',
    groups: [[
      { icon: '📂', labelTh: 'รายการ', labelEn: 'Transaction', value: mono(transactionId) },
    ]],
  });
}

export function info(detail: string): OutgoingMessage {
  return card({
    icon: 'ℹ️',
    titleTh: 'แจ้งเตือน',
    titleEn: 'Info',
    note: detail,
  });
}

// ═══════════════ Incoming / Outgoing / Deal success ═══════════════
export function incomingRecorded(d: {
  transactionId: string;
  ledgerRef: string;
  thb: number;
  usdtOwed: number;
  sellRate: number;
  adminName: string;
  bank?: string | null;
  last4?: string | null;
  confidence?: number | null;
  todayIncoming?: { time: string; date: string; thb: number }[];
  todayTotalThb?: number;
}): OutgoingMessage {
  const amountFields: Field[] = [
    { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(d.thb, 'THB') },
    F.shouldSend(d.usdtOwed),
    F.sellRate(d.sellRate),
  ];
  const bankFields: Field[] = [];
  if (d.bank) bankFields.push(F.bank(d.bank));
  if (d.last4) bankFields.push(F.last4(d.last4));
  if (d.confidence != null) bankFields.push(F.confidence(d.confidence));

  const refFields: Field[] = [F.reference(d.ledgerRef), F.operator(d.adminName)];
  if (d.todayTotalThb != null) {
    refFields.push({ icon: '📊', labelTh: 'สรุปวันนี้', labelEn: 'Today Summary', value: amount(d.todayTotalThb, 'THB') });
  }

  const groups: Field[][] = [amountFields];
  if (bankFields.length) groups.push(bankFields);
  groups.push(refFields);

  return card({
    icon: '⚡',
    titleTh: 'บันทึกสำเร็จ',
    titleEn: 'Recorded',
    groups,
    note: 'รอหลักฐาน USDT และยืนยันด้วย -13.6U',
    keyboard: successKeyboard(d.transactionId),
  });
}

export function outgoingRecorded(d: {
  transactionId: string;
  ledgerRef: string;
  usdt: number;
  adminName: string;
  shouldSendUsdt: number;
  remainingUsdt: number;
}): OutgoingMessage {
  const done = d.remainingUsdt <= 0.009;
  return card({
    icon: done ? '🟢' : '🟡',
    titleTh: done ? 'ชำระเสร็จ' : 'รอดำเนินการ',
    titleEn: done ? 'Settled' : 'Pending',
    groups: [
      [
        { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
        F.shouldSend(d.shouldSendUsdt),
        F.balance(Math.max(0, d.remainingUsdt)),
      ],
      [F.reference(d.ledgerRef), F.operator(d.adminName)],
    ],
    keyboard: successKeyboard(d.transactionId),
  });
}

// ═══════════════ Slip errors / validation ═══════════════
export function slipUnclear(_guess?: number | null): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'ไม่สามารถอ่านข้อมูลได้',
    titleEn: 'OCR Failed',
    note: 'กรุณาส่งรูปใหม่ หรือกรอกยอดด้วยตนเอง เช่น +500B',
  });
}

export function accountMismatch(detail?: string): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'บัญชีไม่ตรง',
    titleEn: 'Account Mismatch',
    note: detail ?? 'ตรวจธนาคาร เลขท้าย และบัญชีที่ปักหมุดก่อนลองใหม่',
  });
}

export function ocrUnclear(confidence?: number | null, instruction?: string): OutgoingMessage {
  const fields: Field[] = [];
  if (confidence != null) fields.push(F.confidence(confidence));
  return card({
    icon: '⚠️',
    titleTh: 'ไม่สามารถอ่านข้อมูลได้',
    titleEn: 'OCR Failed',
    groups: fields.length ? [fields] : [],
    note: instruction ?? 'กรุณาส่งรูปใหม่ หรือกรอกยอดด้วยตนเอง เช่น +500',
  });
}

export function thbSlipValidated(data: {
  thb: number;
  bank: string;
  last4: string;
  confidence?: number | null;
}): OutgoingMessage {
  const fields: Field[] = [
    { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(data.thb, 'THB') },
    F.bank(data.bank),
    F.last4(data.last4),
  ];
  if (data.confidence != null) fields.push(F.confidence(data.confidence));
  return card({
    icon: '🛡',
    titleTh: 'ผ่านการตรวจสอบ',
    titleEn: 'Validated',
    groups: [fields],
    note: 'ตรวจข้อมูลแล้วยืนยันด้วย /save_slip',
  });
}

export function usdtSlipPending(data: {
  usdt: number;
  confidence?: number | null;
  lowConfidence?: boolean;
}): OutgoingMessage {
  const fields: Field[] = [
    { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(data.usdt, 'USDT') },
  ];
  if (data.confidence != null) fields.push(F.confidence(data.confidence));
  return card({
    icon: '🟡',
    titleTh: 'รอดำเนินการ',
    titleEn: 'Pending',
    groups: [fields],
    note: data.lowConfidence
      ? 'OCR ต่ำกว่า 90% — ตรวจยอดจากภาพแล้วยืนยันด้วย -13.6U'
      : `ยืนยันด้วย -${money(data.usdt).replace(/,/g, '')}U`,
  });
}

// ═══════════════ Command helpers ═══════════════
export function commandUsage(title: string, english: string, example: string, detail?: string): OutgoingMessage {
  return card({
    icon: 'ℹ️',
    titleTh: title,
    titleEn: english,
    groups: [[
      { labelTh: 'ตัวอย่าง', labelEn: 'Example', value: mono(example) },
    ]],
    note: detail,
  });
}

export function emptyState(title: string, english: string, detail?: string): OutgoingMessage {
  return card({
    icon: '📂',
    titleTh: title,
    titleEn: english,
    note: detail ?? 'ยังไม่มีข้อมูล',
  });
}

export function sectionIntro(title: string, english: string): OutgoingMessage {
  return card({
    icon: '📊',
    titleTh: title,
    titleEn: english,
  });
}

// ═══════════════ Pinned accounts ═══════════════
export interface PinnedAccountItem {
  bank: string;
  last4: string;
}

export function pinnedAccounts(items: PinnedAccountItem[]): OutgoingMessage {
  if (items.length === 0) {
    return card({
      icon: '📌',
      titleTh: 'บัญชีรับวันนี้',
      titleEn: "Today's Receiving Accounts",
      note: 'ยังไม่ปักหมุดบัญชี — เพิ่มด้วย /pin KBANK 1234567890',
    });
  }
  const fields: Field[] = items.map((it, i) => ({
    labelTh: `${i + 1}. ${it.bank}`,
    value: mono(`••••${it.last4}`),
  }));
  return card({
    icon: '📌',
    titleTh: 'บัญชีรับวันนี้',
    titleEn: "Today's Receiving Accounts",
    groups: [fields],
    note: `${items.length} / 3 Accounts — เพิ่ม/ลบด้วย /pin หรือ /unpin`,
  });
}

export function pinUpdated(
  action: 'pin' | 'unpin',
  bank: string,
  last4: string,
  count?: number,
): OutgoingMessage {
  const pinned = action === 'pin';
  const fields: Field[] = [
    { icon: '🏦', labelTh: bank, value: mono(`••••${last4}`) },
  ];
  if (count != null) fields.push({ icon: '📌', labelTh: 'ใช้งานวันนี้', value: mono(`${count} / 3 Accounts`) });
  return card({
    icon: '✅',
    titleTh: pinned ? 'ตั้งบัญชีรับแล้ว' : 'ยกเลิกปักหมุดแล้ว',
    titleEn: pinned ? 'Receiving Account Updated' : 'Account Unpinned',
    groups: [fields],
  });
}

// ═══════════════ Deal flow (v5) ═══════════════
export interface WaitUsdtData {
  thb?: number | null;
  bank?: string | null;
  last4?: string | null;
  receiverName?: string | null;
  date?: string | null;
  time?: string | null;
  confidence?: number | null;
  ledgerRef: string;
  historyLine?: string | null;
  roomRate?: number | null;
  roomName?: string | null;
  marketRate?: number | null;
}

export function waitUsdt(d: WaitUsdtData): OutgoingMessage {
  const conf = d.confidence ?? null;
  const gotAmount = d.thb != null && d.thb > 0;
  const lowConf = conf != null && conf < 90;
  const isOk = gotAmount && !lowConf;

  const slipFields: Field[] = [F.reference(d.ledgerRef)];
  if (gotAmount) slipFields.push(F.amountIn(d.thb!));
  if (d.receiverName) slipFields.push(F.receiver(d.receiverName));
  if (d.bank) slipFields.push(F.bank(d.bank));
  if (d.last4) slipFields.push(F.last4(d.last4));
  if (d.time) slipFields.push(F.time(d.time));
  if (conf != null) slipFields.push(F.confidence(conf));

  const rateFields: Field[] = [];
  if (d.roomRate) rateFields.push(F.sellRate(d.roomRate));
  if (d.roomRate && gotAmount) rateFields.push(F.shouldSend(d.thb! / d.roomRate));
  if (d.marketRate) rateFields.push(F.marketRate(d.marketRate));

  const groups: Field[][] = [slipFields];
  if (rateFields.length) groups.push(rateFields);

  const msg = card({
    icon: isOk ? '⌛' : '⚠️',
    titleTh: isOk ? 'รอ USDT' : 'ไม่สามารถอ่านข้อมูลได้',
    titleEn: isOk ? 'Waiting USDT' : 'OCR Failed',
    groups,
    note: isOk ? 'ส่งหลักฐาน USDT หรือพิมพ์ -13.6U' : 'กรุณาส่งรูปใหม่ หรือกรอกยอด เช่น +500B',
  });
  if (d.historyLine) msg.text += `\n${d.historyLine}`;
  return msg;
}

export interface DealConfirmData {
  ledgerRef: string;
  thb: number;
  usdt: number;
  buyRate: number;
  sellRate: number;
  profitThb: number;
  receiverName?: string | null;
  bank?: string | null;
  last4?: string | null;
  network?: string | null;
}

export function dealConfirm(d: DealConfirmData): OutgoingMessage {
  const fields: Field[] = [
    { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(d.thb, 'THB') },
    { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
    F.sellRate(d.sellRate),
    F.marketRate(d.buyRate),
    F.netProfit(d.profitThb),
  ];
  const recvFields: Field[] = [];
  if (d.receiverName) recvFields.push(F.receiver(d.receiverName));
  if (d.bank) recvFields.push(F.bank(d.bank));
  if (d.last4) recvFields.push(F.last4(d.last4));
  if (d.network) recvFields.push({ icon: '🔗', labelTh: 'เครือข่าย', labelEn: 'Network', value: mono(d.network) });

  const groups: Field[][] = [fields];
  if (recvFields.length) groups.push(recvFields);
  groups.push([F.reference(d.ledgerRef)]);

  return card({
    icon: '🛡',
    titleTh: 'ยืนยันดีล',
    titleEn: 'Confirm Deal',
    groups,
    note: 'ตรวจข้อมูลแล้วกดยืนยัน',
    keyboard: {
      inline_keyboard: [[
        { text: '✅ ยืนยัน', callback_data: `dealok:${d.ledgerRef}` },
        { text: '✏️ แก้ USDT', callback_data: 'dealedit:1' },
        { text: '✖️ ยกเลิก', callback_data: 'cancelop:1' },
      ]],
    },
  });
}

export interface DealSuccessData {
  transactionId: string;
  ledgerRef: string;
  adminName: string;
  thb: number;
  usdt: number;
  buyRate: number;
  sellRate: number;
  profitThb: number;
  receiverName?: string | null;
  bank?: string | null;
  last4?: string | null;
}

export function dealSuccess(d: DealSuccessData): OutgoingMessage {
  const fields: Field[] = [
    { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(d.thb, 'THB') },
    { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
    F.sellRate(d.sellRate),
    F.netProfit(d.profitThb),
  ];
  const recvFields: Field[] = [];
  if (d.receiverName) recvFields.push(F.receiver(d.receiverName));
  if (d.bank) recvFields.push(F.bank(d.bank));
  if (d.last4) recvFields.push(F.last4(d.last4));

  const ref: Field[] = [F.reference(d.ledgerRef), F.operator(d.adminName)];
  const groups: Field[][] = [fields];
  if (recvFields.length) groups.push(recvFields);
  groups.push(ref);

  return card({
    icon: '⚡',
    titleTh: 'บันทึกสำเร็จ',
    titleEn: 'Recorded',
    groups,
    keyboard: successKeyboard(d.transactionId),
  });
}

// ═══════════════ Brand success (settlement) ═══════════════
export interface BrandCardData {
  usdt: number;
  txid?: string | null;
  network?: string | null;
  ledgerRef: string;
  transactionId?: string | null;
}

export function brandCard(d: BrandCardData): OutgoingMessage {
  const t = new Date().toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
  const shortTxid = d.txid ? `${d.txid.slice(0, 6)}…${d.txid.slice(-6)}` : null;
  const fields: Field[] = [
    { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
    { icon: '🔗', labelTh: 'เครือข่าย', labelEn: 'Network', value: mono(d.network ?? 'TRC-20') },
  ];
  if (shortTxid) fields.push({ icon: '🧾', labelTh: 'แฮชธุรกรรม', labelEn: 'TXID', value: mono(shortTxid) });
  fields.push({ labelTh: 'อัปเดตล่าสุด', labelEn: 'Last Updated', value: mono(t) });
  fields.push(F.reference(d.ledgerRef));

  const msg = card({
    icon: '🎉',
    titleTh: 'เสร็จสมบูรณ์',
    titleEn: 'Completed',
    groups: [fields],
  });
  if (APP && d.transactionId) {
    msg.text += `\n<a href="${APP}/status/${encodeURIComponent(d.transactionId)}">🔎 ติดตามรายการ (Track Transaction)</a>`;
  }
  return msg;
}

// ═══════════════ Amount mismatch (OCR vs manual) ═══════════════
export function usdtMismatch(ocrVal: number, manualVal: number): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'ยอดไม่ตรงกัน',
    titleEn: 'Amount Mismatch',
    groups: [[
      { icon: '🤖', labelTh: 'OCR', labelEn: 'Vision', value: mono(`${money(ocrVal)} USDT`) },
      { icon: '⌨️', labelTh: 'พิมพ์เอง', labelEn: 'Manual', value: mono(`${money(manualVal)} USDT`) },
      { icon: '📊', labelTh: 'ส่วนต่าง', labelEn: 'Spread', value: mono(`${money(Math.abs(ocrVal - manualVal))} USDT`) },
    ]],
    note: 'ส่งสกรีนช็อต USDT อีกครั้ง หรือ /cancel เพื่อยกเลิก',
  });
}

// ═══════════════ Confirm cards ═══════════════
export function confirmDeposit(thb: number, usdt: number, rate: number): OutgoingMessage {
  return card({
    icon: '🛡',
    titleTh: 'ยืนยันรับเงิน',
    titleEn: 'Confirm Incoming',
    groups: [[
      { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(thb, 'THB') },
      F.shouldSend(usdt),
      F.sellRate(rate),
    ]],
    keyboard: {
      inline_keyboard: [[
        { text: '✅ ยืนยัน', callback_data: `confirm:${usdt.toFixed(2)}` },
        { text: '✖️ ยกเลิก', callback_data: 'cancelop:1' },
      ]],
    },
  });
}

export function confirmSend(usdt: number, holding: number): OutgoingMessage {
  return card({
    icon: '🛡',
    titleTh: 'ยืนยันส่ง USDT',
    titleEn: 'Confirm Send',
    groups: [[
      { icon: '🚀', labelTh: 'ส่ง USDT', labelEn: 'Send USDT', value: amount(usdt, 'USDT') },
      F.balance(holding - usdt),
    ]],
    keyboard: {
      inline_keyboard: [[
        { text: '✅ ยืนยัน', callback_data: `confirmsend:${usdt.toFixed(2)}` },
        { text: '✖️ ยกเลิก', callback_data: 'cancelop:1' },
      ]],
    },
  });
}

// ═══════════════ Rate ═══════════════
export function rateShow(
  sell: number,
  market: number,
  source?: 'binance_th' | 'manual' | 'default',
): OutgoingMessage {
  const src = source === 'binance_th' ? 'LIVE · Binance TH'
    : source === 'manual'? 'Manual' :'Default';
  const spread = sell - market;
  const spreadPct = market > 0 ? (spread / market) * 100 : 0;
  return card({
    icon: '📈',
    titleTh: 'อัตราแลกเปลี่ยน',
    titleEn: 'Exchange Rate',
    groups: [[
      { icon: '📈', labelTh: 'เรทขาย', labelEn: 'Sell', value: mono(money(sell)) },
      { icon: '📉', labelTh: 'เรทซื้อ', labelEn: 'Buy', value: mono(`${money(market)} · ${src}`) },
      { icon: '📊', labelTh: 'ส่วนต่าง', labelEn: 'Spread', value: mono(`${spread >= 0 ? '+' : ''}${money(spread)} (${pct(spreadPct)})`) },
    ]],
    note: 'ระบุอัตราแลกเปลี่ยนด้วย /rate 36.65',
  });
}

export function rateSet(name: string | null | undefined, sell: number, market: number): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'ตั้งเรตขายแล้ว',
    titleEn: 'Sell Rate Updated',
    groups: [[
      { icon: '📈', labelTh: 'เรทขาย', labelEn: 'Sell', value: mono(money(sell)) },
      { icon: '📉', labelTh: 'เรทซื้อ', labelEn: 'Buy', value: mono(money(market)) },
      F.operator(name || 'แอดมิน'),
    ]],
  });
}

// ═══════════════ Transaction success (headline) ═══════════════
export interface ThbSuccessData {
  transactionId: string;
  adminName: string;
  thb: number;
  usdt: number;
  netProfitThb: number;
  profitPercent: number;
  feeUsdt: number;
  feePercent: number;
  holdingUsdt: number;
}

export function thbSuccess(d: ThbSuccessData): OutgoingMessage {
  const feeHot = d.feePercent > FEE_WARN;
  const rate = d.usdt > 0 ? d.thb / d.usdt : 0;
  return card({
    icon: '⚡',
    titleTh: 'บันทึกสำเร็จ',
    titleEn: 'Recorded',
    groups: [
      [
        { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(d.thb, 'THB') },
        { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
        F.sellRate(rate),
      ],
      [
        { icon: '💹', labelTh: 'กำไรสุทธิ', labelEn: 'Net Profit', value: `${amount(d.netProfitThb, 'THB')} <i>(${pct(d.profitPercent)})</i>` },
        { icon: feeHot ? '🔴' : '💸', labelTh: 'ค่าธรรมเนียม', labelEn: 'Fee', value: `${amount(d.feeUsdt, 'USDT')} <i>(${pct(d.feePercent)})</i>` },
        F.balance(d.holdingUsdt),
      ],
      [F.reference(refCode(d.transactionId)), F.operator(d.adminName)],
    ],
    keyboard: successKeyboard(d.transactionId),
  });
}

export interface UsdtSendData {
  transactionId: string;
  adminName: string;
  usdt: number;
  holdingUsdt: number;
}

export function usdtSendSuccess(d: UsdtSendData): OutgoingMessage {
  return card({
    icon: '🟢',
    titleTh: 'ชำระเสร็จ',
    titleEn: 'Settled',
    groups: [
      [
        { icon: '🚀', labelTh: 'ส่ง USDT', labelEn: 'Send USDT', value: amount(d.usdt, 'USDT') },
        F.balance(d.holdingUsdt),
      ],
      [F.reference(refCode(d.transactionId)), F.operator(d.adminName)],
    ],
    keyboard: successKeyboard(d.transactionId),
  });
}

// ═══════════════ Edit flow ═══════════════
export function editPrompt(_type?: 'THB_DEPOSIT' | 'USDT_SEND'): OutgoingMessage {
  return card({
    icon: '✏️',
    titleTh: 'แก้ไขรายการ',
    titleEn: 'Edit Transaction',
    note: `${FORMAT_LINE} · /cancel เพื่อยกเลิก`,
  });
}

export interface EditSuccessData {
  transactionId: string;
  adminName: string;
  type: 'THB_DEPOSIT' | 'USDT_SEND';
  thb?: number;
  usdt: number;
  netProfitThb?: number;
  profitPercent?: number;
  feeUsdt?: number;
  feePercent?: number;
  holdingUsdt: number;
}

export function editSuccess(d: EditSuccessData): OutgoingMessage {
  const isDep = d.type === 'THB_DEPOSIT';
  const amountFields: Field[] = isDep
    ? [
        { icon: '🟢', labelTh: 'เข้า', labelEn: 'IN', value: amount(d.thb ?? 0, 'THB') },
        { icon: '🔴', labelTh: 'ออก', labelEn: 'OUT', value: amount(d.usdt, 'USDT') },
        { icon: '💹', labelTh: 'กำไรสุทธิ', labelEn: 'Net Profit', value: `${amount(d.netProfitThb ?? 0, 'THB')} <i>(${pct(d.profitPercent ?? 0)})</i>` },
        { icon: '💸', labelTh: 'ค่าธรรมเนียม', labelEn: 'Fee', value: `${amount(d.feeUsdt ?? 0, 'USDT')} <i>(${pct(d.feePercent ?? 0)})</i>` },
      ]
    : [
        { icon: '🚀', labelTh: 'ส่ง USDT', labelEn: 'Send USDT', value: amount(d.usdt, 'USDT') },
      ];
  return card({
    icon: '✏️',
    titleTh: 'แก้ไขแล้ว',
    titleEn: 'Updated',
    groups: [
      amountFields,
      [
        F.balance(d.holdingUsdt),
        F.reference(refCode(d.transactionId)),
        F.operator(d.adminName),
      ],
    ],
    keyboard: successKeyboard(d.transactionId),
  });
}

export function deleteSuccess(name: string, holding: number): OutgoingMessage {
  return card({
    icon: '🗑',
    titleTh: 'ลบรายการแล้ว',
    titleEn: 'Transaction Deleted',
    groups: [[F.operator(name), F.balance(holding)]],
  });
}

export function cancelled(): OutgoingMessage {
  return card({
    icon: '✖️',
    titleTh: 'ยกเลิกแล้ว',
    titleEn: 'Cancelled',
  });
}

// ═══════════════ Chat rate ═══════════════
export function chatRateSet(rate: number): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'ตั้งเรตขายแล้ว',
    titleEn: 'Sell Rate Updated',
    groups: [[
      { icon: '📈', labelTh: 'เรทขาย', labelEn: 'Sell Rate', value: amount(rate, 'THB / USDT') },
    ]],
    note: 'ระบบคำนวณ USDT อัตโนมัติทุกครั้งที่ส่งสลิป',
  });
}

// ═══════════════ Ledger summary ═══════════════
export interface LedgerEntry {
  time: string;
  date?: string;
  thb: number;
  usdt: number;
}
export interface LedgerData {
  incomingList: LedgerEntry[];
  outgoingList: { time: string; usdt: number }[];
  totalThb: number;
  totalIncomingUsdt: number;
  totalOutgoingUsdt: number;
  fixedRate: number | null;
  feePercent: number;
  netProfitThb: number;
  lastAdminName: string | null;
  roomName?: string | null;
  staff?: { name: string; count: number; profitThb: number }[];
  recent?: { time: string; thb: number; usdt: number; gapMin: number | null }[];
}

function bangkokNowLabel(): string {
  return new Date().toLocaleString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
}

export function ledgerCard(d: LedgerData): OutgoingMessage {
  const shouldSendUsdt = d.fixedRate ? d.totalThb / d.fixedRate : d.totalIncomingUsdt;
  const notSent = shouldSendUsdt - d.totalOutgoingUsdt;
  const isSettled = Math.abs(notSent) <= 0.009;

  const summary: Field[] = [
    { icon: '🟢', labelTh: 'รับทั้งหมด', labelEn: 'Total IN', value: amount(d.totalThb, 'THB') },
    { icon: '🔴', labelTh: 'ส่งทั้งหมด', labelEn: 'Total OUT', value: amount(d.totalOutgoingUsdt, 'USDT') },
    { icon: '💹', labelTh: 'กำไรสุทธิ', labelEn: 'Net Profit', value: amount(d.netProfitThb, 'THB') },
    { icon: '📈', labelTh: 'ปริมาณ', labelEn: 'Volume', value: amount(d.totalThb, 'THB') },
  ];
  if (d.fixedRate) summary.push(F.sellRate(d.fixedRate));
  summary.push({ icon: '📦', labelTh: 'ยอดคงเหลือ', labelEn: 'Balance', value: `${amount(notSent, 'USDT')} <i>(${isSettled ? '🟢 Settled' : '🟡 Pending'})</i>` });

  const meta: Field[] = [
    { icon: '🔄', labelTh: 'จำนวนรายการ', labelEn: 'Transactions', value: mono(String(d.incomingList.length + d.outgoingList.length)) },
    { labelTh: 'อัปเดตล่าสุด', labelEn: 'Last Updated', value: mono(bangkokNowLabel()) },
  ];
  if (d.roomName) meta.push({ icon: '🏠', labelTh: 'ห้อง', labelEn: 'Room', value: mono(d.roomName) });
  if (d.lastAdminName) meta.push({ icon: '👤', labelTh: 'ผู้รับผิดชอบล่าสุด', labelEn: 'Last Operator', value: mono(d.lastAdminName) });

  const groups: Field[][] = [summary, meta];

  if (d.staff && d.staff.length) {
    const trophies = ['🥇', '🥈', '🥉', '4.', '5.'];
    const staffFields: Field[] = d.staff.slice(0, 5).map((s, i) => ({
      icon: trophies[i],
      labelTh: s.name,
      value: mono(`${s.count} รายการ · ${s.profitThb >= 0 ? '+' : ''}${money(s.profitThb)} THB`),
    }));
    groups.push(staffFields);
  }

  if (d.recent && d.recent.length) {
    const recentFields: Field[] = d.recent.slice(0, 5).map((r) => {
      const state = r.gapMin == null ? '🟡 Pending' : `🟢 Settled · ${r.gapMin}m`;
      return {
        labelTh: r.time,
        value: `${amount(r.thb, 'THB')} → ${amount(r.usdt, 'USDT')} <i>· ${state}</i>`,
      };
    });
    groups.push(recentFields);
  }

  return card({
    icon: '📊',
    titleTh: 'สรุปวันนี้',
    titleEn: "Today's Summary",
    groups,
    keyboard: {
      inline_keyboard: [
        [
          { text: '🔄 วันใหม่', callback_data: 'newday:1' },
          { text: '🗑 ล้างยอด', callback_data: 'resetask:1' },
        ],
        ...QA_ROWS.map((r) => r.slice()),
        ...(APP ? [[{ text: '📊 แดชบอร์ด', url: `${APP}/dashboard` }]] : []),
      ],
    },
  });
}

// ═══════════════ Menu ═══════════════
export function menuCard(): OutgoingMessage {
  return card({
    icon: '📂',
    titleTh: 'เมนูคำสั่ง',
    titleEn: 'Command Menu',
    tag: true,
    groups: [[
      { labelTh: '/today', value: mono('สรุปวันนี้') },
      { labelTh: '/recent_slips 10', value: mono('รายการล่าสุด') },
      { labelTh: '/save_slip', value: mono('บันทึกสลิป') },
      { labelTh: '/pin, /unpin', value: mono('บัญชีรับวันนี้') },
      { labelTh: '/rate, /setrate 40', value: mono('อัตราแลกเปลี่ยน') },
      { labelTh: '/receiver 6578', value: mono('ประวัติผู้รับ') },
      { labelTh: '/export', value: mono('ส่งออก CSV') },
      { labelTh: '/newday', value: mono('เริ่มวันใหม่') },
      { labelTh: '/cancel', value: mono('ยกเลิกโหมด') },
    ]],
    note: FORMAT_LINE,
    keyboard: {
      inline_keyboard: [
        ...QA_ROWS.map((r) => r.slice()),
        ...(APP ? [[{ text: '📊 แดชบอร์ด', url: `${APP}/dashboard` }]] : []),
      ],
    },
  });
}

// ═══════════════ Reset ═══════════════
export function resetAsk(roomName?: string | null): OutgoingMessage {
  const fields: Field[] = [];
  if (roomName) fields.push({ icon: '🏠', labelTh: 'ห้อง', labelEn: 'Room', value: mono(roomName) });
  return card({
    icon: '⚠️',
    titleTh: 'เริ่มรอบใหม่?',
    titleEn: 'Start New Cycle',
    groups: fields.length ? [fields] : [],
    note: 'รายการเดิมยังอยู่ครบ · ยอดรอบใหม่เริ่มจาก 0',
    keyboard: {
      inline_keyboard: [[
        { text: '✅ ยืนยัน', callback_data: 'resetgo:1' },
        { text: '✖️ ยกเลิก', callback_data: 'cancelop:1' },
      ]],
    },
  });
}

export function resetDone(count: number): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'เริ่มรอบใหม่แล้ว',
    titleEn: 'New Cycle Started',
    groups: [[
      { icon: '🧾', labelTh: 'จำนวนรายการ', labelEn: 'Transactions', value: mono(`${count} รายการ (เก็บไว้)`) },
    ]],
    note: 'ยอดรอบใหม่เริ่มจาก 0',
  });
}

export function roomNameSet(name: string): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'ตั้งชื่อห้องแล้ว',
    titleEn: 'Room Updated',
    groups: [[
      { icon: '🏠', labelTh: 'ห้อง', labelEn: 'Room', value: mono(name) },
    ]],
  });
}

export function newDayStarted(atLabel: string): OutgoingMessage {
  return card({
    icon: '✅',
    titleTh: 'เริ่มวันใหม่แล้ว',
    titleEn: 'New Day Started',
    groups: [[
      { labelTh: 'อัปเดตล่าสุด', labelEn: 'Last Updated', value: mono(atLabel) },
    ]],
    note: 'ยอดก่อนหน้ายังอยู่ในแดชบอร์ด/ประวัติครบ',
  });
}

// ═══════════════ Receiver ═══════════════
export interface ReceiverCardData {
  bank: string | null;
  last4: string;
  name?: string | null;
  status?: string;
  totalTx?: number;
  totalThb?: number;
  totalUsdt?: number;
  maxThb?: number;
  lastThb?: number;
  lastAt?: string | null;
  lastRef?: string | null;
  todayCount?: number;
  todayThb?: number;
}

const fmtDT = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('th-TH', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
      })
    : '—';

export function receiverBrief(r: ReceiverCardData | null, bank: string | null, last4: string): string {
  if (!r) {
    return [
      SEP,
      `⚠️ <b>บัญชีใหม่</b> <i>(New Receiver)</i>`,
      `🏦 ${escapeHtml(bank ?? '—')} · ${mono(`••••${last4}`)}`,
      '<i>ยังไม่เคยมีประวัติในระบบ</i>',
    ].join('\n');
  }
  const star = r.status === 'trusted' ? ' ⭐ Trusted' : r.status === 'blacklist' ? ' 🚫 BLACKLIST' : '';
  const lines: string[] = [SEP];
  lines.push(`🏦 ${escapeHtml(r.bank ?? '—')} · ${mono(`••••${r.last4}`)}${star}`);
  if (r.name) lines.push(`👤 ${mono(r.name)}`);
  lines.push(`📈 ${r.totalTx ?? 0} รายการ · ${amount(r.totalThb ?? 0, 'THB')}`);
  if (r.todayCount) lines.push(`📊 วันนี้ ${r.todayCount} รายการ · ${amount(r.todayThb ?? 0, 'THB')}`);
  lines.push(`ล่าสุด ${escapeHtml(fmtDT(r.lastAt))}${r.lastRef ? ` · ${mono(r.lastRef)}` : ''}`);
  return lines.join('\n');
}

export function receiverCard(r: ReceiverCardData): OutgoingMessage {
  const status = r.status === 'trusted' ? '🟢 Trusted' : r.status === 'blacklist' ? '🔴 Blacklist' : '⚪ Unverified';
  const identity: Field[] = [];
  if (r.name) identity.push({ labelTh: 'ชื่อ', labelEn: 'Name', value: mono(r.name) });
  identity.push(F.bank(r.bank ?? '—'));
  identity.push(F.last4(r.last4));

  const stats: Field[] = [
    { icon: '🔄', labelTh: 'จำนวนธุรกรรม', labelEn: 'Transactions', value: mono(String(r.totalTx ?? 0)) },
    { icon: '📈', labelTh: 'ปริมาณทั้งหมด', labelEn: 'Total Volume', value: amount(r.totalThb ?? 0, 'THB') },
  ];
  if (r.todayCount) stats.push({ icon: '📊', labelTh: 'ปริมาณวันนี้', labelEn: "Today's Volume", value: amount(r.todayThb ?? 0, 'THB') });
  if (r.maxThb) stats.push({ labelTh: 'สูงสุด', labelEn: 'Max', value: amount(r.maxThb, 'THB') });
  stats.push({ labelTh: 'สถานะ', labelEn: 'Status', value: status });

  const meta: Field[] = [
    { labelTh: 'ล่าสุด', labelEn: 'Last Activity', value: mono(fmtDT(r.lastAt)) },
  ];
  if (r.lastRef) meta.push(F.reference(r.lastRef));

  return card({
    icon: '👤',
    titleTh: 'ข้อมูลผู้รับ',
    titleEn: 'Receiver Intelligence',
    tag: true,
    groups: [identity, stats, meta],
  });
}

export function receiverNotFound(last4: string): OutgoingMessage {
  return card({
    icon: '⚠️',
    titleTh: 'ไม่พบผู้รับ',
    titleEn: 'Receiver Not Found',
    groups: [[F.last4(last4)]],
    note: 'บัญชีนี้ยังไม่เคยมีธุรกรรมในระบบ',
  });
}

// ═══════════════ Export ═══════════════
export function exportSummary(filename: string, rows: number, roomName?: string | null, allTime?: boolean): OutgoingMessage {
  const fields: Field[] = [
    { icon: '📄', labelTh: 'ไฟล์', labelEn: 'File', value: mono(filename) },
    { icon: '🔄', labelTh: 'จำนวนรายการ', labelEn: 'Transactions', value: mono(String(rows)) },
  ];
  if (roomName) fields.push({ icon: '🏠', labelTh: 'ห้อง', labelEn: 'Room', value: mono(roomName) });
  fields.push({ labelTh: 'ช่วงเวลา', labelEn: 'Range', value: mono(allTime ? 'ทั้งหมด · All time' : 'วันนี้ · Today') });
  return card({
    icon: '📄',
    titleTh: 'ส่งออกรายงาน',
    titleEn: 'Export Complete',
    groups: [fields],
  });
}

// ═══════════════ Error ═══════════════
// ═══════════════ Vision Slip Verification ═══════════════
export interface VisionSlipVerificationData {
  thb: number | null;
  bank: string | null;
  last4: string | null;
  receiverName: string | null;
  confidence: number | null;
  accountMatched: boolean;
  accountClear: boolean;
  matchedBank?: string;
  matchedLast4?: string;
  roomRate?: number;
  suggestedUsdt?: number;
  todayCountForAccount?: number;
  todayTotalThbForAccount?: number;
}

export function visionSlipVerification(data: VisionSlipVerificationData): OutgoingMessage {
  const groups: Field[][] = [];

  // Extracted slip data
  const slipGroup: Field[] = [];
  if (data.thb != null) {
    slipGroup.push({ icon: '💵', labelTh: 'ยอดเงิน', labelEn: 'Amount', value: amount(data.thb, 'THB') });
  } else {
    slipGroup.push({ icon: '⚠️', labelTh: 'ยอดเงิน', labelEn: 'Amount', value: '<b><code>ไม่สามารถอ่านได้</code></b>' });
  }

  if (data.bank != null && data.last4 != null) {
    slipGroup.push(F.bank(data.bank));
    slipGroup.push(F.last4(data.last4));
  } else if (!data.accountClear) {
    slipGroup.push({ icon: '⚠️', labelTh: 'ธนาคาร', labelEn: 'Bank', value: '<b><code>ไม่สามารถอ่านได้</code></b>' });
  }

  if (data.receiverName) {
    slipGroup.push(F.receiver(data.receiverName));
  }

  if (data.confidence != null) {
    slipGroup.push(F.confidence(data.confidence));
  }

  if (slipGroup.length > 0) {
    groups.push(slipGroup);
  }

  // Account matching result
  const matchGroup: Field[] = [];
  if (!data.accountClear) {
    matchGroup.push({
      icon: '❓',
      labelTh: 'สถานะ',
      labelEn: 'Status',
      value: '<b>ไม่สามารถระบุบัญชี</b>'
    });
  } else if (data.accountMatched) {
    matchGroup.push({
      icon: '🟢',
      labelTh: 'ตรงกับปักหมุด',
      labelEn: 'Account Matched',
      value: `<b>${escapeHtml(data.matchedBank || '')} ••••${escapeHtml(data.matchedLast4 || '')}</b>`
    });
    if (data.todayCountForAccount != null) {
      matchGroup.push({
        icon: '📌',
        labelTh: 'บัญชีนี้รับแล้ว',
        labelEn: 'Today Count',
        value: `<b>${data.todayCountForAccount}</b> รายการ · <b><code>${money(data.todayTotalThbForAccount || 0)} THB</code></b>`
      });
    }
  } else {
    matchGroup.push({
      icon: '❌',
      labelTh: 'สถานะ',
      labelEn: 'Status',
      value: '<b>ไม่ตรงกับปักหมุด</b>'
    });
  }

  if (matchGroup.length > 0) {
    groups.push(matchGroup);
  }

  // Suggested calculation
  if (data.accountMatched && data.thb != null && data.roomRate != null && data.suggestedUsdt != null) {
    const calcGroup: Field[] = [
      F.amountIn(data.thb),
      {
        icon: '📊',
        labelTh: 'เรทห้อง',
        labelEn: 'Room Rate',
        value: mono(`${money(data.roomRate)} THB / USDT`)
      },
      {
        icon: '🎯',
        labelTh: 'ต้องส่ง',
        labelEn: 'Should Send',
        value: amount(data.suggestedUsdt, 'USDT')
      },
    ];
    groups.push(calcGroup);
  }

  const keyboard = data.accountMatched && data.thb != null && data.accountClear
    ? { inline_keyboard: [[
        { text: '✅ ยืนยัน', callback_data: 'slip:confirm' },
        { text: '✏️ แก้ไข', callback_data: 'slip:edit' },
        { text: '❌ ยกเลิก', callback_data: 'slip:cancel' }
      ]] }
    : undefined;

  return card({
    icon: '🛡',
    titleTh: 'ตรวจสอบสลิป',
    titleEn: 'Vision Verification',
    groups: groups.length > 0 ? groups : [[{ labelTh: 'สถานะ', labelEn: 'Status', value: '<b><code>กำลังประมวลผล</code></b>' }]],
    keyboard,
  });
}

export function summaryBannerToday(data: {
  bank: string;
  last4: string;
  receiverCount: number;
  totalThb: number;
  totalUsdt: number;
}): OutgoingMessage {
  return card({
    icon: '📊',
    titleTh: 'สรุปวันนี้',
    titleEn: 'Today Summary',
    groups: [[
      { icon: '🏦', labelTh: 'บัญชีรับ', labelEn: 'Account', value: mono(`${escapeHtml(data.bank)} ••••${escapeHtml(data.last4)}`) },
      { icon: '📌', labelTh: 'จำนวน', labelEn: 'Count', value: `<b>${data.receiverCount}</b> รายการ` },
      { icon: '💵', labelTh: 'รวมเงิน', labelEn: 'Total THB', value: amount(data.totalThb, 'THB') },
      { icon: '🚀', labelTh: 'รวม USDT', labelEn: 'Total USDT', value: amount(data.totalUsdt, 'USDT') },
    ]],
  });
}

export function error(detail: string): OutgoingMessage {
  return card({
    icon: '❌',
    titleTh: 'ดำเนินการไม่สำเร็จ',
    titleEn: 'Operation Failed',
    groups: [[
      { labelTh: 'สาเหตุ', labelEn: 'Reason', value: mono(detail.slice(0, 500)) },
    ]],
    note: 'ตรวจข้อมูลแล้วลองใหม่ · หากยังไม่สำเร็จให้แจ้งผู้ดูแลระบบ',
  });
}

const UI: any = null;

export default UI;