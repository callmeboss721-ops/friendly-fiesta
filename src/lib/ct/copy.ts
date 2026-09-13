import type { OutgoingMessage } from '../telegram';
import {
  esc, ik, btn, urlBtn, webAppBtn, miniAppUrl, displayLedger, showAcct, thbInt, thbCard, usdt, rateCode, quoteBlock, totalsBanner, deskUrl,
} from './format';
import { head as tokenHead, progress, rule, NODE, kv, quote, IN_DOT, OUT_DOT } from './tokens';
import type { FlowStep } from './tokens';
import { richDone, richInReady, richStart, richWait, richVault } from './cardJson';
import { cardSettlement } from './settlementRich';
import type { PayoutWallet } from './payoutWallet';
import { bankLabel } from '../botSecurity';

export { cardSettlement };

function msg(text: string, keyboard?: unknown, rich?: OutgoingMessage['rich']): OutgoingMessage {
  return { text, reply_markup: keyboard, rich };
}

function head(status: string, meta: string): string {
  return tokenHead(status, esc(meta));
}

function tape(step: FlowStep): string {
  return `${progress(step)}\n${rule()}`;
}

function rawBlock(raw?: string | null, max = 900): string {
  if (!raw) return '';
  return `<blockquote expandable>RAW OCR\n<code>${esc(String(raw).slice(0, max))}</code></blockquote>`;
}

export function skeletonScan(bank: string, last4: string): OutgoingMessage {
  return msg(
    `${head('AGENT', 'กำลังอ่านสลิป (scan)')}\n${tape('scan')}\n${kv('ผู้รับ', 'PAYEE', `${esc(bank)}  <code>${esc(showAcct(last4))}</code>`)}`,
  );
}

export function skeletonRead(): OutgoingMessage {
  return msg(`${head('AGENT', 'เทียบบัญชีรับ (match)')}\n${tape('match')}`);
}

export function skeletonVault(): OutgoingMessage {
  return msg(head('สรุปยอด', 'กำลังอ่านยอดล่าสุดจาก VAULT'));
}

export function skeletonSettle(ledger: string, usdtAmt: number): OutgoingMessage {
  return msg(
    `${head('โอนสำเร็จ', 'กำลังบันทึกยอดออก (settle)')}\n${kv('เลขที่', 'REF', `<code>${esc(displayLedger(ledger))}</code>`)}\n${kv('เงินออก', 'OUT', `${usdt(usdtAmt)} USDT`)}`,
  );
}

export function welcome(name: string): OutgoingMessage {
  return msg(
    [
      head('สรุปยอด', `CE VAULT · ${esc(name)}`),
      '',
      `<blockquote>${IN_DOT} ฝาก (IN)   ${OUT_DOT} โอน (OUT)\nส่งสลิปได้เลย</blockquote>`,
    ].join('\n'),
    ik([[btn('เลือกห้อง', 'room:list', 'primary'), webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())]]),
    richStart(name),
  );
}

export function menuCard(): OutgoingMessage {
  return settingsCard({
    desk: null,
    mkt: null,
    pins: [],
    admins: [],
  });
}

export function settingsCard(d: {
  desk: number | null;
  mkt: number | null;
  pins: Array<{ bank: string; last4: string; account?: string | null }>;
  admins: Array<{ name: string; role: string }>;
  roomName?: string | null;
}): OutgoingMessage {
  const pinLine = d.pins.length
    ? d.pins.map((p) => `${esc(p.bank)}  <code>${esc(showAcct(p.account || p.last4))}</code>`).join('\n')
    : 'ยังไม่มีบัญชีรับเงินวันนี้ (no pin today)';
  const adminLine = d.admins.length
    ? d.admins.map((a) => `${esc(a.name)}  ${esc(a.role)}`).join('\n')
    : '—';
  const room = d.roomName?.trim() || 'ห้องนี้';
  return msg(
    [
      head('ตั้งค่า', `${esc(room)} (this room)`),
      '',
      `เราขาย (DESK)   <code>${rateCode(d.desk)}</code>`,
      `เรทอ้างอิง (MKT)         <code>${rateCode(d.mkt)}</code>`,
      kv('บัญชีรับ', 'PINS', pinLine),
      '',
      'ผู้ดูแล (ADMINS)',
      adminLine,
      '',
      'เขียว = ใช้ห้องนี้ต่อ (stay) · น้ำเงิน = สลับห้อง (switch)',
      'ตั้งอัตรา (set rate): กดปุ่มอัตรา แล้วพิมพ์ตัวเลขอย่างเดียว เช่น <code>36.70</code>',
      'หรือพิมพ์ <code>/setrate 36.70</code>',
      'เพิ่มผู้ดูแล (add admin): กดปุ่มเพิ่มผู้ดูแล แล้วส่ง Telegram ID',
      'หรือพิมพ์ <code>/admin 5676959274</code>',
    ].join('\n'),
    ik([
      [btn('ใช้ห้องนี้', 'room:here', 'success'), btn('เลือกห้องอื่น', 'room:list', 'primary')],
      [btn('อัตรา', 'vault:rateask'), btn('บัญชีรับ', 'pin:view'), btn('เพิ่มผู้ดูแล', 'admin:add')],
      [btn('วันใหม่', 'vault:newday'), webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())],
    ]),
  );
}

