/**
 * Canonical Thai bank identity.
 *
 * Business identity is the `code` (ThaiBankCode). Everything else on BankBrand
 * — display names, alt text, logo asset, brand color — is presentation metadata
 * and MUST NOT drive matching, settlement, or any business logic.
 *
 * OCR, pinned accounts, deposits, match, settlement, and audit all resolve a
 * bank through `resolveBank()` so they share one identity. Unknown input returns
 * a deterministic UNKNOWN fallback presentation, never a thrown error and never
 * an invented logo.
 */

export type ThaiBankCode =
  | 'SCB'
  | 'KBANK'
  | 'KTB'
  | 'BBL'
  | 'BAY'
  | 'TTB'
  | 'GSB'
  | 'BAAC'
  | 'CIMB'
  | 'UOB'
  | 'LHBANK'
  | 'KKP';

export type BankCode = ThaiBankCode | 'UNKNOWN';

export interface BankBrand {
  /** Business identity. Stable, uppercase, never derived from the logo. */
  code: BankCode;
  nameTh: string;
  nameEn: string;
  /** Accessible label used for aria-label / alt text. */
  alt: string;
  /** Presentation-only brand color for the identity chip. */
  color: string;
  /** Presentation-only local logo path under /assets/banks. */
  localAsset: string | null;
  officialSource: string | null;
  verifiedAt: string | null;
}

interface BrandSeed extends Omit<BankBrand, 'code' | 'alt'> {
  code: ThaiBankCode;
  /** Extra spellings emitted by OCR / APIs / pinned rows. Uppercased on lookup. */
  aliases: string[];
}

const SEED: Record<ThaiBankCode, BrandSeed> = {
  SCB: {
    code: 'SCB',
    nameTh: 'ธนาคารไทยพาณิชย์',
    nameEn: 'Siam Commercial Bank',
    color: '#4e2a84',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['SCB', 'ไทยพาณิชย์', 'ไทยพาณิชย', 'SIAMCOMMERCIAL', 'SICO', '014'],
  },
  KBANK: {
    code: 'KBANK',
    nameTh: 'ธนาคารกสิกรไทย',
    nameEn: 'Kasikornbank',
    color: '#0a7d3e',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['KBANK', 'KASIKORN', 'KASIKORNBANK', 'กสิกร', 'กสิกรไทย', 'KBNK', '004'],
  },
  KTB: {
    code: 'KTB',
    nameTh: 'ธนาคารกรุงไทย',
    nameEn: 'Krung Thai Bank',
    color: '#00a4e4',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['KTB', 'KRUNGTHAI', 'KRUNGTHAIBANK', 'กรุงไทย', '006'],
  },
  BBL: {
    code: 'BBL',
    nameTh: 'ธนาคารกรุงเทพ',
    nameEn: 'Bangkok Bank',
    color: '#1e4598',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['BBL', 'BANGKOKBANK', 'BANGKOK', 'กรุงเทพ', 'BKB', '002'],
  },
  BAY: {
    code: 'BAY',
    nameTh: 'ธนาคารกรุงศรีอยุธยา',
    nameEn: 'Bank of Ayudhya (Krungsri)',
    color: '#fec43b',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['BAY', 'KRUNGSRI', 'AYUDHYA', 'กรุงศรี', 'กรุงศรีอยุธยา', '025'],
  },
  TTB: {
    code: 'TTB',
    nameTh: 'ธนาคารทหารไทยธนชาต',
    nameEn: 'TMBThanachart Bank',
    color: '#ecb01f',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['TTB', 'TMB', 'THANACHART', 'TMBTHANACHART', 'ทหารไทยธนชาต', 'ทีทีบี', 'ธนชาต', '011'],
  },
  GSB: {
    code: 'GSB',
    nameTh: 'ธนาคารออมสิน',
    nameEn: 'Government Savings Bank',
    color: '#eb198d',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['GSB', 'GOVERNMENTSAVINGS', 'ออมสิน', '030'],
  },
  BAAC: {
    code: 'BAAC',
    nameTh: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',
    nameEn: 'Bank for Agriculture and Agricultural Cooperatives',
    color: '#1a9c49',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['BAAC', 'ธกส', 'ธ.ก.ส', 'เกษตร', '034'],
  },
  CIMB: {
    code: 'CIMB',
    nameTh: 'ธนาคารซีไอเอ็มบีไทย',
    nameEn: 'CIMB Thai Bank',
    color: '#7a1f2b',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['CIMB', 'CIMBTHAI', 'ซีไอเอ็มบี', 'ซีไอเอ็มบีไทย', '022'],
  },
  UOB: {
    code: 'UOB',
    nameTh: 'ธนาคารยูโอบี',
    nameEn: 'United Overseas Bank (Thai)',
    color: '#005eb8',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['UOB', 'UNITEDOVERSEAS', 'ยูโอบี', '024'],
  },
  LHBANK: {
    code: 'LHBANK',
    nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์',
    nameEn: 'Land and Houses Bank',
    color: '#6c568b',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['LHBANK', 'LHB', 'LANDANDHOUSES', 'แลนด์แอนด์เฮ้าส์', 'แลนด์', '073'],
  },
  KKP: {
    code: 'KKP',
    nameTh: 'ธนาคารเกียรตินาคินภัทร',
    nameEn: 'Kiatnakin Phatra Bank',
    color: '#6e3b8e',
    localAsset: null,
    officialSource: null,
    verifiedAt: null,
    aliases: ['KKP', 'KIATNAKIN', 'KIATNAKINPHATRA', 'เกียรตินาคิน', 'เกียรตินาคินภัทร', '069'],
  },
};

