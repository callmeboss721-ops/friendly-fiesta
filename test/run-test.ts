import { Admin } from '@/types/transactions';

const { parseSlipText, computeShouldSend, parseDeskPin, parseDeskRate, hasRatePrefix, isBareDeskRate, parseTelegramId, last4FromPayeeMask, nameFromPayee } = require('../src/bot/parse');
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
  normalizeBankCode,
  bankLabel,
} = require('../src/lib/botSecurity');
const { pickExplicitThbAmount } = require('../src/lib/ocrAmount');
const UI = require('../src/lib/botUi');
const { calculateDepositProfit } = require('../src/lib/profit');
const { calculateFee } = require('../src/lib/fees');
const { vaultKpi } = require('../src/lib/ct/vaultKpi');
const { VaultEngine } = require('../src/lib/ct/vaultEngine');
const {
  getBotToken,
  getOcrAutoMin,
  getSupabaseAdminKey,
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

const lineBk = parseSlipText(`โอนเงินสำเร็จ
฿365.00
24 ส.ค. 69 08:45:35
จาก น.ส. มาลัย ภ กสิกรไทย xxx-x-x9434-x
ไปยัง บจก. พิมพ์ใจ คลีนนิ่งรูมแอนด์คอนโด กสิกรไทย xxx-x-x5012-x
ค่าธรรมเนียม ฿0.00
LINE BK Powered by KBank`);
assert(lineBk.amount === 365, `LINE BK amount 365 (got ${lineBk.amount})`);
assert(lineBk.last4 === '5012', `LINE BK last4 is payee 5012 not sender 9434 (got ${lineBk.last4})`);
const { slipFromTyphoonJson } = require('../src/lib/typhoon');
const ty = slipFromTyphoonJson(`{
  "thbAmount": 1020,
  "feeThb": 0,
  "time": "08:45:35",
  "date": "07/09/2026",
  "receiverAccount": "145-3-58306-2",
  "senderAccount": "666-1-26034-3",
  "receiverLast4": "8306",
  "senderLast4": "0343",
  "bank": "KBANK",
  "senderBank": "KTB",
  "receiverName": "เอกรินทร์",
  "senderName": "สุพัตรา อั้นเจริญ",
  "transRef": "016238120625COR004437",
  "channel": "KPLUS",
  "promptpay": null,
  "balanceThb": 50000,
  "slipType": "TRANSFER",
  "confidence": 94
}`);
assert(ty.thbAmount === 1020, 'typhoon amount 1020');
assert(ty.receiverAccount === '145-3-58306-2', 'typhoon full payee account');
assert(ty.senderAccount === '666-1-26034-3', 'typhoon full payer account');
assert(ty.receiverName === 'เอกรินทร์', 'typhoon payee name');
assert(ty.balanceThb === 50000, 'typhoon balance open');
assert(ty.bank === 'KBANK', 'typhoon bank KBANK');

const named = slipFromTyphoonJson(`{"thbAmount":1020,"bank":"กสิกรไทย","senderBank":"กรุงไทย","receiverLast4":"8306"}`);
assert(named.bank === 'KBANK', 'thai bank name maps to KBANK');
assert(named.senderBank === 'KTB', 'thai sender bank maps to KTB');
const masked = slipFromTyphoonJson(
  `{"receiverLast4":"0343","senderLast4":"0343"}`,
  `ไปยัง บจก. พิมพ์ใจ กสิกรไทย xxx-x-x8306-x\nจาก น.ส. มาลัย xxx-x-x0343-x`,
);
assert(masked.receiverLast4 === '8306', 'payee mask beats swapped last4');

assert(last4FromPayeeMask(`จาก น.ส. มาลัย กสิกรไทย xxx-x-x9434-x
ไปยัง บจก. พิมพ์ใจ กสิกรไทย xxx-x-x5012-x`) === '5012', 'payee mask ignores sender');
assert(last4FromPayeeMask(`กรุงไทย
xxx-x-x6034-x
เลขที่รายการ: 016238120625COR004437
จำนวน: 1,020.00 บาท`) === '6034', 'Krungthai incoming last4 is 6034 not COR ref');

const ktbPin = parseDeskPin(`ชื่อเต็ม: สุพัตรา อั้นเจริญ
ธนาคาร: กรุงไทย
เลขบัญชี: xxx-x-x6034-x`);
assert(ktbPin?.bank === 'KTB', `ชื่อเต็ม pin bank KTB (got ${ktbPin?.bank})`);
assert(ktbPin?.name === 'สุพัตรา อั้นเจริญ', `pin name สุพัตรา (got ${ktbPin?.name})`);

const kplusName = nameFromPayee(`โอนเงินสำเร็จ
นาย ซอฟวัน ก
ธ.กสิกรไทย
xxx-x-x5521-x
สุพัตรา อั้นเจริญ
ธ.กรุงไทย
xxx-x-x6034-x
จำนวน: 1,020.00 บาท`);
assert(kplusName === 'สุพัตรา อั้นเจริญ', `K+ payee name (got ${kplusName})`);
assert(nameFromPayee('ไปยัง สุพัตรา อั้นเจริญ x-0343') === 'สุพัตรา อั้นเจริญ', `ไปยัง name (got ${nameFromPayee('ไปยัง สุพัตรา อั้นเจริญ x-0343')})`);

const { matchPinnedBank, accountLast4, accountLast4Candidates } = require('../src/lib/banks');
const pins = [{ id: '1', bank_name: 'KTB', account_number: 'xx6034', label: 'KTB' }];
assert(matchPinnedBank('SCB', '6034', pins)?.id === '1', 'match pin by last4 even if OCR bank is wrong');
assert(matchPinnedBank('KTB', '0343', pins) == null, 'do not match sender last4 0343');
assert(accountLast4('xxx-x-x6034-x') === '6034', 'mask last4 6034');

const livePin = parseDeskPin(`✍️ ชื่อเต็ม: สุพัตรา อั้นเจริญ 
🏦 ธนาคาร: กรุงไทย (KTB)
📝 บัญชี: 6661260343
📱วงเงินธุรกรรม/วัน = 500,000฿`);
assert(livePin?.bank === 'KTB', `live pin bank KTB (got ${livePin?.bank})`);
assert(livePin?.account === '6661260343', `live pin account (got ${livePin?.account})`);
assert(livePin?.name === 'สุพัตรา อั้นเจริญ', `live pin name (got ${livePin?.name})`);
assert(livePin?.limit === 500000, `live pin limit (got ${livePin?.limit})`);
const scbPin = parseDeskPin(`ชื่อ : เรืองรอง ชมขวัญ
เลขบัญชี : 4371699895
ธนาคาร : ไทยพาณิชย
วงเงิน : ???`);
assert(scbPin?.bank === 'SCB', `ไทยพาณิชย maps to SCB (got ${scbPin?.bank})`);
assert(scbPin?.account === '4371699895', `scb pin account (got ${scbPin?.account})`);
assert(scbPin?.name === 'เรืองรอง ชมขวัญ', `scb pin name (got ${scbPin?.name})`);
assert(scbPin?.limit == null, 'วงเงิน ??? is unknown not a number');
assert(normalizeBankCode('ไทยพาณิชย') === 'SCB', 'ธนาคารไทยพาณิช without ์');
assert(normalizeBankCode('เกียรตินาคินภัทร') === 'KKP', 'เกียรตินาคิน maps to KKP');
assert(normalizeBankCode('ยูโอบี') === 'UOB', 'ยูโอบี maps to UOB');
assert(normalizeBankCode('ธนชาต') === 'TTB', 'ธนชาต maps to TTB');
assert(bankLabel('กสิกรไทย') === 'กสิกร (KBANK)', 'label กสิกร (KBANK)');
assert(bankLabel('SCB') === 'ไทยพาณิชย์ (SCB)', 'label ไทยพาณิชย์ (SCB)');
assert(normalizeBankCode('004') === 'KBANK', 'BOT 004 maps to KBANK');
assert(normalizeBankCode('14') === 'SCB', 'BOT 14 pads to 014 SCB');
assert(normalizeBankCode('006') === 'KTB', 'BOT 006 maps to KTB');
assert(normalizeBankCode('999') === null, 'unknown BOT code is not a bank');
assert(bankLabel('004') === 'กสิกร (KBANK)', 'label from BOT code');
const { bankIdentity, identityOfOcr, identityOfMatch, identityOfSettlement, identityOfDeposit } = require('../src/lib/ct/bankIdentity');
assert(bankIdentity('ไทยพาณิชย์').code === 'SCB', 'identity catalog SCB');
assert(bankIdentity('ไทยพาณิชย์').bankCode === 'SCB', 'identity business SCB');
assert(bankIdentity('LHBANK').code === 'LH', 'LH BANK catalog code stays LH');
assert(bankIdentity('LHBANK').localAsset.includes('/banks/lh.svg'), 'LH presentation mark');
assert(bankIdentity('ซีไอเอ็มบี').code === 'CIMB', 'CIMB catalog');
assert(bankIdentity('ธ.ก.ส').code === 'BAAC', 'BAAC catalog');
assert(bankIdentity('').known === false, 'empty bank is unknown');
assert(bankIdentity('NOPEBANK').code === 'UNKNOWN', 'unknown bank fallback catalog');
assert(bankIdentity('NOPEBANK').bankCode === 'NOPEBANK', 'unknown keeps business token');
const ocrId = identityOfOcr({ bank: 'กสิกร', account: '145-3-58306-2', thb: 5000, confidence: 94 });
const depId = identityOfDeposit({ bank: 'KBANK', account: '145-3-58306-2', thb: 5000 });
const setId = identityOfSettlement({ bank: 'KBANK', depositThb: 5000 });
assert(ocrId.identity.bankCode === depId.identity.bankCode && depId.identity.bankCode === setId.identity.bankCode, 'OCR / deposit / settlement share identity');
assert(ocrId.account === '145-3-58306-2', 'identity does not mask account');
const matched = identityOfMatch('SCB', { id: '1', bank_name: 'SCB', account_number: '4371699895', label: 'เรืองรอง' });
assert(matched.matched === true, 'match uses business bankCode');
const { requiredUsdt: requiredUsdtFromCard } = require('../src/lib/ct/settlementMath');
assert(requiredUsdtFromCard({ depositThb: 5000, depositCount: 1, roomRate: 42 }) === 119.05, 'identity layer does not change settlement math');
assert(normalizeBankCode('KPLUS') === null, 'KPLUS channel is not a bank');
assert(normalizeBankCode('SCB_EASY') === null, 'SCB_EASY channel is not a bank');
assert(normalizeBankCode('กสิกร K PLUS') === 'KBANK', 'กสิกร still maps with app name');
assert(normalizeBankCode('SCB') === 'SCB', 'plain SCB still maps');
assert(normalizeBankCode('ttb') === 'TTB', 'ttb alias is exact');
assert(normalizeBankCode('uob') === 'UOB', 'uob alias is exact');
assert(normalizeBankCode('lhbank') === 'LH', 'lhbank alias is exact');
assert(normalizeBankCode('notcimbpay') !== 'CIMB', 'cimb is not a substring match');
const livePins = [{ id: 's', bank_name: 'KTB', account_number: '6661260343', label: 'สุพัตรา' }];
assert(accountLast4Candidates('6661260343').includes('0343'), 'true last4 0343');
assert(accountLast4Candidates('6661260343').includes('6034'), 'KTB mask 6034');
assert(matchPinnedBank('KTB', '6034', livePins)?.id === 's', 'slip 6034 matches account 6661260343');
assert(matchPinnedBank('KTB', '0343', livePins)?.id === 's', 'slip 0343 matches account 6661260343');
assert(matchPinnedBank('KTB', '5521', livePins) == null, 'sender 5521 does not match');

const deskPin = parseDeskPin(`BBL วงเงิน 150k
ชื่อ-สกุล :  วุฒิ บุญสุข
เลขบัญชี : 0989887823
bank : กรุงเทพ`);
assert(deskPin?.bank === 'BBL', `desk pin BBL (got ${deskPin?.bank})`);
assert(deskPin?.account === '0989887823', `desk pin account (got ${deskPin?.account})`);
assert(Boolean(deskPin?.name && deskPin.name.includes('วุฒิ')), `desk pin name (got ${deskPin?.name})`);
assert(parseDeskPin('/pin KBANK 1234567890')?.bank === 'KBANK', 'slash pin KBANK');
assert(parseDeskPin('BBL 1234567890') == null, 'bare bank+acct in group is not a pin');
assert(parseDeskRate('40') === 40, 'desk rate 40');
assert(parseDeskRate('เรตแลก 36.65') === 36.65, 'desk rate thai prefix');
assert(parseDeskRate('/setrate 36.70') === 36.70, 'setrate command');
assert(parseDeskRate('/rate 36.70') === 36.70, 'rate command');
assert(parseDeskRate('500') === null, '500 is not a desk rate');

assert(computeShouldSend(5000, 42) === 119.05, `computeShouldSend(5000, 42) = 119.05 (got ${computeShouldSend(5000, 42)})`);
assert(computeShouldSend(1000, 35.5) === 28.17, `computeShouldSend(1000, 35.5) = 28.17 (got ${computeShouldSend(1000, 35.5)})`);
assert(computeShouldSend(0, 35.5) === 0, `computeShouldSend(0, 35.5) = 0`);
assert(calculateDepositProfit(1000, 28.17, 35.5).netProfitThb === -0.04, 'deposit profit uses decimal rounding');
assert(calculateFee(1000, 35.5, 28.17).expectedUsdt === 28.17, 'fee expected USDT rounds half up');
const kpiSample = vaultKpi([
  { ledger: 'CE-1', short: 'CE-1', thb: 1000, expectedUsdt: 28.17, sentUsdt: 28.17, status: 'SETTLED', pending: false, profitThb: 5 },
  { ledger: 'CE-2', short: 'CE-2', thb: 500, expectedUsdt: 14.09, sentUsdt: 10, status: 'WAIT', pending: true, profitThb: 2 },
  { ledger: 'CE-2', short: 'CE-2', thb: 500, expectedUsdt: 14.09, sentUsdt: 10, status: 'WAIT', pending: true, profitThb: 2 },
]);
assert(kpiSample.received === 1500 && kpiSample.pending === 4.09 && kpiSample.negative === 4.09, 'vault KPI derives unique ledger totals');
assert(VaultEngine.verifyReceive({ thb: 1000, rate: 35.5, confidence: 95, pinMatch: true }).expectedUsdt === 28.17, 'VaultEngine uses decimal expected USDT');

const explicit = parseAmounts('+500B -13.6U');
assert(explicit.thb?.value === 500 && explicit.thb?.sign === 1, 'accepts explicit +500B');
assert(explicit.usdt?.value === 13.6 && explicit.usdt?.sign === -1, 'accepts explicit -13.6U');
assert(parseAmountTokens('+500').length === 0, 'never infers THB when currency is missing');
assert(parseAmountTokens('-13.6').length === 0, 'never infers USDT when currency is missing');
assert(parseAmounts('500').hasBareNumber === true, 'flags bare amount for actionable error');
assert(parseAmounts('+500B +600B').ambiguous === true, 'rejects multiple THB amounts');
assert(parseAmountTokens('+500USDX').length === 0, 'rejects partial currency suffix matches');

assert(commandName('/recent_slips@cevault_bot 10') === 'recent_slips', 'parses command with bot mention');
const { isPrivateOnlyCommand, GROUP_COMMANDS, PRIVATE_COMMANDS } = require('../src/lib/telegram/botCommands');
assert(isPrivateOnlyCommand('start') === true, 'start is private-only');
assert(isPrivateOnlyCommand('rate') === false, 'rate is allowed in groups');
assert(GROUP_COMMANDS.every((c: { command: string }) => c.command !== 'start'), 'group menu hides start');
assert(PRIVATE_COMMANDS.some((c: { command: string }) => c.command === 'start'), 'private menu shows start');
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
  TELEGRAM_WEBHOOK_SECRET: ['webhook', 'secret', '1234567890'].join('_'),
  ADMIN_TELEGRAM_IDS: '123456789,987654321',
  APP_URL: 'https://vault.example.com',
  DEFAULT_SELL_RATE: '35.5',
  DEFAULT_MARKET_RATE: '34.8',
  OCR_AUTO_MIN: '90',
  GROK_API_KEY: 'xai-test-key-not-a-placeholder',
};
assert(validateProductionEnvironment(validProductionEnv).length === 0, 'accepts complete production environment');
const { DEFAULT_SELL_RATE: _s, DEFAULT_MARKET_RATE: _m, ...prodWithoutDefaults } = validProductionEnv as any;
assert(validateProductionEnvironment(prodWithoutDefaults).length === 0, 'desk rate is per-room, not required in env');
assert(getSupabaseAdminKey(validProductionEnv)?.startsWith('sb_secret_') === true, 'accepts new Supabase secret key');
assert(getBotToken({ TELEGRAM_bot_SECRET: validProductionEnv.BOT_TOKEN }) === validProductionEnv.BOT_TOKEN, 'accepts existing Telegram bot token alias');
assert(getBotToken({ bot_token_api: validProductionEnv.BOT_TOKEN }) === validProductionEnv.BOT_TOKEN, 'accepts connector bot token alias');
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