export type RoomChoice = {
  chatId: number;
  name: string;
  desk: number | null;
  current?: boolean;
};

export function roomPicker(d: {
  currentName: string;
  currentId: number;
  rooms: RoomChoice[];
}): OutgoingMessage {
  const rows: Array<Array<Record<string, unknown>>> = [
    [btn('ใช้ห้องนี้', 'room:here', 'success'), btn('เลือกห้องอื่น', 'room:list', 'primary')],
  ];
  const seen = new Set<number>();
  const list = d.rooms.slice(0, 10);
  if (!list.some((r) => r.chatId === d.currentId)) {
    list.unshift({ chatId: d.currentId, name: d.currentName, desk: null, current: true });
  }
  for (const r of list) {
    if (seen.has(r.chatId)) continue;
    seen.add(r.chatId);
    const active = r.chatId === d.currentId || r.current;
    const rate = r.desk && r.desk > 0 ? ` ${r.desk.toFixed(2)}` : '';
    const label = `${active ? '✓ ' : ''}${r.name}${rate}`.slice(0, 34);
    rows.push([btn(label, `room:use:${r.chatId}`, active ? 'success' : 'primary')]);
  }
  rows.push([btn('ตั้งค่า', 'vault:set'), webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())]);
  return msg(
    [
      head('เลือกห้อง', 'หลายห้องปฏิบัติการ (multi-room)'),
      '',
      kv('ห้องที่ใช้', 'ACTIVE', `${esc(d.currentName)}\n<code>${d.currentId}</code>`),
      '',
      'เขียว = ใช้ต่อ (stay) · น้ำเงิน = สลับห้อง (switch)',
      'เพิ่มห้องใหม่: เปิดบอทในกลุ่มนั้น แล้วกด <b>ใช้ห้องนี้</b>',
      'ตั้งชื่อ: <code>/setroom ห้อง A</code>',
    ].join('\n'),
    ik(rows),
  );
}

export function askAdminId(): OutgoingMessage {
  return msg(
    [
      head('ตั้งค่า', 'เพิ่มผู้ดูแลระบบ (add admin)'),
      '',
      'กรุณาส่ง Telegram ID เป็นตัวเลขอย่างเดียว (digits only)',
      'ตัวอย่าง (example) <code>5676959274</code>',
      'ตรวจสอบไอดีได้ที่ @userinfobot (lookup id)',
      'ข้อความอื่นในกลุ่มจะไม่ถูกอ่านเป็นไอดี (other chat ignored)',
    ].join('\n'),
  );
}

export function adminAdded(id: number, name: string): OutgoingMessage {
  return msg(`${head('ตั้งค่า', 'เพิ่มผู้ดูแลแล้ว (admin added)')}\n<code>${id}</code>  ${esc(name)}\nบันทึกเรียบร้อย`);
}

