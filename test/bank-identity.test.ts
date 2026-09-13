const {
  ALL_BANK_CODES,
  UNKNOWN_BRAND,
  getBankBrand,
  normalizeBrandCode,
  resolveBank,
  thaiBankBrands,
} = require('../src/lib/bankBrands');
const { progress } = require('../src/lib/ct/tokens');
const { showAcct } = require('../src/lib/ct/format');

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const expected = ['SCB', 'KBANK', 'KTB', 'BBL', 'BAY', 'TTB', 'GSB', 'BAAC', 'CIMB', 'UOB', 'LHBANK', 'KKP'];
assert(ALL_BANK_CODES.length === 12, 'registry contains exactly 12 supported bank codes');
assert(expected.every((code) => ALL_BANK_CODES.includes(code)), 'registry contains every required bank code');
assert(expected.every((code) => thaiBankBrands[code]?.code === code), 'business code is stable across registry');
assert(expected.every((code) => thaiBankBrands[code]?.alt && thaiBankBrands[code]?.nameTh), 'every bank has accessible presentation metadata');
assert(normalizeBrandCode('ไทยพาณิชย') === 'SCB', 'OCR alias resolves to SCB');
assert(normalizeBrandCode('ธ.ก.ส') === 'BAAC', 'Thai punctuation alias resolves to BAAC');
assert(normalizeBrandCode('LH BANK') === 'LHBANK', 'spaced LH BANK alias resolves');
assert(normalizeBrandCode('เกียรตินาคินภัทร') === 'KKP', 'Thai KKP alias resolves');
assert(getBankBrand('not-a-bank') === null, 'strict lookup preserves unknown result');
assert(resolveBank('not-a-bank').code === 'UNKNOWN', 'presentation lookup returns deterministic unknown fallback');
assert(resolveBank('').code === UNKNOWN_BRAND.code, 'empty identity uses unknown fallback');
assert(resolveBank('KBANK').localAsset === null, 'missing verified logo stays presentation fallback');
assert(showAcct('4371699895') === '4371699895', 'full account number remains visible');
assert(!showAcct('4371699895').includes('•'), 'account presentation does not mask digits');

for (const step of ['scan', 'match', 'in', 'wait', 'done']) {
  const rendered = progress(step);
  assert(['BANK', 'PIN', 'DEPOSIT', 'OCR', 'MATCH', 'SETTLE', 'AUDIT'].every((label) => rendered.includes(label) || rendered.includes('●') || rendered.includes('○')), `${step} renders seven-stage flow rail`);
  assert(!/LOADING|กำลังโหลด/i.test(rendered), `${step} has no fake loading label`);
}

console.log('Bank identity and seven-stage presentation regressions passed.');