const { gateOcr } = require('../src/lib/ct/gate');
assert(gateOcr({ thb: 500, confidence: 98, pinMatch: true }) === 'IN_READY', 'OCR >=70 pin match is IN_READY');
assert(gateOcr({ thb: 500, confidence: 65, pinMatch: true }) === 'IN_READY_REVIEW', 'OCR 40-69 pin match is review');
assert(gateOcr({ thb: 500, confidence: 30, pinMatch: true }) === 'OCR_WEAK', 'OCR <40 is weak');
assert(gateOcr({ thb: 500, confidence: 99, pinMatch: false }) === 'PIN_MISMATCH', 'pin mismatch never ready');
assert(gateOcr({ thb: null, confidence: 99, pinMatch: true }) === 'NEED_UNIT', 'missing amount is NEED_UNIT');

const CT = require('../src/lib/ct/copy');
const { parseCb, isCtCallback } = require('../src/lib/ct/callbacks');
assert(isCtCallback('slip:lock:A4F2') && isCtCallback('vault:today'), 'CT callback domains');
assert(parseCb('slip:amt:A4F2:+500B').extra === '+500B', 'callback extra amount preserved');
assert(parseCb('slip:lock:a4f2').ref === 'A4F2', 'short ref is uppercased');
const inReady = CT.cardInReady({
  review: false, thb: 10000, shouldSend: 250, desk: 40, mkt: 34.84,
  bank: 'SCB', last4: '3303', name: 'อัญญา ระดาบุตร', confidence: 95,
  ledger: 'CE-20260826-A4F2', adminName: 'Admin A', short: 'A4F2',
});
assert(inReady.text.includes('THB') || inReady.text.includes('บาท'), 'IN_READY amount table');
assert(inReady.text.includes('กำไร'), 'IN_READY pnl');
assert(inReady.text.includes('ตีเป็น USDT'), 'IN_READY converts at desk rate');
assert(inReady.text.includes('เรทอ้างอิง'), 'IN_READY market');
assert(inReady.text.includes('IN'), 'IN_READY progress tape');
assert(inReady.text.includes('●──'), 'IN_READY dots');
assert(inReady.text.includes('OCR') || inReady.text.includes('MATCH'), 'IN_READY rail');
assert(inReady.text.includes('<blockquote'), 'IN_READY amount quote');
assert(inReady.text.includes('#CE-20260826-A4F2'), 'ledger id with hash');
assert(JSON.stringify(inReady.reply_markup).includes('slip:lock:A4F2'), 'lock callback present');
assert(inReady.rich && Array.isArray(inReady.rich.blocks), 'IN_READY includes rich JSON');
assert(inReady.rich.blocks.some((b: { type: string }) => b.type === 'table'), 'IN_READY rich table');
assert(inReady.rich.blocks.some((b: { type: string }) => b.type === 'heading'), 'IN_READY rich heading');
assert(inReady.rich.blocks.some((b: { type: string }) => b.type === 'buttons'), 'IN_READY rich buttons');
const { cardExamples } = require('../src/lib/ct/cardJson');
const pack = cardExamples();
assert(pack.sendRichMessage.method === 'sendRichMessage', 'example method sendRichMessage');
assert(pack.sendPhoto.wait.photo.includes('webhook-wait'), 'example wait photo');
assert(pack.sendPhoto.ocr.photo.includes('webhook-ocr'), 'example ocr photo');
assert(pack.sendPhoto.process.photo.includes('webhook-process'), 'example process photo');
assert(pack.sendPhoto.start.photo.includes('webhook-welcome'), 'example welcome photo');
assert(pack.sendRichMessage.pin.blocks.some((b: { type: string }) => b.type === 'table'), 'pin card json table');
assert(hasBalancedTelegramHtml(inReady.text), 'IN_READY html balanced');
assert(/[👑💎⚡✨]/u.test(inReady.text), 'IN_READY uses static brand emoji');