export function cardInReady(d: {
  review: boolean;
  thb: number;
  shouldSend: number;
  desk: number;
  mkt?: number | null;
  bank: string;
  last4: string;
  name: string | null;
  confidence: number;
  ledger: string;
  adminName: string;
  short: string;
  fresh?: boolean;
  time?: string;
  date?: string | null;
  senderName?: string | null;
  senderLast4?: string | null;
  senderBank?: string | null;
  senderAccount?: string | null;
  receiverAccount?: string | null;
  transRef?: string | null;
  feeThb?: number | null;
  channel?: string | null;
  promptpay?: string | null;
  balanceThb?: number | null;
  slipType?: string | null;
  raw?: string | null;
}): OutgoingMessage {
  const hasDesk = d.desk > 0;
  const payeeAcct = showAcct(d.receiverAccount || d.last4);
  const payerAcct = showAcct(d.senderAccount || d.senderLast4);
  const detail = [
    d.slipType ? `ประเภท  ${esc(d.slipType)}` : '',
    [d.date, d.time].filter(Boolean).length ? `เวลา  ${esc([d.date, d.time].filter(Boolean).join('  '))}` : '',
    d.channel ? `ช่องทาง  ${esc(d.channel)}` : '',
    d.transRef ? `อ้างอิง  <code>${esc(d.transRef)}</code>` : '',
    d.feeThb != null ? `ค่าธรรมเนียม  ${thbInt(d.feeThb)} THB` : '',
    d.balanceThb != null ? `คงเหลือ  ${thbCard(d.balanceThb)} THB` : '',
    '',
    'ผู้รับ',
    `${esc(bankLabel(d.bank))}  <code>${esc(payeeAcct)}</code>`,
    esc(d.name || '—'),
    d.promptpay ? `พร้อมเพย์  <code>${esc(d.promptpay)}</code>` : '',
    '',
    'ผู้โอน',
    `${esc(bankLabel(d.senderBank || '—'))}  <code>${esc(payerAcct)}</code>`,
    esc(d.senderName || '—'),
    '',
    `OCR  ${Math.round(d.confidence)}%`,
    d.review ? 'ยอดหรือบัญชียังไม่มั่นใจ' : 'สลิปตรงบัญชีแล้ว',
  ].filter((x) => x !== undefined);
  const lines = [
    head('ยอดรับเข้า', `<code>${esc(displayLedger(d.ledger))}</code>`),
    quoteBlock({ thb: d.thb, usdt: hasDesk ? d.shouldSend : 0, desk: d.desk, mkt: d.mkt ?? null }),
    tape('in'),
    `<blockquote expandable>${detail.filter(Boolean).join('\n')}</blockquote>`,
    'กด <b>ยืนยัน</b> เพื่อรับฝาก',
  ];
  if (d.fresh) lines.push(`บัญชีใหม่  ${esc(bankLabel(d.bank))}  <code>${esc(payeeAcct)}</code>`);
  if (!hasDesk) lines.push('กรุณาตั้งอัตราห้องก่อน เช่น <code>36.65</code>');
  if (d.raw) lines.push(rawBlock(d.raw));
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (hasDesk) {
    rows.push([
      btn('ยืนยัน', `slip:lock:${d.short}`, 'success'),
      btn('บันทึกไว้ก่อน', `slip:queue:${d.short}`, 'primary'),
    ]);
  }
  rows.push([btn('แก้ไข', `slip:edit:${d.short}`), btn('พักรายการ', `slip:hold:${d.short}`)]);
  rows.push([btn('ยกเลิก', `slip:cancel:${d.short}`, 'danger')]);
  rows.push([webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())]);
  return msg(lines.filter(Boolean).join('\n'), ik(rows), richInReady({
    thb: d.thb,
    usdt: hasDesk ? d.shouldSend : 0,
    desk: d.desk,
    mkt: d.mkt ?? null,
    ledger: d.ledger,
    short: d.short,
  }));
}

export function cardOcrWeak(d: {
  bank: string;
  last4: string;
  name: string | null;
  confidence: number;
  short: string;
  chips: number[];
  account?: string | null;
  senderName?: string | null;
  senderAccount?: string | null;
  senderBank?: string | null;
  transRef?: string | null;
  time?: string | null;
  date?: string | null;
  channel?: string | null;
  raw?: string | null;
}): OutgoingMessage {
  const chips = d.chips.slice(0, 2).map((n) => btn(`+${thbInt(n)}B`, `slip:amt:${d.short}:+${n}B`));
  const rows: Array<Array<ReturnType<typeof btn>>> = [];
  if (chips.length) rows.push(chips);
  rows.push([btn('ลองใหม่', `slip:retry:${d.short}`), btn('ยกเลิก', `slip:cancel:${d.short}`, 'danger')]);
  return msg(
    [
      head('แจ้งเตือน', `อ่านสลิปไม่ชัด (OCR weak)  ${Math.round(d.confidence)}%`),
      tape('scan'),
      kv('ผู้รับ', 'PAYEE', `${esc(bankLabel(d.bank))}  <code>${esc(showAcct(d.account || d.last4))}</code>`),
      kv('ชื่อ', 'NAME', esc(d.name || '—')),
      d.senderName || d.senderAccount ? kv('ผู้โอน', 'PAYER', `${esc(bankLabel(d.senderBank))}  <code>${esc(showAcct(d.senderAccount || ''))}</code>\n${esc(d.senderName || '—')}`) : '',
      d.date ? `วันที่ (DATE)     ${esc(d.date)}` : '',
      d.time ? `เวลา (TIME)      ${esc(d.time)}` : '',
      d.channel ? `ช่องทาง (CHANNEL)  ${esc(d.channel)}` : '',
      d.transRef ? `รหัสอ้างอิง (REF)  <code>${esc(d.transRef)}</code>` : '',
      rawBlock(d.raw, 700),
      '',
      'กรุณายืนยันยอด (confirm amount) เช่น <code>เข้า 500</code> หรือ <code>+500B</code>',
    ].filter(Boolean).join('\n'),
    ik(rows),
  );
}

