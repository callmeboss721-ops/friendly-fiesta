import { deskUrl, miniAppUrl, pnlThb, rateCode, thbCard, thbInt, usdt, type BtnStyle } from './format';

export type RichBlock = Record<string, unknown>;
export type InputRichMessage = { blocks: RichBlock[] } | { html: string };

function heading(text: string, size = 2): RichBlock {
  return { type: 'heading', size, text };
}

function paragraph(text: string): RichBlock {
  return { type: 'paragraph', text };
}

function quote(text: string, expandable = false): RichBlock {
  return expandable
    ? { type: 'expandable_blockquote', text }
    : { type: 'blockquote', text };
}

function cell(text: string, header = false): Record<string, unknown> {
  return { text, is_header: header || undefined };
}

function table(rows: string[][], opts?: { caption?: string }): RichBlock {
  return {
    type: 'table',
    is_bordered: true,
    is_compact: true,
    is_striped: true,
    caption: opts?.caption,
    cells: rows.map((row, i) => row.map((c) => cell(c, i === 0))),
  };
}

function details(summary: string, body: string): RichBlock {
  return {
    type: 'details',
    summary,
    is_open: false,
    blocks: [paragraph(body)],
  };
}

function buttons(
  items: Array<{ text: string; callback_data?: string; url?: string; web_app?: { url: string }; style?: BtnStyle | 'link' }>,
  align: 'left' | 'center' = 'left',
): RichBlock {
  return {
    type: 'buttons',
    align,
    buttons: items.map((b) => ({
      text: b.text,
      style: b.style,
      callback_data: b.callback_data,
      url: b.url,
      web_app: b.web_app,
    })),
  };
}

export type QuoteNums = { thb: number; usdt: number; desk: number; mkt: number | null };

function quoteRows(d: QuoteNums): string[][] {
  const p = pnlThb(d.thb, d.usdt, d.desk, d.mkt);
  const pnl = p == null ? '—' : `${p >= 0 ? '+' : ''}${thbInt(p)} THB`;
  return [
    ['รายการ', 'ยอด'],
    ['ฝาก', `${thbCard(d.thb)} THB`],
    [`USDT @ ${rateCode(d.desk)}`, `${usdt(d.usdt)} USDT`],
    ['กำไร', pnl],
    ['เราขาย', rateCode(d.desk)],
    ['เรทอ้างอิง', rateCode(d.mkt)],
  ];
}

export function richStart(name = 'CE'): InputRichMessage {
  return {
    blocks: [
      heading('CE VAULT'),
      paragraph(`LIVE · ${name}`),
      quote('เขียว = ฝาก\nแดง = โอน\nส่งสลิปได้เลย'),
      buttons([
        { text: 'เลือกห้อง', callback_data: 'room:list', style: 'primary' },
        { text: 'เปิด VAULT', web_app: { url: miniAppUrl('vault') } },
        { text: 'เปิดโต๊ะ', url: deskUrl(), style: 'link' },
      ]),
    ],
  };
}

export function richInReady(d: QuoteNums & { ledger: string; short: string }): InputRichMessage {
  return {
    blocks: [
      heading('ยอดรับเข้า'),
      paragraph(d.ledger.startsWith('#') ? d.ledger : `#${d.ledger}`),
      table(quoteRows(d), { caption: 'ใบเสนอราคาห้องนี้' }),
      buttons([
        { text: 'ยืนยัน', callback_data: `slip:lock:${d.short}`, style: 'success' },
        { text: 'บันทึกไว้ก่อน', callback_data: `slip:queue:${d.short}`, style: 'primary' },
      ]),
      buttons([
        { text: 'แก้ไข', callback_data: `slip:edit:${d.short}` },
        { text: 'พักรายการ', callback_data: `slip:hold:${d.short}` },
        { text: 'ยกเลิก', callback_data: `slip:cancel:${d.short}`, style: 'danger' },
      ]),
    ],
  };
}

export function richWait(d: QuoteNums & { ledger: string; short: string }): InputRichMessage {
  return {
    blocks: [
      heading('รอโอน'),
      paragraph(d.ledger.startsWith('#') ? d.ledger : `#${d.ledger}`),
      table(quoteRows(d), { caption: 'รอส่ง USDT' }),
      buttons([
        { text: 'บันทึกส่ง', callback_data: `slip:settle:${d.short}`, style: 'danger' },
        { text: 'บันทึกส่งรวม', callback_data: 'vault:batch', style: 'danger' },
        { text: 'เปิด VAULT', web_app: { url: miniAppUrl('vault') } },
      ]),
    ],
  };
}

export function richDone(d: QuoteNums & { ledger: string; short: string }): InputRichMessage {
  return {
    blocks: [
      heading('โอนสำเร็จ'),
      paragraph(d.ledger.startsWith('#') ? d.ledger : `#${d.ledger}`),
      table(quoteRows(d), { caption: 'ปิดรายการ' }),
      buttons([
        { text: 'ดูยอด', callback_data: 'vault:today', style: 'primary' },
        { text: 'เปิด VAULT', web_app: { url: miniAppUrl('done') } },
        { text: 'เปิดโต๊ะ', url: deskUrl(), style: 'link' },
      ]),
    ],
  };
}