const { stillFromTelegram, decodeStillFrame, isLivePhoto } = require('../src/lib/ct/livePhoto');
assert(stillFromTelegram({ live_photo: { photo: [{ file_id: 'lp1', file_unique_id: 'u1' }] }, photo: [{ file_id: 'p1' }] }).fileId === 'lp1', 'live photo prefers still frame');
assert(stillFromTelegram({ photo: [{ file_id: 'a' }, { file_id: 'b', file_unique_id: 'ub' }] }).fileId === 'b', 'plain photo uses largest size');
assert(
  stillFromTelegram({
    photo: [
      { file_id: 'big', width: 1280, height: 720 },
      { file_id: 'small', width: 90, height: 90 },
    ],
  }).fileId === 'big',
  'unsorted photo uses largest area',
);
assert(stillFromTelegram({ live_photo: { file_id: 'clip-only' } }) == null, 'live clip without still is ignored');
assert(isLivePhoto({ live_photo: { photo: [{ file_id: 'x' }] } }) === true, 'isLivePhoto true');
assert(isLivePhoto({ photo: [{ file_id: 'x' }] }) === false, 'plain photo is not live');
assert(decodeStillFrame(Buffer.from('not-a-jpeg')) == null, 'decode still rejects junk');
assert(decodeStillFrame(Buffer.alloc(0)) == null, 'decode still rejects empty');