export function cardNeedUnit(d: { short: string }): OutgoingMessage {
  return msg(
    [
      head('ยอดรับเข้า', 'กรุณาระบุหน่วยเงิน (unit required)'),
      '',
      'ยอดเข้า (IN)  <code>เข้า 500</code> หรือ <code>+500B</code>',
      'ยอดออก (OUT)  <code>ออก 13.6</code> หรือ <code>-13.6U</code>',
    ].join('\n'),
    ik([
      [btn('ยืนยันบาท', `slip:unit:${d.short}:+B`, 'success'), btn('ยืนยันUSDT', `slip:unit:${d.short}:-U`, 'primary')],
      [btn('ลองใหม่', `slip:cancel:${d.short}`, 'danger')],
    ]),
  );
}

export function cardPinMismatch(d: {
  slipBank: string;
  slipLast4: string;
  pinBank: string;
  pinLast4: string;
  name?: string | null;
  confidence: number;
  short: string;
  lead: boolean;
  slipAccount?: string | null;
  pinAccount?: string | null;
  pins?: Array<{ bank: string; last4: string; account?: string | null }>;
}): OutgoingMessage {
  const rows: Array<Array<ReturnType<typeof btn>>> = [];
  rows.push([btn('ปักบัญชีจากสลิป', `slip:pinthis:${d.short}`, 'success')]);
  const pins = (d.pins ?? []).slice(0, 3);
  if (pins.length) {
    rows.push(pins.map((p, i) => btn(`แทนหมุด ${i + 1}`, `slip:pinslot:${d.short}:${i + 1}`)));
  }
  rows.push([btn('บัญชีรับ', 'pin:view'), btn('ลองใหม่', `slip:retry:${d.short}`)]);
  if (d.lead) rows.push([btn('บังคับ', `slip:forceask:${d.short}`, 'danger')]);
  rows.push([btn('ยกเลิก', `slip:cancel:${d.short}`, 'danger')]);
  const payee = showAcct(d.slipAccount || d.slipLast4);
  const pin = showAcct(d.pinAccount || d.pinLast4);
  return msg(
    [
      head('แจ้งเตือน', 'บัญชีบนสลิปไม่ตรงหมุดวันนี้ (pin mismatch)'),
      tape('match'),
      '<blockquote expandable>บนสลิป (ON SLIP)',
      `${esc(d.slipBank)}  <code>${esc(payee)}</code>`,
      esc(d.name || '—'),
      '</blockquote>',
      '<blockquote expandable>หมุดวันนี้ (TODAY PIN)',
      `${esc(d.pinBank)}  <code>${esc(pin)}</code>`,
      '</blockquote>',
      pins.length
        ? pins.map((p, i) => `${i + 1}. ${esc(p.bank)}  <code>${esc(showAcct(p.account || p.last4))}</code>`).join('\n')
        : '',
      'กด <b>ปักบัญชีจากสลิป</b> เพื่อใช้บัญชีนี้เป็นหมุด (pin this)',
      'หรือกดแทนหมุดช่องที่มีอยู่ (replace slot)',
    ].filter(Boolean).join('\n'),
    ik(rows),
  );
}

export function cardForceAsk(d: { short: string; ledger: string }): OutgoingMessage {
  return msg(
    `${head('แจ้งเตือน', 'ยืนยันบังคับรับรายการ (force)')}\n<code>${esc(displayLedger(d.ledger))}</code>\nกรุณายืนยันหากต้องการบันทึกทั้งที่บัญชีไม่ตรง`,
    ik([
      [btn('บังคับบันทึก', `slip:force:${d.short}`, 'danger')],
      [btn('ยกเลิก', `slip:cancel:${d.short}`, 'primary')],
    ]),
  );
}

