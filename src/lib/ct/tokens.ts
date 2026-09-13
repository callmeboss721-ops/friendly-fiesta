/** CE Vault terminal visual tokens.
 * Telegram bots cannot send animated emoji. Static emoji + Unicode bars only.
 * Animation = editMessage frames (AiTransition) + ▓░░░░ fill.
 */

export const MARK = '\u25C8';
export const NODE = '\u2B22';
export const RAIL = '\u2503';
export const RULE = '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501';
export const DOT_ON = '\u25CF';
export const DOT_OFF = '\u25CB';

export const CROWN = '\u{1F451}';
export const GEM = '\u{1F48E}';
export const BOLT = '\u26A1';
export const SPARK = '\u2728';
export const HOUR = '\u23F3';
export const SPIN = '\u{1F504}';
export const OK = '\u2705';
export const IN_DOT = '\u{1F7E2}';
export const OUT_DOT = '\u{1F534}';
export const CASH = '\u{1F4B0}';

export const STEPS = ['BANK', 'PIN', 'DEPOSIT', 'OCR', 'MATCH', 'SETTLE', 'AUDIT'] as const;
export type FlowStep = 'scan' | 'match' | 'in' | 'wait' | 'done';

const STEP_INDEX: Record<FlowStep, number> = {
  scan: 3,
  match: 4,
  in: 4,
  wait: 5,
  done: 6,
};

const STEP_PCT: Record<FlowStep, number> = {
  scan: 57,
  match: 71,
  in: 71,
  wait: 86,
  done: 100,
};

const STEP_EMOJI: Record<FlowStep, string> = {
  scan: HOUR,
  match: SPIN,
  in: IN_DOT,
  wait: CASH,
  done: OK,
};

const NOW: Record<FlowStep, string> = {
  scan: 'กำลังอ่านสลิป (scanning)',
  match: 'กำลังเทียบบัญชี (matching)',
  in: 'อ่านครบแล้ว → รอคนยืนยัน (ready)',
  wait: 'รับเงินแล้ว → รอโอน USDT (queued)',
  done: 'โอนครบแล้ว (settled)',
};

const CHIP: Record<string, string> = {
  AGENT: 'อ่านสลิป (OCR)',
  สรุปยอด: 'VAULT',
  เงินเข้า: 'ยอดรับเข้า (IN)',
  ยอดรับเข้า: 'ยอดรับเข้า (IN)',
  รอโอน: 'รอโอน (WAIT)',
  รอรวมยอด: 'รอโอน (WAIT)',
  โอนแล้ว: 'โอนสำเร็จ (DONE)',
  โอนสำเร็จ: 'โอนสำเร็จ (DONE)',
  แจ้งเตือน: 'แจ้งเตือน (ALERT)',
  ตั้งค่า: 'ตั้งค่า (SETTINGS)',
  บัญชีรับ: 'บัญชีรับเงินวันนี้ (PINS)',
  อัตราแลกเปลี่ยน: 'เราขาย (DESK)',
  รายการ: 'รายการ (LEDGER)',
  เลือกห้อง: 'เลือกห้อง (ROOMS)',
};

/** 16-cell Unicode bar. Telegram shows this as static text; fill changes per edit. */
export function bar(pct: number, width = 16): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const fill = Math.round((p / 100) * width);
  return `${'\u2593'.repeat(fill)}${'\u2591'.repeat(width - fill)} ${p}%`;
}

export function brandLine(): string {
  return `${CROWN}${GEM}  <b>CE · VAULT</b>  ${GEM}${CROWN}`;
}

export function progress(step: FlowStep): string {
  const idx = STEP_INDEX[step];
  const dots = STEPS.map((_, i) => (i <= idx ? DOT_ON : DOT_OFF)).join('\u2500\u2500');
  return [
    dots + `  <b>${STEPS[idx]}</b>`,
    `${STEP_EMOJI[step]} ${NOW[step]}`,
    `<code>${bar(STEP_PCT[step])}</code>`,
  ].join('\n');
}

export function head(status: string, meta?: string): string {
  const chip = CHIP[status] ?? status;
  const line = `${brandLine()}\n${MARK}  <b>${chip}</b>`;
  return meta ? `${line}\n${meta}` : line;
}

export function rule(): string {
  return RULE;
}

export function spoiler(text: string): string {
  return `<tg-spoiler>${text}</tg-spoiler>`;
}

export function quote(text: string, expandable = true): string {
  return expandable
    ? `<blockquote expandable>${text}</blockquote>`
    : `<blockquote>${text}</blockquote>`;
}

export function kv(th: string, en: string, value: string): string {
  return `${th}  <i>(${en})</i>\n${value}`;
}

export function term(cmd: string, en: string, value?: string): string {
  const headLine = `> ${cmd}  <i>(${en})</i>`;
  return value ? `${headLine}\n  ${value}` : headLine;
}