export function richVault(d: { inThb: number; outUsdt: number; pendingUsdt: number }): InputRichMessage {
  return {
    blocks: [
      heading('ผลรวมวันนี้'),
      table([
        ['รายการ', 'ยอด'],
        ['ฝาก', `${thbInt(d.inThb)} THB`],
        ['ส่งแล้ว', `${usdt(d.outUsdt)} USDT`],
        ['ค้างเคลียร์', `${usdt(d.pendingUsdt)} USDT`],
      ]),
      buttons([
        { text: 'เลือกห้อง', callback_data: 'room:list', style: 'primary' },
        { text: 'เปิด VAULT', web_app: { url: miniAppUrl('vault') } },
        { text: 'เปิดโต๊ะ', url: deskUrl(), style: 'link' },
      ]),
    ],
  };
}

export function richSettlement(d: {
  depositThb: number;
  depositCount: number;
  required: number;
  sent: number | null;
  state: string;
  rate: number;
  diff?: number | null;
  message?: string | null;
  rail?: string | null;
  fromAddress?: string | null;
  destAddress?: string | null;
}): InputRichMessage {
  const unit = d.rail === 'sol-usdc' ? 'USDC' : 'USDT';
  const diffText =
    d.diff == null
      ? 'รอคำนวณ'
      : `${d.diff > 0.005 ? '+' : d.diff < -0.005 ? '-' : '+'}${usdt(Math.abs(d.diff))} ${unit}`;
  const rows: string[][] = [
    ['รายการ', 'ยอด'],
    ['ฝากรวม', `${thbCard(d.depositThb)} THB`],
    [`ต้องส่ง @ ${rateCode(d.rate)}`, `${usdt(d.required)} ${unit}`],
    ['ส่งแล้ว', d.sent == null ? 'รอส่ง' : `${usdt(d.sent)} ${unit}`],
    ['ส่วนต่าง', diffText],
  ];
  if (d.rail) rows.push(['ราง', d.rail === 'sol-usdc' ? 'USDC · Solana' : 'USDT · TRC20 โอนมือ']);
  if (d.fromAddress) rows.push(['จาก', d.fromAddress]);
  if (d.destAddress) rows.push(['ไป', d.destAddress]);
  return {
    blocks: [
      heading('เคลียร์ยอด'),
      paragraph(`${d.state} · ${d.depositCount} รายการ`),
      table(rows),
      ...(d.message ? [paragraph(d.message)] : []),
      buttons([
        {
          text: d.state === 'SETTLED' ? 'โอนสำเร็จ' : 'บันทึกส่งรวม',
          callback_data: d.state === 'SETTLED' ? 'vault:today' : 'vault:batch',
          style: d.state === 'SETTLED' ? 'success' : 'danger',
        },
        { text: 'เปิด VAULT', web_app: { url: miniAppUrl(d.state === 'SETTLED' ? 'done' : 'vault', {
          thb: d.depositThb,
          count: d.depositCount,
          rate: d.rate,
          sent: d.sent,
          state: d.state,
        }) } },
      ]),
    ],
  };
}

export function richPin(d: {
  name: string;
  bank: string;
  account: string;
  limit?: string | null;
}): InputRichMessage {
  return {
    blocks: [
      heading('บัญชีรับ'),
      table([
        ['ฟิลด์', 'ค่า'],
        ['ชื่อ', d.name],
        ['ธนาคาร', d.bank],
        ['เลขบัญชี', d.account],
        ['วงเงิน', d.limit || '???'],
      ]),
      details('วางข้อความหมุด', 'ชื่อ : เรืองรอง ชมขวัญ\nเลขบัญชี : 4371699895\nธนาคาร : ไทยพาณิชย\nวงเงิน : ???'),
    ],
  };
}

export function cardExamples() {
  const quote = { thb: 10000, usdt: 272.48, desk: 36.7, mkt: 36.2 };
  const slip = { ...quote, ledger: '#CE-20260908-A4F2', short: 'A4F2' };
  return {
    sendRichMessage: {
      method: 'sendRichMessage',
      chat_id: '{{chat_id}}',
      start: richStart('CE'),
      in_ready: richInReady(slip),
      wait: richWait(slip),
      done: richDone(slip),
      vault: richVault({ inThb: 10000, outUsdt: 0, pendingUsdt: 272.48 }),
      settlement: richSettlement({ depositThb: 10000, depositCount: 2, required: 272.48, sent: null, state: 'READY', rate: 36.7 }),
      pin: richPin({ name: 'เรืองรอง ชมขวัญ', bank: 'SCB', account: '4371699895', limit: '???' }),
    },
    sendPhoto: {
      method: 'sendPhoto',
      chat_id: '{{chat_id}}',
      parse_mode: 'HTML',
      start: { photo: 'attach://webhook-welcome-1080x560.jpg', caption: 'ยินดีต้อนรับ (welcome)' },
      wait: { photo: 'attach://webhook-wait-1080x560.jpg', caption: 'รอโอน (waiting)' },
      process: { photo: 'attach://webhook-process-1080x560.jpg', caption: 'รอสักครู่ (processing)' },
      ocr: { photo: 'attach://webhook-ocr-1080x560.jpg', caption: 'OCR สำเร็จ (ocr ok)' },
      done: { photo: 'attach://webhook-success-1080x560.jpg', caption: 'สำเร็จแล้ว (sent)' },
    },
  };
}