export function cardLocked(d: {
  thb: number;
  shouldSend: number;
  desk: number;
  mkt?: number | null;
  ledger: string;
  adminName: string;
  time: string;
  short: string;
  canUndo: boolean;
  bank?: string;
  last4?: string;
  account?: string | null;
  name?: string | null;
  queued?: boolean;
  batch?: { count: number; thb: number; usdt: number; target: number; remain: number; ready: boolean };
}): OutgoingMessage {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (d.batch && d.batch.count > 0) {
    rows.push([btn('บันทึกส่งรวม', 'vault:batch', 'primary')]);
  }
  rows.push([btn('บันทึกส่ง', `slip:settle:${d.short}`, 'danger')]);
  rows.push([btn('แก้ไข', `slip:edit:${d.short}`), btn('พัก', `slip:open:${d.short}`)]);
  if (d.canUndo) rows.push([btn('ยกเลิก', `slip:undo:${d.short}`, 'danger')]);
  else rows.push([btn('ลบ', `slip:delask:${d.short}`, 'danger')]);
  rows.push([webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())]);
  const queued = Boolean(d.queued || d.batch);
  const ready = Boolean(d.batch?.ready);
  const batchLines = d.batch && d.batch.count
    ? [
        '',
        `${d.batch.count} รายการ  ·  ${thbInt(d.batch.thb)} THB  ·  ${usdt(d.batch.usdt)} USDT`,
        ready ? 'ครบยอดแล้ว' : `คงเหลือ  ${thbInt(d.batch.remain)} THB`,
      ]
    : [];
  return msg(
    [
      head(queued ? 'รอรวมยอด' : 'รอโอน', `<code>${esc(displayLedger(d.ledger))}</code>`),
      quoteBlock({ thb: d.thb, usdt: d.shouldSend, desk: d.desk, mkt: d.mkt ?? null }),
      tape('wait'),
      `<blockquote expandable>${esc(d.time)}
${[bankLabel(d.bank), showAcct(d.account || d.last4)].filter((x) => x && x !== '—').join('  ')}
${esc(d.name || d.adminName)}${batchLines.join('\n')}</blockquote>`,
      ready ? 'กด <b>บันทึกส่งรวม</b>' : 'โอน USDT แล้วกด <b>บันทึกส่งรวม</b>',
    ].filter(Boolean).join('\n'),
    ik(rows),
    richWait({
      thb: d.thb,
      usdt: d.shouldSend,
      desk: d.desk,
      mkt: d.mkt ?? null,
      ledger: d.ledger,
      short: d.short,
    }),
  );
}

export function cardSettledBatch(d: {
  count: number;
  thb: number;
  usdt: number;
  adminName: string;
  desk?: number;
  payout?: PayoutWallet | null;
}): OutgoingMessage {
  const rate = d.desk && d.desk > 0 ? d.desk : (d.usdt > 0 ? d.thb / d.usdt : 0);
  return cardSettlement({
    depositThb: d.thb,
    depositCount: d.count,
    roomRate: rate,
    sentUsdt: d.usdt,
    settled: true,
    adminName: d.adminName,
    rail: d.payout?.rail,
    fromLabel: d.payout?.label,
    fromAddress: d.payout?.fromAddress,
    destAddress: d.payout?.destAddress,
  });
}

export function cardDeleteAsk(d: { ledger: string; thb: number; short: string }): OutgoingMessage {
  return msg(
    `${head('แจ้งเตือน', 'ยืนยันลบรายการ (delete)')}\n<code>${esc(displayLedger(d.ledger))}</code>\n${thbCard(d.thb)} THB\nกรุณายืนยันหากต้องการลบรายการนี้`,
    ik([
      [btn('ลบรายการ', `slip:delete:${d.short}`, 'danger')],
      [btn('เก็บไว้', `slip:open:${d.short}`, 'success')],
    ]),
  );
}