const { aiReceived } = require('../src/lib/ct/aiTransition');
const liveOpen = aiReceived({ live: true });
assert(liveOpen.text.includes('LIVE PHOTO'), 'live opening names still frame');
assert(liveOpen.text.includes('ภาพนิ่ง'), 'live opening Thai still copy');
assert(liveOpen.text.includes('<blockquote'), 'live opening uses quote effect');
assert(hasBalancedTelegramHtml(liveOpen.text), 'live opening html balanced');
const slipOpen = aiReceived({ live: false });
assert(slipOpen.text.includes('SLIP PHOTO'), 'plain slip opening');

const { renderHeroPng, renderScanPng } = require('../src/lib/ct/cardImage');
const pngMagic = Buffer.from([137, 80, 78, 71]);
const hero = renderHeroPng('locked', { hero: '500 THB', sub: 'IN', meta: 'A4F2' });
assert(hero.slice(0, 4).equals(pngMagic), 'hero png signature');
assert(hero.length > 800, 'hero png has body');
const scan = renderScanPng({ sweep: 0.4, live: true });
assert(scan.slice(0, 4).equals(pngMagic), 'scan png signature');
assert(scan.length > 800, 'scan png has body');
const scanB = renderScanPng({ sweep: 0.8, live: true });
assert(!scan.equals(scanB), 'scan beam moves between frames');
const { brandCard, heroPng } = require('../src/lib/ct/brandCards');
const doneCard = brandCard('success');
const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
assert(doneCard.slice(0, 3).equals(jpegMagic) || doneCard.slice(0, 4).equals(pngMagic), 'success card is jpeg or png');
assert(doneCard.length > 800, 'success card has body');
const waitCard = heroPng('locked');
assert(waitCard.slice(0, 3).equals(jpegMagic) || waitCard.slice(0, 4).equals(pngMagic), 'wait card is jpeg or png');