function withAlt(seed: BrandSeed): BankBrand {
  return {
    code: seed.code,
    nameTh: seed.nameTh,
    nameEn: seed.nameEn,
    alt: `${seed.nameTh} (${seed.nameEn})`,
    color: seed.color,
    localAsset: seed.localAsset,
    officialSource: seed.officialSource,
    verifiedAt: seed.verifiedAt,
  };
}

export const thaiBankBrands: Record<ThaiBankCode, BankBrand> = Object.fromEntries(
  (Object.keys(SEED) as ThaiBankCode[]).map((code) => [code, withAlt(SEED[code])]),
) as Record<ThaiBankCode, BankBrand>;

export const UNKNOWN_BRAND: BankBrand = {
  code: 'UNKNOWN',
  nameTh: 'ธนาคารอื่น',
  nameEn: 'Other bank',
  alt: 'ธนาคารอื่น (Other bank)',
  color: '#5a6b82',
  localAsset: null,
  officialSource: null,
  verifiedAt: null,
};

const ALIAS_INDEX: Map<string, ThaiBankCode> = (() => {
  const index = new Map<string, ThaiBankCode>();
  for (const code of Object.keys(SEED) as ThaiBankCode[]) {
    index.set(code, code);
    for (const alias of SEED[code].aliases) {
      index.set(normalizeKey(alias), code);
    }
  }
  return index;
})();

function normalizeKey(value: string): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[\s._·\-()]/g, '')
    .replace(/BANK$/, '')
    .replace(/ธนาคาร/g, '')
    .trim();
}

/** Resolve a bank code from any OCR / API / pin spelling. null when unknown. */
export function normalizeBrandCode(value: string): ThaiBankCode | null {
  if (!value) return null;
  const key = normalizeKey(value);
  if (!key) return null;
  if (ALIAS_INDEX.has(key)) return ALIAS_INDEX.get(key)!;
  const asCode = key.replace(/[^A-Z]/g, '');
  if (asCode && ALIAS_INDEX.has(asCode)) return ALIAS_INDEX.get(asCode)!;
  return null;
}

/** Strict lookup: known brand or null. */
export function getBankBrand(value: string): BankBrand | null {
  const code = normalizeBrandCode(value);
  return code ? thaiBankBrands[code] : null;
}

/**
 * Presentation resolver used across every flow stage. Always returns a brand:
 * a known one, or the UNKNOWN fallback carrying the original label so the UI can
 * still show what OCR read without inventing a logo.
 */
export function resolveBank(value: string | null | undefined): BankBrand {
  const known = value ? getBankBrand(value) : null;
  if (known) return known;
  const label = String(value ?? '').trim();
  if (!label) return UNKNOWN_BRAND;
  return { ...UNKNOWN_BRAND, nameTh: label, alt: `${label} (ธนาคารอื่น)` };
}

export function isKnownBank(value: string | null | undefined): boolean {
  return value ? normalizeBrandCode(value) != null : false;
}

export const ALL_BANK_CODES: ThaiBankCode[] = Object.keys(SEED) as ThaiBankCode[];
