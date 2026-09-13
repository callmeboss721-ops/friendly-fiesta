import { catalogCode, getBankBrand, type BankBrand, type ThaiBankCode } from '../bankBrands';
import { normalizeBankCode } from '../botSecurity';
import type { PinnedBank } from '../banks';

/** Single identity shared by OCR, pins, deposit, match, settlement, audit. */
export type BankIdentity = BankBrand & {
  /** Business code from normalizeBankCode. UNKNOWN when unmapped. */
  bankCode: string;
  known: boolean;
};

export type PinnedBankView = {
  identity: BankIdentity;
  account: string;
  name: string | null;
  limit: number | null;
};

export type DepositView = {
  identity: BankIdentity;
  account: string | null;
  amountThb: number;
};

export type OCRResultView = {
  identity: BankIdentity;
  account: string | null;
  amountThb: number | null;
  confidence: number | null;
};

export type MatchResult = {
  identity: BankIdentity;
  pin: PinnedBank | null;
  matched: boolean;
};

export type SettlementView = {
  identity: BankIdentity;
  depositThb: number;
};

export type AuditLog = {
  entityId: string;
  bankCode: string;
  from: string;
  to: string;
  actorId: string;
  occurredAt: string;
};

export function bankIdentity(raw: string | null | undefined): BankIdentity {
  const bankCode = normalizeBankCode(raw) || 'UNKNOWN';
  const brand = getBankBrand(bankCode);
  const known = catalogCode(bankCode) !== 'UNKNOWN';
  return {
    ...brand,
    bankCode: known ? bankCode : (normalizeBankCode(raw) ? bankCode : 'UNKNOWN'),
    known,
    alt: known ? brand.alt : (bankCode !== 'UNKNOWN' ? `${brand.alt} · ${bankCode}` : brand.alt),
  };
}

export function identityOfPin(pin: { bank_name?: string | null; bankName?: string | null; account_number?: string | null; accountNumber?: string | null; label?: string | null; daily_limit_thb?: number | null }): PinnedBankView {
  const bank = pin.bank_name || pin.bankName || '';
  const account = String(pin.account_number || pin.accountNumber || '').trim();
  return {
    identity: bankIdentity(bank),
    account,
    name: pin.label || null,
    limit: pin.daily_limit_thb ?? null,
  };
}

export function identityOfOcr(input: {
  bank?: string | null;
  account?: string | null;
  last4?: string | null;
  thb?: number | null;
  confidence?: number | null;
}): OCRResultView {
  return {
    identity: bankIdentity(input.bank),
    account: input.account || input.last4 || null,
    amountThb: input.thb ?? null,
    confidence: input.confidence ?? null,
  };
}

export function identityOfDeposit(input: { bank?: string | null; account?: string | null; thb: number }): DepositView {
  return {
    identity: bankIdentity(input.bank),
    account: input.account || null,
    amountThb: input.thb,
  };
}

export function identityOfMatch(ocrBank: string | null | undefined, pin: PinnedBank | null): MatchResult {
  const identity = bankIdentity(ocrBank || pin?.bank_name);
  const ocr = normalizeBankCode(ocrBank);
  const pinCode = pin ? normalizeBankCode(pin.bank_name) : null;
  return {
    identity,
    pin,
    matched: Boolean(ocr && pinCode && ocr === pinCode),
  };
}

export function identityOfSettlement(input: { bank?: string | null; depositThb: number }): SettlementView {
  return { identity: bankIdentity(input.bank), depositThb: input.depositThb };
}

export function catalogCodes(): ThaiBankCode[] {
  return ['KBANK', 'SCB', 'KTB', 'BBL', 'BAY', 'TTB', 'GSB', 'BAAC', 'CIMB', 'UOB', 'LH', 'KKP'];
}