const vault = CT.vaultBanner({
  mode: 'today', dateLabel: '26 Aug', clock: '03:59',
  inThb: 0, inCount: 0, inRows: [], outUsdt: 0, outCount: 0, outRows: [],
  pendingUsdt: 0, desk: 36.7, mkt: 36.52, pendingShorts: [],
});
assert(vault.text.includes('◈') && vault.text.includes('VAULT'), 'empty vault density');
assert(vault.text.includes('quiet.'), 'empty vault microcopy');
assert(vault.text.includes('ผลรวมวันนี้') && vault.text.includes('ฝาก') && vault.text.includes('ค้างเคลียร์'), 'vault totals banner');
assert(hasBalancedTelegramHtml(vault.text), 'vault html balanced');
assert(/[👑💎]/u.test(vault.text), 'vault uses static brand emoji');

const {
  matchReplyCommand,
  parseCb: parseCb2,
  isCtCallback: isCt2,
  SLIP_ACTIONS,
  VAULT_ACTIONS,
  PIN_ACTIONS,
  ADMIN_ACTIONS,
  ROOM_ACTIONS,
} = require('../src/lib/ct/callbacks');
const { adminKeyboard } = require('../src/lib/ct/format');

const padBtns = adminKeyboard().keyboard.flat() as Array<{ text: string; web_app?: { url: string } }>;
const pad = padBtns.filter((b) => !b.web_app).map((b) => b.text);
assert(JSON.stringify(pad) === JSON.stringify(['ยอดวันนี้', 'รอส่ง', 'อัตรา', 'บัญชีรับ', 'ตั้งค่า', 'วันใหม่', 'เลือกห้อง']), 'reply pad labels');
assert(padBtns.some((b) => b.text === 'เปิด VAULT' && b.web_app), 'reply pad launches Mini App for sendData');
const padMap: Record<string, string> = {
  'ยอดวันนี้': 'vault',
  'รอส่ง': 'pending',
  'บัญชีรับ': 'pin',
  'อัตรา': 'rate',
  'ตั้งค่า': 'settings',
  'วันใหม่': 'newday',
  'เลือกห้อง': 'rooms',
};
for (const label of pad) {
  assert(matchReplyCommand(label) === padMap[label], `pad ${label} wired`);
}

