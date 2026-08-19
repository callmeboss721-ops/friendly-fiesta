import { Admin } from '@/types/transactions';

const { parseSlipText, computeShouldSend } = require('../src/bot/parse');
const { parseAmounts, parseAmountTokens } = require('../src/lib/amounts');
const {
  commandName,
  escapeTelegramHtml,
  isBootstrapAdmin,
  isLowConfidence,
  parseRecentLimit,
  parseSaveSlipArgs,
  slipFingerprint,
  requiresAdminAccess,
} = require('../src/lib/botSecurity');
const { pickExplicitThbAmount } = require('../src/lib/ocrAmount');
const UI = require('../src/lib/botUi');
const {
  getOcrAutoMin,
  getSupabaseAdminKey,
  getApiSecret,
  getBotToken,
  getTelegramWebhookSecret,
  getAppUrl,
  validateProductionEnvironment,
} = require('../src/lib/runtimeEnv');

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
  console.log(`PASS: ${msg}`);
}

function hasBalancedTelegramHtml(text: string): boolean {
  const allowed = new Set([
    'a', 'b', 'blockquote', 'code', 'del', 'em', 'i', 'ins', 'pre',
    's', 'span', 'strike', 'strong', 'tg-spoiler', 'u',
  ]);
  const tags = /<\/?([a-z][a-z0-9-]*)(?:\s+[^>]*)?>/giu;
  const stack: string[] = [];
  for (const match of text.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    if (!allowed.has(tag)) return false;
    if (match[0].startsWith('</')) {
      if (stack.pop() !== tag) return false;
    } else {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}

console.log('🧪 Running parse tests...');

const t1 = parseSlipText('ยอด 5,000 บาท ธนาคาร CIMB 2330 วันที่ 24/07/26 ผู้รับ นางสาว อัญยา ระดาบุตร');
assert(t1.amount === 5000, `amount 5000 (got ${t1.amount})`);
assert(t1.bank === 'CIMB', `bank CIMB (got ${t1.bank})`);
assert(t1.last4 === '2330', `last4 2330 (got ${t1.last4})`);
assert(t1.receiverName === 'อัญยา ระดาบุตร', `receiverName อัญยา ระดาบุตร (got ${t1.receiverName})`);
assert(t1.date === '24/07/26', `date 24/07/26 (got ${t1.date})`);

const t2 = parseSlipText('โอนสำเร็จ 12,500.50 THB ธนาคาร KBANK xxxx1234 เวลา 14:30');
assert(t2.amount === 12500.5, `amount 12500.5 (got ${t2.amount})`);
assert(t2.bank === 'KBANK', `bank KBANK (got ${t2.bank})`);
assert(t2.last4 === '1234', `last4 1234 (got ${t2.last4})`);
assert(t2.time === '14:30', `time 14:30 (got ${t2.time})`);

assert(computeShouldSend(5000, 42) === 119.05, `computeShouldSend(5000, 42) = 119.05 (got ${computeShouldSend(5000, 42)})`);
assert(computeShouldSend(1000, 35.5) === 28.17, `computeShouldSend(1000, 35.5) = 28.17 (got ${computeShouldSend(1000, 35.5)})`);
assert(computeShouldSend(0, 35.5) === 0, `computeShouldSend(0, 35.5) = 0`);

const explicit = parseAmounts('+500B -13.6U');
assert(explicit.thb?.value === 500 && explicit.thb?.sign === 1, 'accepts explicit +500B');
assert(explicit.usdt?.value === 13.6 && explicit.usdt?.sign === -1, 'accepts explicit -13.6U');
assert(parseAmountTokens('+500').length === 0, 'never infers THB when currency is missing');
assert(parseAmountTokens('-13.6').length === 0, 'never infers USDT when currency is missing');
assert(parseAmounts('500').hasBareNumber === true, 'flags bare amount for actionable error');
assert(parseAmounts('+500B +600B').ambiguous === true, 'rejects multiple THB amounts');
assert(parseAmountTokens('+500USDX').length === 0, 'rejects partial currency suffix matches');

assert(commandName('/recent_slips@cevault_bot 10') === 'recent_slips', 'parses command with bot mention');
assert(requiresAdminAccess('/recent_slips 10') === true, 'recent ledger requires admin access');
assert(requiresAdminAccess('/ยอด') === true, 'Thai ledger alias requires admin access');
assert(parseRecentLimit('/recent_slips') === 5, 'recent slips default limit is 5');
assert(parseRecentLimit('/recent_slips 20') === 20, 'recent slips accepts upper bound');
assert(parseRecentLimit('/recent_slips 21') === null, 'recent slips rejects limit above 20');
assert(parseSaveSlipArgs('/save_slip')?.thb === null, 'save slip accepts OCR amount confirmation');
assert(parseSaveSlipArgs('/save_slip +500B')?.thb === 500, 'save slip accepts explicit THB IN override');
const manualSlip = parseSaveSlipArgs('/save_slip +500B KBANK 7890');
assert(manualSlip?.bank === 'KBANK' && manualSlip?.last4 === '7890', 'save slip accepts explicit bank fallback');
assert(parseSaveSlipArgs('/save_slip 500') === null, 'save slip rejects amount without sign and currency');
assert(isBootstrapAdmin(123, '123,456') === true, 'bootstrap admin allowlist accepts configured id');
assert(isBootstrapAdmin(999, '123,456') === false, 'bootstrap admin allowlist rejects unknown id');
assert(escapeTelegramHtml('<Admin & Co>') === '&lt;Admin &amp; Co&gt;', 'escapes Telegram HTML input');
assert(slipFingerprint('stable-id') === slipFingerprint('stable-id'), 'slip fingerprint is deterministic');
assert(slipFingerprint('stable-id') !== slipFingerprint('other-id'), 'slip fingerprints differ');
assert(isLowConfidence(89.9) === true && isLowConfidence(90) === false, 'confidence threshold is exactly 90%');

const validProductionEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SECRET_KEY: `sb_secret_${'S'.repeat(32)}`,
  API_SECRET: 'a'.repeat(64),
  BOT_TOKEN: `123456:${'B'.repeat(32)}`,
  TELEGRAM_WEBHOOK_SECRET: 'webhook_secret_1234567890',
  ADMIN_TELEGRAM_IDS: '123456789,987654321',
  APP_URL: 'https://vault.example.com',
  DEFAULT_SELL_RATE: '35.5',
  DEFAULT_MARKET_RATE: '34.8',
  OCR_AUTO_MIN: '90',
  GROK_API_KEY: 'xai-test-key-not-a-placeholder',
};
assert(validateProductionEnvironment(validProductionEnv).length === 0, 'accepts complete production environment');
assert(getSupabaseAdminKey(validProductionEnv)?.startsWith('sb_secret_') === true, 'accepts new Supabase secret key');
assert(getOcrAutoMin({ OCR_AUTO_MIN: '80' }) === 90, 'never allows OCR threshold below 90%');
assert(
  validateProductionEnvironment({ ...validProductionEnv, OCR_AUTO_MIN: '80' })
    .some((issue: { key: string }) => issue.key === 'OCR_AUTO_MIN'),
  'rejects production OCR threshold below 90%',
);
assert(
  validateProductionEnvironment({
    ...validProductionEnv,
    TELEGRAM_WEBHOOK_SECRET: validProductionEnv.API_SECRET,
  }).some((issue: { key: string; code: string }) => issue.key === 'TELEGRAM_WEBHOOK_SECRET' && issue.code === 'conflict'),
  'requires webhook and API secrets to be independent',
);
assert(
  validateProductionEnvironment({ ...validProductionEnv, BOT_TOKEN: 'your-telegram-bot-token' })
    .some((issue: { key: string }) => issue.key === 'BOT_TOKEN'),
  'rejects placeholder secrets in production',
);

const netlifyLikeEnv = {
  NEXT_PUBLIC_SUPABASE_URL: validProductionEnv.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SECRET_KEY: validProductionEnv.SUPABASE_SECRET_KEY,
  BOT_TOKEN: validProductionEnv.BOT_TOKEN,
  ADMIN_TELEGRAM_IDS: validProductionEnv.ADMIN_TELEGRAM_IDS,
  URL: 'https://glittering-bienenstitch-f601e2.netlify.app',
  GROK_API_KEY: validProductionEnv.GROK_API_KEY,
};
assert(getBotToken(validProductionEnv) === validProductionEnv.BOT_TOKEN, 'reads a valid BOT_TOKEN at runtime');
assert(getBotToken({ BOT_TOKEN: 'your-telegram-bot-token' }) === null, 'rejects placeholder BOT_TOKEN at runtime');
assert(getBotToken({ BOT_TOKEN: 'not-a-token' }) === null, 'rejects malformed BOT_TOKEN at runtime');
assert(getAppUrl(netlifyLikeEnv) === 'https://glittering-bienenstitch-f601e2.netlify.app', 'APP_URL falls back to Netlify URL');
assert(typeof getApiSecret(netlifyLikeEnv) === 'string' && (getApiSecret(netlifyLikeEnv) as string).length === 64, 'derives API_SECRET from BOT_TOKEN');
assert(getApiSecret(netlifyLikeEnv) !== getTelegramWebhookSecret(netlifyLikeEnv), 'derived API and webhook secrets differ');
assert(validateProductionEnvironment(netlifyLikeEnv).length === 0, 'accepts Netlify production env without APP_URL/API_SECRET/rates');

assert(pickExplicitThbAmount('ยอดโอน 5,000.00 บาท') === 5000, 'OCR fallback accepts explicitly labelled THB');
assert(pickExplicitThbAmount('เลขอ้างอิง 999999 ยอดคงเหลือ 5000') === null, 'OCR fallback does not guess from unrelated numbers');
assert(pickExplicitThbAmount('ยอดโอน 500 บาท ยอดเงิน 600 บาท') === null, 'OCR fallback rejects conflicting explicit amounts');

const unclearUi = UI.slipUnclear(999999);
assert(unclearUi.text.includes('(OCR Failed)'), 'OCR unclear UI uses standard OCR Failed label');
assert(unclearUi.text.includes('+500B') && !unclearUi.text.includes('999999'), 'OCR unclear UI never guesses an amount');

const mismatchUi = UI.accountMismatch('<script>bad</script>');
assert(mismatchUi.text.includes('(Account Mismatch)'), 'account mismatch UI uses the enterprise status');
assert(!mismatchUi.text.includes('<script>'), 'account mismatch UI escapes dynamic HTML');

const pinsUi = UI.pinnedAccounts([{ bank: '<KBANK>', last4: '7890' }]);
assert(pinsUi.text.includes("(Today's Receiving Accounts)"), 'pinned account UI uses the bilingual heading');
assert(pinsUi.text.includes('&lt;KBANK&gt;') && !pinsUi.text.includes('<KBANK>'), 'pinned account UI escapes bank data');

const incomingUi = UI.incomingRecorded({
  transactionId: '00000000-0000-0000-0000-000000000001',
  ledgerRef: 'CE-TEST-0001',
  thb: 500,
  usdtOwed: 13.6,
  sellRate: 36.76,
  adminName: '<Admin>',
  bank: '<BANK>',
  last4: '1234',
  confidence: 90,
});
assert(
  incomingUi.text.includes('เข้า (IN)') &&
    incomingUi.text.includes('ต้องส่ง (Should Send)') &&
    incomingUi.text.includes('เรทขาย (Sell Rate)') &&
    incomingUi.text.includes('อ้างอิง (Reference)'),
  'recorded transaction UI follows the TH + EN terminology standard',
);
assert(!incomingUi.text.includes('<Admin>') && !incomingUi.text.includes('<BANK>'), 'transaction UI escapes operator and bank data');
assert(
  Array.isArray((incomingUi.reply_markup as any)?.inline_keyboard) &&
    JSON.stringify(incomingUi.reply_markup).includes('qa:today') &&
    JSON.stringify(incomingUi.reply_markup).includes('qa:rate'),
  'success card carries Quick Action inline keyboard',
);

const ledgerUi = UI.ledgerCard({
  incomingList: [{ time: '10:00', thb: 500, usdt: 13.6 }],
  outgoingList: [{ time: '10:05', usdt: 13.6 }],
  totalThb: 500,
  totalIncomingUsdt: 13.6,
  totalOutgoingUsdt: 13.6,
  fixedRate: 36.76,
  feePercent: 0,
  netProfitThb: 5,
  lastAdminName: '<Admin>',
  roomName: '<Room>',
});
assert(
  ledgerUi.text.includes('สรุปวันนี้') &&
    ledgerUi.text.includes("(Today's Summary)") &&
    ledgerUi.text.includes('กำไรสุทธิ (Net Profit)') &&
    ledgerUi.text.includes('ปริมาณ (Volume)') &&
    ledgerUi.text.includes('Settled'),
  'today ledger UI follows the enterprise summary standard',
);
assert(ledgerUi.text.length < 4096, 'today ledger UI stays within Telegram message limits');
assert(!ledgerUi.text.includes('<Admin>') && !ledgerUi.text.includes('<Room>'), 'today ledger UI escapes dynamic HTML');

const uiSamples = [
  UI.welcomeRegistered('<Admin>'),
  UI.amountFormatHelp(),
  UI.slipReady({ type: 'THB_DEPOSIT', thb: 500, confidence: 91, bank: '<BANK>', last4: '1234', chatRate: 36.76 }),
  UI.liveInitial('CE-TEST-0001', '<Admin>'),
  UI.liveOcrUpdate({ ledgerRef: 'CE-TEST-0001', thb: 500, receiver: '<Receiver>', bank: '<BANK>', confidence: 91, sellRate: 36.76, marketRate: 36.5, shouldSend: 13.6 }),
  UI.liveCompleted({ ledgerRef: 'CE-TEST-0001', thb: 500, usdt: 13.6, profitThb: 5, remaining: 0, todayTotalThb: 500 }),
  UI.dealConfirm({ ledgerRef: 'CE-TEST-0001', thb: 500, usdt: 13.6, buyRate: 36.5, sellRate: 36.76, profitThb: 5, receiverName: '<Receiver>', bank: '<BANK>', last4: '1234' }),
  UI.dealSuccess({ transactionId: '00000000-0000-0000-0000-000000000001', ledgerRef: 'CE-TEST-0001', adminName: '<Admin>', thb: 500, usdt: 13.6, buyRate: 36.5, sellRate: 36.76, profitThb: 5 }),
  UI.confirmDeposit(500, 13.6, 36.76),
  UI.confirmSend(13.6, 20),
  UI.rateShow(36.76, 36.5, 'manual'),
  UI.thbSuccess({ transactionId: '00000000-0000-0000-0000-000000000001', adminName: '<Admin>', thb: 500, usdt: 13.6, netProfitThb: 5, profitPercent: 1, feeUsdt: 0.1, feePercent: 0.7, holdingUsdt: 13.6 }),
  UI.usdtSendSuccess({ transactionId: '00000000-0000-0000-0000-000000000001', adminName: '<Admin>', usdt: 13.6, holdingUsdt: 0 }),
  UI.editPrompt(),
  ledgerUi,
  UI.menuCard(),
  UI.resetAsk('<Room>'),
  UI.receiverCard({ bank: '<BANK>', last4: '1234', name: '<Receiver>', totalTx: 1, totalThb: 500 }),
  UI.error('<failure>'),
  pinsUi,
];
assert(uiSamples.every((message: { text: string }) => message.text.length <= 4096), 'enterprise UI samples stay within Telegram message limits');
assert(uiSamples.every((message: { text: string }) => hasBalancedTelegramHtml(message.text)), 'enterprise UI samples use balanced Telegram HTML');

// ============================================================
// Direction handling: THB must be IN (+), USDT must be OUT (-)
// ============================================================
assert(parseAmounts('+500B').thb?.sign === 1, 'THB deposit is a positive direction (+500B)');
assert(parseAmounts('-13.6U').usdt?.sign === -1, 'USDT send is a negative direction (-13.6U)');
assert(parseAmounts('-500B').thb?.sign === -1, 'wrong-direction THB (-500B) is parsed with a negative sign for the handler to reject');
assert(parseAmounts('+13.6U').usdt?.sign === 1, 'wrong-direction USDT (+13.6U) is parsed with a positive sign for the handler to reject');
assert(parseAmounts('+500THB -13.6USDT').thb?.value === 500 && parseAmounts('+500THB -13.6USDT').usdt?.value === 13.6, 'accepts long currency suffixes +500THB -13.6USDT');
assert(parseAmounts('500').hasBareNumber === true && !parseAmounts('500').thb && !parseAmounts('500').usdt, 'bare "500" never resolves to an amount');

// ============================================================
// Money calculation: rounding, floating point, NaN, Infinity, zero, negatives, missing rate
// ============================================================
const {
  calculateProfit,
  calculateDepositProfit,
  round2,
  safeNumber,
} = require('../src/lib/profit');
const { calculateFee } = require('../src/lib/fees');

const finiteResult = (r: { costPerUnit: number; sellValueThb: number; netProfitThb: number; profitPercent: number }) =>
  [r.costPerUnit, r.sellValueThb, r.netProfitThb, r.profitPercent].every((n) => Number.isFinite(n));

const deposit = calculateDepositProfit(5000, 140, 34.8);
assert(round2(deposit.netProfitThb) === 128, `deposit profit 5000 THB / 140 USDT @34.8 = 128 (got ${deposit.netProfitThb})`);
assert(round2(deposit.profitPercent) === 2.56, `deposit profit percent = 2.56% (got ${deposit.profitPercent})`);
assert(finiteResult(calculateDepositProfit(1000, 0, 0)), 'deposit profit with zero usdt and zero rate stays finite');
assert(finiteResult(calculateDepositProfit(NaN, 10, 34.8)), 'deposit profit with NaN THB stays finite');
assert(finiteResult(calculateDepositProfit(1000, 10, Infinity)), 'deposit profit with Infinity rate stays finite');
assert(calculateProfit(1000, 0, 35).costPerUnit === 0, 'cost per unit is 0 when usdt is 0 (no division by zero)');
assert(finiteResult(calculateProfit(-5000, -140, -35)), 'profit calc with negative inputs stays finite');
const feeZeroRate = calculateFee(5000, 0, 140);
assert(feeZeroRate.expectedUsdt === 0 && Number.isFinite(feeZeroRate.feeUsdt) && Number.isFinite(feeZeroRate.feePercent), 'fee calc with missing rate is finite and expects 0 USDT');
assert(round2(calculateFee(5000, 34.8, 140).expectedUsdt) === 143.68, 'fee expected USDT rounds deterministically to 143.68');
assert(round2(0.1 + 0.2) === 0.3, 'round2 removes floating-point drift (0.1 + 0.2 -> 0.3)');
assert(round2(203.8000000000011) === 203.8, 'round2 fixes ledger drift to 203.8');
assert(safeNumber(1 / 0) === 0 && safeNumber(NaN) === 0 && safeNumber(42) === 42, 'safeNumber clamps NaN/Infinity to 0 and preserves finite values');

// ============================================================
// Pinned bank matching: match, mismatch, false-positive prevention, aliases
// ============================================================
const { matchPinnedBank, accountLast4 } = require('../src/lib/banks');
const pinnedBanks = [
  { id: 'b1', bank_name: 'KBANK', account_number: '1234567890', label: '' },
  { id: 'b2', bank_name: 'SCB', account_number: '9876543210', label: '' },
];
assert(matchPinnedBank('KBANK', '7890', pinnedBanks)?.id === 'b1', 'pinned bank matches on bank + last4');
assert(matchPinnedBank('KASIKORN', '7890', pinnedBanks)?.id === 'b1', 'pinned bank matches via bank alias (KASIKORN -> KBANK)');
assert(matchPinnedBank('SCB', '7890', pinnedBanks) === null, 'mismatch: correct last4 but wrong bank is rejected (no false positive)');
assert(matchPinnedBank('KBANK', '0000', pinnedBanks) === null, 'mismatch: correct bank but wrong last4 is rejected (no false positive)');
assert(matchPinnedBank(null, '7890', pinnedBanks) === null, 'match requires both bank and last4 (missing bank -> null)');
assert(matchPinnedBank('KBANK', null, pinnedBanks) === null, 'match requires both bank and last4 (missing last4 -> null)');
assert(matchPinnedBank('KBANK', '7890', []) === null, 'no pinned account for the day -> match returns null (blocks auto-save)');
assert(accountLast4('1234567890') === '7890' && accountLast4('12') === null, 'accountLast4 extracts trailing 4 digits and guards short input');

// ============================================================
// OCR confidence gating (never silently trust low/unknown confidence)
// ============================================================
assert(isLowConfidence(95, 90) === false, 'OCR confidence 95 >= 90 is trusted');
assert(isLowConfidence(89.9, 90) === true, 'OCR confidence 89.9 < 90 is flagged low');
assert(isLowConfidence(null) === true, 'OCR with null confidence is treated as low (never silently trusted)');
assert(isLowConfidence(undefined) === true, 'OCR with undefined confidence is treated as low');
assert(isLowConfidence(NaN) === true, 'OCR with NaN confidence is treated as low');

// ============================================================
// Ledger reference: format #CE-YYYYMMDD-XXXX + uniqueness (collision resistance)
// ============================================================
const ledgerFormat = /^CE-\d{8}-[0-9A-F]{8}$/;
assert(ledgerFormat.test(UI.newLedgerRef()), `ledger reference matches CE-YYYYMMDD-XXXX (got ${UI.newLedgerRef()})`);
const refs = new Set<string>();
for (let i = 0; i < 2000; i++) refs.add(UI.newLedgerRef());
assert(refs.size === 2000, `2000 ledger references are unique (got ${refs.size})`);

// ============================================================
// /recent_slips limit parsing (valid args + invalid number protection)
// ============================================================
assert(parseRecentLimit('/recent_slips') === 5, '/recent_slips defaults to 5');
assert(parseRecentLimit('/recent_slips 10') === 10, '/recent_slips 10 -> 10');
assert(parseRecentLimit('/recent_slips 20') === 20, '/recent_slips 20 -> 20 (upper bound)');
assert(parseRecentLimit('/recent_slips@cevault_bot 15') === 15, '/recent_slips honours bot mention suffix');
assert(parseRecentLimit('/recent_slips 21') === null, '/recent_slips rejects 21 (above bound)');
assert(parseRecentLimit('/recent_slips 0') === null, '/recent_slips rejects 0');
assert(parseRecentLimit('/recent_slips -5') === null, '/recent_slips rejects negative');
assert(parseRecentLimit('/recent_slips abc') === null, '/recent_slips rejects non-numeric argument');

// ============================================================
// /recent_slips rendering: empty state, required fields, escaping, length, mentions
// ============================================================
const emptySlips = UI.recentSlipsList([]);
assert(emptySlips.text.includes('สลิปล่าสุด') && emptySlips.text.includes('ยังไม่มีรายการ'), 'recent slips renders an empty state when there is no data');

const sampleSlips = [
  {
    ledgerRef: 'CE-20260819-AABBCCDD', type: 'THB_DEPOSIT', time: '04:13',
    thb: 5000, usdt: 140, sellRate: 35.5,
    adminName: 'Boss', adminTelegramId: 123456789,
    receiverName: 'อัญยา', receiverBank: 'KBANK', receiverLast4: '1234',
  },
  {
    ledgerRef: 'CE-20260819-11223344', type: 'USDT_SEND', time: '04:15',
    thb: 0, usdt: 100, sellRate: null,
    adminName: 'Boss', adminTelegramId: null,
    receiverName: null, receiverBank: null, receiverLast4: null,
  },
];
const rendered = UI.recentSlipsList(sampleSlips);
assert(rendered.text.includes('CE-20260819-AABBCCDD'), 'recent slips shows the ledger reference');
assert(rendered.text.includes('5,000 THB') && rendered.text.includes('140 USDT'), 'recent slips shows THB and USDT amounts');
assert(rendered.text.includes('35.5'), 'recent slips shows the sell rate when present');
assert(rendered.text.includes('04:13'), 'recent slips shows the transaction time');
assert(rendered.text.includes('tg://user?id=123456789'), 'recent slips mentions admins via tg://user when telegram id is present');
assert(rendered.text.includes('อัญยา') && rendered.text.includes('1234'), 'recent slips shows receiver details when available');
assert(hasBalancedTelegramHtml(rendered.text), 'recent slips uses balanced Telegram HTML');

const maliciousSlips = [
  {
    ledgerRef: '<b>evil</b>', type: 'THB_DEPOSIT', time: '00:00',
    thb: 1, usdt: 1, sellRate: 1,
    adminName: '<script>alert(1)</script>', adminTelegramId: null,
    receiverName: '<img src=x>', receiverBank: '<i>', receiverLast4: '9999',
  },
];
const escaped = UI.recentSlipsList(maliciousSlips);
assert(!escaped.text.includes('<script>') && escaped.text.includes('&lt;script&gt;'), 'recent slips escapes malicious admin name from the database');
assert(!escaped.text.includes('<img src=x>') && escaped.text.includes('&lt;img'), 'recent slips escapes malicious receiver name from the database');
assert(hasBalancedTelegramHtml(escaped.text), 'recent slips stays valid HTML even with hostile database values');

const manySlips = Array.from({ length: 20 }, (_, i) => ({
  ledgerRef: `CE-20260819-${String(i).padStart(8, '0')}`, type: 'THB_DEPOSIT', time: '04:13',
  thb: 999999, usdt: 99999, sellRate: 35.5,
  adminName: 'Operator With A Fairly Long Display Name', adminTelegramId: 111111111 + i,
  receiverName: 'ผู้รับที่มีชื่อยาวพอสมควรสำหรับการทดสอบความยาว', receiverBank: 'KBANK', receiverLast4: '1234',
}));
assert(UI.recentSlipsList(manySlips).text.length <= 4096, 'recent slips never exceeds the Telegram 4096-character limit');

// ============================================================
// /save_slip + admin-only command authorization
// ============================================================
assert(requiresAdminAccess('/save_slip') === true, '/save_slip requires admin access');
assert(requiresAdminAccess('/save_slip +500B') === true, '/save_slip with args requires admin access');
assert(requiresAdminAccess('/pin KBANK 1234567890') === true, '/pin requires admin access');
assert(requiresAdminAccess('/unpin 1') === true, '/unpin requires admin access');
assert(requiresAdminAccess('สวัสดี') === false, 'plain chat does not require admin access');
assert(parseSaveSlipArgs('/save_slip +500B KBANK 7890')?.bank === 'KBANK', '/save_slip parses explicit bank via alias normalisation');
assert(parseSaveSlipArgs('/save_slip +500') === null, '/save_slip rejects amount without currency');

console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