export function cardSettled(d: {
  thb: number;
  usdtOut: number;
  desk: number;
  ledger: string;
  adminName: string;
  inTime: string;
  outTime: string;
  short: string;
}): OutgoingMessage {
  return msg(
    [
      head('โอนสำเร็จ', `<code>${esc(displayLedger(d.ledger))}</code>`),
      tape('done'),
      quote(
        [
          `ฝาก  <b>${thbCard(d.thb)} THB</b>`,
          `ส่ง  <b>${usdt(d.usdtOut)} USDT</b>`,
          `เรท  <code>${rateCode(d.desk)}</code>`,
        ].join('\n'),
      ),
      `${esc(d.adminName)}  ·  ${esc(d.inTime)} → ${esc(d.outTime)}`,
    ].join('\n'),
    ik([
      [btn('ดูรายการ', `slip:open:${d.short}`), btn('คัดลอกเลขที่', `slip:copy:${d.short}`)],
      [btn('ดูยอด', 'vault:today', 'primary'), webAppBtn('เปิด VAULT', miniAppUrl('done'))],
    ]),
    richDone({
      thb: d.thb,
      usdt: d.usdtOut,
      desk: d.desk,
      mkt: null,
      ledger: d.ledger,
      short: d.short,
    }),
  );
}

export function cardDetail(d: {
  ledger: string;
  thb: number;
  usdtOut: number | null;
  desk: number;
  mkt: number | null;
  usd: number | null;
  bank: string;
  last4: string;
  name: string | null;
  pinMatch: boolean;
  confidence: number | null;
  adminIn: string;
  inTime: string;
  outTime: string | null;
  adminOut: string | null;
  note: string | null;
  short: string;
  account?: string | null;
}): OutgoingMessage {
  return msg(
    [
      head('รายการ', displayLedger(d.ledger)),
      '',
      `ยอดรับเข้า (IN)      ${thbCard(d.thb)} THB`,
      `เงินออก (OUT)     ${d.usdtOut != null ? `${usdt(d.usdtOut)} USDT` : '—'}`,
      `เราขาย (DESK)  <code>${rateCode(d.desk)}</code>   เรทอ้างอิง (MKT) <code>${rateCode(d.mkt)}</code>`,
      kv('ผู้รับ', 'PAYEE', `${esc(bankLabel(d.bank))}  <code>${esc(showAcct(d.account || d.last4))}</code>`),
      kv('ชื่อ', 'NAME', esc(d.name || '—')),
      `บัญชีรับ (PIN)    ${d.pinMatch ? 'ตรง (match)' : 'ไม่ตรง (mismatch)'}`,
      `ความมั่นใจ (OCR)  ${d.confidence != null ? `${Math.round(d.confidence)}%` : '—'}`,
      esc(d.adminIn),
      `เวลาเข้า (IN TIME)     ${esc(d.inTime)}`,
      `เวลาออก (OUT TIME)     ${d.outTime ? esc(d.outTime) : '—'}`,
      d.note ? `<blockquote expandable>NOTE\n<code>${esc(d.note.slice(0, 800))}</code></blockquote>` : '',
    ].filter(Boolean).join('\n'),
    ik([
      [btn('หมายเหตุ', `slip:note:${d.short}`), btn('คัดลอกเลขที่', `slip:copy:${d.short}`)],
      [btn('ดูยอด', 'vault:today', 'primary')],
    ]),
  );
}

export function unitHelp(): OutgoingMessage {
  return msg(`${head('ยอดรับเข้า', 'หน่วยเงิน (unit)')}\nยอดเข้า (IN)  <code>เข้า 500</code> หรือ <code>+500B</code>\nยอดออก (OUT)  <code>ออก 13.6</code> หรือ <code>-13.6U</code>`);
}

export type VaultRow = {
  thb?: number;
  usdt?: number;
  time: string;
  short: string;
  pending: boolean;
};