const sample = {
  review: false, thb: 500, shouldSend: 13.62, desk: 36.7, mkt: 32.71,
  bank: 'BBL', last4: '7823', name: 'วุฒิ', confidence: 96,
  ledger: 'CE-20260826-A4F2', adminName: 'RAZEN', short: 'A4F2',
};
const cards = [
  CT.cardInReady(sample),
  CT.cardOcrWeak({ bank: 'BBL', last4: '7823', name: 'วุฒิ', confidence: 40, short: 'A4F2', chips: [500, 1000] }),
  CT.cardLocked({ thb: 500, shouldSend: 13.62, desk: 36.7, mkt: 32.71, bank: 'BBL', last4: '7823', name: 'วุฒิ', ledger: 'CE-20260826-A4F2', adminName: 'RAZEN', time: '06:20', short: 'A4F2', canUndo: true }),
  CT.vaultBanner({
    mode: 'today', dateLabel: '26 Aug', clock: '03:59',
    inThb: 500, inCount: 1,
    inRows: [{ thb: 500, usdt: 13.62, time: '06:20', short: 'A4F2', pending: true }],
    outUsdt: 0, outCount: 0, outRows: [], pendingUsdt: 13.62, desk: 36.7, mkt: 32.71,
    pendingShorts: ['A4F2'],
  }),
  CT.pinView([{ bank: 'BBL', last4: '7823' }]),
  CT.settingsCard({ desk: 36.7, mkt: 32.71, pins: [], admins: [], roomName: 'ห้อง A' }),
  CT.roomPicker({
    currentName: 'ห้อง A',
    currentId: -1001,
    rooms: [
      { chatId: -1001, name: 'ห้อง A', desk: 36.7, current: true },
      { chatId: -1002, name: 'ห้อง B', desk: 36.5 },
    ],
  }),
];
function collectCbs(card: { reply_markup?: any }): string[] {
  const rows = card.reply_markup?.inline_keyboard ?? [];
  return rows.flat().map((b: any) => b.callback_data).filter(Boolean);
}
function collectBtns(card: { reply_markup?: any }): Array<{ text: string; callback_data?: string; style?: string; web_app?: { url: string } }> {
  const rows = card.reply_markup?.inline_keyboard ?? [];
  return rows.flat();
}
const cbs = cards.flatMap(collectCbs);
assert(cbs.length > 0, 'cards expose callbacks');
for (const data of cbs) {
  assert(isCt2(data), `callback domain ${data}`);
  const cb = parseCb2(data);
  if (cb.domain === 'slip') assert(SLIP_ACTIONS.has(cb.action), `slip action ${cb.action} from ${data}`);
  if (cb.domain === 'vault') assert(VAULT_ACTIONS.has(cb.action), `vault action ${cb.action} from ${data}`);
  if (cb.domain === 'pin') assert(PIN_ACTIONS.has(cb.action), `pin action ${cb.action} from ${data}`);
  if (cb.domain === 'admin') assert(ADMIN_ACTIONS.has(cb.action), `admin action ${cb.action} from ${data}`);
  if (cb.domain === 'room') assert(ROOM_ACTIONS.has(cb.action), `room action ${cb.action} from ${data}`);
}
assert(collectCbs(CT.cardInReady(sample)).includes('slip:lock:A4F2'), 'keep → lock');
assert(collectCbs(CT.cardInReady(sample)).includes('slip:queue:A4F2'), 'queue later');
assert(collectCbs(CT.cardLocked({ ...sample, time: '06:20', canUndo: true })).includes('slip:settle:A4F2'), 'sent → settle');
const queued = CT.cardLocked({
  ...sample, time: '17:26', canUndo: true, queued: true,
  batch: { count: 5, thb: 34150, usdt: 830.52, target: 200000, remain: 165850, ready: false },
});
assert(queued.text.includes('คงเหลือ') || queued.text.includes('วงเงินเหลือ'), 'queue leftover is a number not a formula');
assert(!queued.text.includes('ครับ'), 'queue copy has no polite suffix');
assert(!queued.text.includes('need sent'), 'queue copy has no english stub');
assert(!queued.text.includes('200,000-'), 'queue copy does not dump arithmetic');
assert(collectCbs(CT.pinView([{ bank: 'BBL', last4: '7823' }])).includes('pin:unpin:1'), 'unpin 1');
const pinFull = CT.pinView([{ bank: 'KBANK', last4: '8306', account: '145-3-58306-2', name: 'เอกรินทร์', limit: 50000, usedThb: 12000, txCount: 3 }]);
assert(pinFull.text.includes('เอกรินทร์') && pinFull.text.includes('145-3-58306-2'), 'pin shows name and full account');
assert(pinFull.text.includes('วงเงิน') && pinFull.text.includes('ใช้แล้ว') && pinFull.text.includes('3 รายการ'), 'pin shows limit used count');
assert(!CT.welcome('RAZEN').text.includes('1. '), 'start card is not a tutorial');
assert(collectCbs(CT.welcome('RAZEN')).includes('room:list'), 'private start has เลือกห้อง');
assert(collectBtns(CT.welcome('RAZEN')).some((b) => b.text === 'เปิดโต๊ะ'), 'private start has เปิดโต๊ะ');
assert(matchReplyCommand('36.70') === null, 'bare rate number is not a pad command');
assert(hasRatePrefix('36.70') === false, 'bare number is not an explicit rate command');
assert(hasRatePrefix('/setrate 36.70') === true, 'setrate is explicit');
assert(isBareDeskRate('36.70') === true, '36.70 is a bare desk rate token');
assert(isBareDeskRate('โอน 36.70 แล้ว') === false, 'rate inside chat is not bare');
assert(VAULT_ACTIONS.has('set'), 'settings callback exists');
assert(VAULT_ACTIONS.has('batch'), 'batch settle callback exists');
assert(isCt2('room:here') && isCt2('room:list') && isCt2('room:use:-1001'), 'room callbacks are CT');
assert(ROOM_ACTIONS.has('here') && ROOM_ACTIONS.has('list') && ROOM_ACTIONS.has('use'), 'room actions registered');
assert(collectCbs(CT.settingsCard({ desk: 36.7, mkt: 32.71, pins: [], admins: [] })).includes('room:here'), 'settings stay-room');
assert(collectCbs(CT.settingsCard({ desk: 36.7, mkt: 32.71, pins: [], admins: [] })).includes('room:list'), 'settings switch-room');
const roomBtns = collectBtns(CT.roomPicker({
  currentName: 'ห้อง A',
  currentId: -1001,
  rooms: [
    { chatId: -1001, name: 'ห้อง A', desk: 36.7, current: true },
    { chatId: -1002, name: 'ห้อง B', desk: 36.5 },
  ],
}));
assert(roomBtns.some((b) => b.callback_data === 'room:here' && b.style === 'success'), 'stay room is green');
assert(roomBtns.some((b) => b.callback_data === 'room:list' && b.style === 'primary'), 'switch room is blue');
assert(roomBtns.some((b) => b.callback_data === 'room:use:-1002' && b.style === 'primary'), 'other room is blue');
const goStop = collectBtns(CT.cardInReady(sample));
assert(goStop.some((b) => b.callback_data === 'slip:lock:A4F2' && b.style === 'success'), 'confirm is green');
assert(goStop.some((b) => b.callback_data === 'slip:cancel:A4F2' && b.style === 'danger'), 'cancel is red');
assert(goStop.some((b) => b.callback_data === 'slip:queue:A4F2' && b.style === 'primary'), 'hold-queue is blue');
assert(VAULT_ACTIONS.has('batch'), 'batch settle callback exists');
const { batchProgress, canAutoQueue, BATCH_THB } = require('../src/lib/ct/queue');
assert(BATCH_THB === 10000, 'batch target 10000');
assert(batchProgress(4110).remain === 5890, 'remain to 10k');
assert(batchProgress(10000).ready === true, 'ready at 10k');
assert(canAutoQueue('IN_READY', 1090, 36.7) === true, 'auto queue matched slip');
assert(canAutoQueue('PIN_MISMATCH', 1090, 36.7) === false, 'do not auto queue mismatch');
assert(canAutoQueue('IN_READY', 10_000_000, 36.7) === false, 'do not auto queue OCR 10M');
assert(collectCbs(CT.cardLocked({ ...sample, time: '06:20', canUndo: true, queued: true, batch: { count: 4, thb: 4110, usdt: 112, target: 10000, remain: 5890, ready: false } })).includes('vault:batch'), 'locked card exposes batch');
assert(matchReplyCommand('/admin') === 'addadmin', '/admin asks for id');
assert(parseTelegramId('/admin 5676959274') === 5676959274, '/admin + telegram id');
assert(parseTelegramId('5676959274') === 5676959274, 'bare telegram id parses');
assert(parseTelegramId('โอน 5676959274 แล้ว') === null, 'id inside chat is ignored');
assert(collectCbs(CT.settingsCard({ desk: 36.7, mkt: 32.7, pins: [], admins: [] })).includes('admin:add'), 'settings has add-admin');

const { publicAppHost } = require('../src/lib/og/publicHost');
assert(publicAppHost('ce-vault.vercel.app') === 'ce-vault.vercel.app', 'project vercel host allowed for og');
assert(publicAppHost('vercel.app') === '', 'bare vercel.app blocked for og');
assert(publicAppHost('preview.grok.me') === 'preview.grok.me', 'public host allowed for og');
assert(publicAppHost('127.0.0.1') === '', 'ip blocked for og');

const { parseTelegramUpdate, largestPhotoFileId } = require('../src/lib/telegram/update');
assert(parseTelegramUpdate({}) === null, 'update without id is invalid');
assert(parseTelegramUpdate({ update_id: 3 }).kind === 'ignored', 'unknown update is ignored');
assert(
  largestPhotoFileId([
    { file_id: 'small', width: 90, height: 90 },
    { file_id: 'big', width: 1280, height: 720 },
  ]) === 'big',
  'ocr uses largest photo',
);
const slip = parseTelegramUpdate({
  update_id: 8,
  message: {
    chat: { id: -1001, type: 'supergroup' },
    from: { id: 55 },
    photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 1280, height: 720 }],
    caption: 'กสิกร 145-3-58306-2',
  },
});
assert(slip.kind === 'message' && slip.photoFileId === 'big' && slip.chatId === -1001, 'slip message parsed');
const tap = parseTelegramUpdate({
  update_id: 9,
  callback_query: { id: 'cq', from: { id: 55 }, data: 'ct:keep:CE-1042', message: { chat: { id: -1001 } } },
});
assert(tap.kind === 'callback' && tap.callbackData === 'ct:keep:CE-1042', 'callback parsed');

const webapp = parseTelegramUpdate({
  update_id: 10,
  message: {
    chat: { id: -1001, type: 'supergroup' },
    from: { id: 55 },
    web_app_data: { data: JSON.stringify({ v: 1, action: 'vault:batch' }), button_text: 'เปิด VAULT' },
  },
});
assert(webapp.kind === 'webapp' && webapp.webAppData.includes('vault:batch') && webapp.chatId === -1001, 'web_app_data parsed');

const { settlementState, requiredUsdt, canConfirmSettlement, mapSettlementAction, cardSettlement, claimSettlementConfirm, resetSettlementConfirm, validateSettlement, STATUS_CONFIG } = require('../src/lib/ct/settlementRich');
const readyCard = { depositThb: 10000, depositCount: 2, roomRate: 40, sentUsdt: null };
assert(requiredUsdt(readyCard) === 250, 'required USDT is thb/rate');
assert(settlementState(readyCard) === 'READY', 'no send is READY');
assert(settlementState({ ...readyCard, sentUsdt: 250 }) === 'MATCHED', 'exact send is MATCHED');
assert(settlementState({ ...readyCard, sentUsdt: 260 }) === 'EXCESS', 'over send is EXCESS');
assert(settlementState({ ...readyCard, sentUsdt: 200 }) === 'SHORT', 'under send is SHORT');
assert(settlementState({ ...readyCard, settled: true, sentUsdt: 250 }) === 'SETTLED', 'flag is SETTLED');
assert(canConfirmSettlement(readyCard) === true, 'READY with queue can confirm');
assert(canConfirmSettlement({ ...readyCard, settled: true }) === false, 'SETTLED cannot confirm');
assert(canConfirmSettlement({ ...readyCard, depositThb: 0 }) === false, 'zero deposit cannot confirm');
assert(mapSettlementAction('settlement_confirm') === 'vault:batch', 'python confirm maps to batch');
assert(mapSettlementAction('settlement_details') === 'vault:pending', 'python details maps to pending');
assert(mapSettlementAction('drop-table') === null, 'unknown webapp action rejected');
assert(STATUS_CONFIG.MATCHED.message.includes('ยอดตรง'), 'matched copy is Thai');
assert(validateSettlement({ depositThb: 0, depositCount: 1, roomRate: 0 }).length >= 2, 'empty card lists deposit+rate errors');