export function vaultBanner(d: {
  mode: 'today' | 'pending' | 'all';
  dateLabel: string;
  clock: string;
  inThb: number;
  inCount: number;
  inRows: VaultRow[];
  outUsdt: number;
  outCount: number;
  outRows: VaultRow[];
  pendingUsdt: number;
  desk: number | null;
  mkt: number | null;
  pendingShorts: string[];
}): OutgoingMessage {
  const meta = d.mode === 'pending' ? `รอโอน  ${d.inRows.length} รายการ` : `${d.dateLabel}  ${d.clock}`;
  const step = d.mode === 'pending' || d.pendingUsdt > 0 ? 'wait' : d.inCount > 0 ? 'done' : 'scan';
  const lines = [head('สรุปยอด', meta), tape(step), '', totalsBanner({ inThb: d.inThb, outUsdt: d.outUsdt, pendingUsdt: d.pendingUsdt }), ''];

  if (d.mode === 'pending') {
    if (!d.inRows.length) {
      lines.push('ขณะนี้ยังไม่มีสลิปที่ค้างโอน');
    } else {
      d.inRows.slice(0, 5).forEach((r, i) => {
        const n = String(i + 1).padStart(2, '0');
        lines.push(`${n}     ${thbInt(r.thb ?? 0)} THB → ${usdt(r.usdt ?? 0)} U  <code>${esc(r.short)}</code>`);
      });
      lines.push('', `รอโอน (DUE)  <b>${usdt(d.pendingUsdt)} USDT</b>`);
      lines.push('กดบันทึกส่งรวมเมื่อโอน USDT ก้อนเดียวครบคิว (batch send when ready)');
    }
    return msg(lines.join('\n'), vaultButtons(d.pendingShorts));
  }

  if (d.inCount === 0 && d.outCount === 0) {
    lines.push('quiet.');
    lines.push('', `รอโอน (DUE)  <b>0 USDT</b>`);
    lines.push(`เราขาย (DESK)   <code>${rateCode(d.desk)}</code>`);
    lines.push(`เรทอ้างอิง (MKT)         <code>${rateCode(d.mkt)}</code>`);
    return msg(lines.join('\n'), vaultButtons(d.pendingShorts));
  }

  lines.push(`${NODE}  ยอดรับเข้า (IN)     <b>${thbInt(d.inThb)} THB</b>    ${d.inCount}`);
  d.inRows.slice(0, 5).forEach((r, i) => {
    const n = String(i + 1).padStart(2, '0');
    const flag = r.pending ? 'รอโอน (wait)' : 'เสร็จ (done)';
    lines.push(`${n}     ${thbInt(r.thb ?? 0)}          ${esc(r.time)}  <code>${esc(r.short)}</code>   ${flag}`);
  });
  if (d.outCount > 0) {
    lines.push('', `เงินออก (OUT)     <b>${usdt(d.outUsdt)} USDT</b>   ${d.outCount}`);
    d.outRows.slice(0, 5).forEach((r, i) => {
      const n = String(i + 1).padStart(2, '0');
      lines.push(`${n}     ${usdt(r.usdt ?? 0)}        ${esc(r.time)}  <code>${esc(r.short)}</code>`);
    });
  }
  lines.push('', `รอโอน (DUE)  <b>${usdt(d.pendingUsdt)} USDT</b>`);
  if (d.pendingUsdt > 0) lines.push('กดบันทึกส่งรวมเมื่อโอน USDT ก้อนเดียวครบคิว (batch send when ready)');
  lines.push(`เราขาย (DESK)   <code>${rateCode(d.desk)}</code>`);
  lines.push(`เรทอ้างอิง (MKT)         <code>${rateCode(d.mkt)}</code>`);
  if (d.desk && d.mkt) {
    const p = Math.round(d.pendingUsdt * (d.desk - d.mkt));
    lines.push(`ส่วนต่าง (PNL)     <b>${p >= 0 ? '+' : ''}${thbInt(p)}</b>`);
  }
  return msg(lines.join('\n'), vaultButtons(d.pendingShorts), richVault({
    inThb: d.inThb,
    outUsdt: d.outUsdt,
    pendingUsdt: d.pendingUsdt,
  }));
}

function vaultButtons(pendingShorts: string[]) {
  const rows: Array<Array<Record<string, unknown>>> = [
    [btn('รอส่ง', 'vault:pending', 'primary'), btn('อัตรา', 'vault:rateask'), btn('ตั้งค่า', 'vault:set')],
    [btn('เลือกห้อง', 'room:list', 'primary'), webAppBtn('เปิด VAULT', miniAppUrl('vault')), urlBtn('เปิดโต๊ะ', deskUrl())],
  ];
  if (pendingShorts.length) {
    rows.unshift([btn('บันทึกส่งรวม', 'vault:batch', 'danger')]);
  }
  const refs = pendingShorts.slice(0, 2);
  if (refs.length) rows.unshift(refs.map((s) => btn(s, `slip:open:${s}`)));
  return ik(rows);
}