resetSettlementConfirm();
assert(claimSettlementConfirm('tg:1:9') === true, 'first confirm allowed');
assert(claimSettlementConfirm('tg:1:9') === false, 'duplicate confirm blocked inside 2s');
assert(claimSettlementConfirm('tg:2:9') === true, 'other room still allowed');

const settleUi = cardSettlement(readyCard);
assert(hasBalancedTelegramHtml(settleUi.text), 'settlement card HTML is balanced');
assert(settleUi.text.includes('เคลียร์ยอด') && settleUi.text.includes('READY'), 'settlement card has status');
assert(settleUi.text.includes('กรุณาส่งตามจำนวนที่คำนวณ'), 'READY uses spec status line');
assert(!settleUi.text.includes('disable'), 'no fake disabled button field');
const settleCbs = collectCbs(settleUi);
assert(settleCbs.includes('vault:batch') && settleCbs.includes('vault:today'), 'settlement uses live CT callbacks');
assert(collectBtns(settleUi).some((b) => b.web_app && String(b.web_app.url).includes('ce-empire-miniapp')), 'settlement has Mini App button');
assert(settleUi.text.length < 4096, 'settlement card within Telegram limit');

const matchedUi = cardSettlement({ ...readyCard, sentUsdt: 250 });
assert(matchedUi.text.includes('MATCHED') && matchedUi.text.includes('+0.00'), 'matched shows zero diff with sign');
const excessUi = cardSettlement({ ...readyCard, sentUsdt: 260 });
assert(excessUi.text.includes('EXCESS') && excessUi.text.includes('+10.00'), 'excess shows +diff');
const shortUi = cardSettlement({ ...readyCard, sentUsdt: 200 });
assert(shortUi.text.includes('SHORT') && shortUi.text.includes('-50.00'), 'short shows -diff');
const settledUi = cardSettlement({ ...readyCard, sentUsdt: 250, settled: true, rail: 'sol-usdc', fromAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', destAddress: '4Nd1m3NnENa8h8Xte1y9PxZJTSrwaXzbF6UvLSH5u8nN' });
assert(settledUi.text.includes('SETTLED') && settledUi.text.includes('USDC'), 'settled sol rail shows USDC');
assert(settledUi.text.includes('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), 'from address shown in full');

const { looksLikeSolAddr, looksLikeTronAddr, parsePayoutWallet, payoutInputErrors, normalizePayoutInput, railLabel } = require('../src/lib/ct/payoutWallet');
const SOL_A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TRON_A = `T${'1'.repeat(33)}`;
assert(looksLikeSolAddr(SOL_A) === true, 'sol addr accepted');
assert(looksLikeTronAddr(TRON_A) === true, 'tron addr accepted');
assert(looksLikeTronAddr('0xabc') === false, 'eth is not tron');
const wallet = normalizePayoutInput({ rail: 'sol-usdc', label: 'บ้าน A', fromAddress: SOL_A, destAddress: 'bad' });
assert(payoutInputErrors(wallet).some((e: string) => e.includes('Solana')), 'bad dest flagged');
assert(parsePayoutWallet({ rail: 'manual-trc20', label: 'A', fromAddress: TRON_A, destAddress: '', walletId: '', updatedAt: 'x' })?.rail === 'manual-trc20', 'parse trc20 wallet');
assert(railLabel('sol-usdc').includes('Solana'), 'rail label is staff Thai');

const { parseWebAppPayload, verifyWebAppInitData } = require('../src/lib/ct/webAppInit');
assert(parseWebAppPayload('{"v":1,"action":"vault:batch"}').action === 'vault:batch', 'json payload parsed');
assert(parseWebAppPayload('settlement_confirm').action === 'settlement_confirm', 'plain action parsed');
assert(parseWebAppPayload('{"action":"rm -rf"}') === null, 'payload allowlist rejects junk');
const { createHmac } = require('crypto');
const token = '123456:TESTTOKEN';
const user = JSON.stringify({ id: 55 });
const auth = String(Math.floor(Date.now() / 1000));
const fields: Record<string, string> = { auth_date: auth, query_id: 'AA', user };
const dataCheck = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
const initData = `auth_date=${auth}&query_id=AA&user=${encodeURIComponent(user)}&hash=${hash}`;
assert(verifyWebAppInitData(initData, token).ok === true, 'initData HMAC verifies');
assert(verifyWebAppInitData(initData, token).userId === 55, 'initData user id parsed');
assert(verifyWebAppInitData(initData.replace(hash, '0'.repeat(64)), token).ok === false, 'bad hash rejected');

const { miniAppUrl, webAppBtn } = require('../src/lib/ct/format');
assert(miniAppUrl('done').startsWith('https://') && miniAppUrl('done').includes('screen=done'), 'mini app https + screen');
assert(miniAppUrl('done', { thb: 10000, count: 2, rate: 40, sent: 250, state: 'MATCHED' }).includes('thb=10000'), 'mini app carries live snapshot');
assert(!miniAppUrl('vault').includes('thb='), 'vault pad url stays compact');
assert(webAppBtn('เปิด VAULT', miniAppUrl()).web_app.url.startsWith('https://'), 'web_app button shape');
assert(JSON.stringify(adminKeyboard()).includes('web_app'), 'reply keyboard launches Mini App for sendData');
assert(collectBtns(CT.welcome('CE')).some((b) => b.web_app), 'welcome exposes Mini App');
assert(hasBalancedTelegramHtml(CT.cardSettledBatch({ count: 2, thb: 10000, usdt: 250, adminName: 'A' }).text), 'batch settled HTML');

console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