export function cardRecent(d: {
  adminLabel: string;
  rows: Array<{ thb: number; usdt: number; desk: number; time: string; short: string; pending: boolean }>;
  inThb: number;
  outUsdt: number;
  pendingUsdt: number;
}): OutgoingMessage {
  return vaultBanner({
    mode: 'today',
    dateLabel: 'TODAY',
    clock: d.adminLabel,
    inThb: d.inThb,
    inCount: d.rows.length,
    inRows: d.rows.map((r) => ({ thb: r.thb, usdt: r.usdt, time: r.time, short: r.short, pending: r.pending })),
    outUsdt: d.outUsdt,
    outCount: d.outUsdt > 0 ? 1 : 0,
    outRows: [],
    pendingUsdt: d.pendingUsdt,
    desk: d.rows[0]?.desk ?? null,
    mkt: null,
    pendingShorts: d.rows.filter((r) => r.pending).map((r) => r.short),
  });
}

export function pinView(items: Array<{
  bank: string;
  last4: string;
  account?: string | null;
  name?: string | null;
  limit?: number | null;
  usedThb?: number | null;
  txCount?: number | null;
}>): OutgoingMessage {
  const lines = [head('บัญชีรับ', 'หมุดวันนี้ (today pins)'), ''];
  if (!items.length) {
    lines.push('ยังไม่มีบัญชีรับเงินวันนี้ (no pin today)');
    lines.push('วางข้อความหมุดได้เลย เช่น (paste pin text)');
    lines.push('<blockquote>ชื่อ : เรืองรอง ชมขวัญ');
    lines.push('เลขบัญชี : 4371699895');
    lines.push('ธนาคาร : ไทยพาณิชย์');
    lines.push('วงเงิน : ???</blockquote>');
    return msg(lines.join('\n'));
  }
  items.forEach((it, i) => {
    const used = it.usedThb != null ? thbInt(it.usedThb) : null;
    const cap = it.limit != null && it.limit > 0 ? thbInt(it.limit) : null;
    const left = it.limit != null && it.usedThb != null ? thbInt(Math.max(0, it.limit - it.usedThb)) : null;
    lines.push(`<blockquote expandable>${i + 1}. ${esc(it.bank)}`);
    lines.push(`ชื่อ  ${esc(it.name || '—')}`);
    lines.push(`เลข  <code>${esc(showAcct(it.account || it.last4))}</code>`);
    if (cap) lines.push(`วงเงิน  ${cap} THB`);
    if (used) lines.push(`ใช้แล้ว  ${used} THB${left ? ` · เหลือ ${left}` : ''}`);
    if (it.txCount != null) lines.push(`รับแล้ว  ${it.txCount} รายการ`);
    lines.push('</blockquote>');
  });
  lines.push('กดยกเลิกบัญชีหากวันนี้ไม่ใช้แล้ว (unpin if unused)');
  const unpins = items.slice(0, 3).map((_, i) => btn(`ยกเลิก ${i + 1}`, `pin:unpin:${i + 1}`));
  return msg(lines.join('\n'), ik([unpins]));
}

export function askDeskRate(current?: number | null): OutgoingMessage {
  const now = current && current > 0 ? current.toFixed(2) : 'ยังไม่ตั้ง';
  return msg(
    [
      head('อัตราแลกเปลี่ยน', 'อัตราสำหรับห้องนี้ (desk rate)'),
      '',
      `อัตราปัจจุบัน (CURRENT)  <code>${now}</code>`,
      'กรุณาพิมพ์ตัวเลขอย่างเดียว เช่น <code>36.70</code> (digits only)',
      'ข้อความอื่นในกลุ่มจะไม่ถูกอ่านเป็นอัตรา (other chat ignored)',
    ].join('\n'),
  );
}

export function deskRateSet(desk: number, mkt: number | null): OutgoingMessage {
  return msg(
    [
      head('อัตราแลกเปลี่ยน', 'บันทึกเรียบร้อย (saved)'),
      '',
      `เราขาย (DESK)   <code>${desk.toFixed(2)}</code>  THB / USDT`,
      `เรทอ้างอิง (MKT)         <code>${mkt && mkt > 0 ? mkt.toFixed(2) : '—'}</code>`,
      'สลิปใบใหม่จะใช้อัตรานี้ ส่วนสลิปเก่าจะไม่ถูกนำมาคิดคำนวณ (new slips only)',
    ].join('\n'),
  );
}

export function expiredToastCard(): OutgoingMessage {
  return msg(`${head('สรุปยอด', 'หมดอายุ (expired)')}\nปุ่มนี้หมดอายุแล้ว กรุณาส่งสลิปใหม่ หรือกดยอดวันนี้`);
}
