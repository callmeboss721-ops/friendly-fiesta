import { normalizeBankCode } from './botSecurity';

/** Catalog codes for presentation marks. Business matching still uses normalizeBankCode. */
export type ThaiBankCode =
  | 'KBANK'
  | 'SCB'
  | 'KTB'
  | 'BBL'
  | 'BAY'
  | 'TTB'
  | 'GSB'
  | 'BAAC'
  | 'CIMB'
  | 'UOB'
  | 'LH'
  | 'KKP'
  | 'UNKNOWN';

export interface BankBrand {
  code: ThaiBankCode;
  nameTh: string;
  nameEn: string;
  alt: string;
  /** Presentation mark only. Not an official trademark asset. */
  localAsset: string;
  officialSource: string | null;
  verifiedAt: string | null;
}

const MARK = (slug: string) => `/banks/${slug}.svg`;

export const thaiBankBrands: Record<ThaiBankCode, BankBrand> = {
  KBANK: { code: 'KBANK', nameTh: 'ธนาคารกสิกรไทย', nameEn: 'Kasikornbank', alt: 'ธนาคารกสิกรไทย (Kasikornbank)', localAsset: MARK('kbank'), officialSource: null, verifiedAt: null },
  SCB: { code: 'SCB', nameTh: 'ธนาคารไทยพาณิชย์', nameEn: 'Siam Commercial Bank', alt: 'ธนาคารไทยพาณิชย์ (SCB)', localAsset: MARK('scb'), officialSource: null, verifiedAt: null },
  KTB: { code: 'KTB', nameTh: 'ธนาคารกรุงไทย', nameEn: 'Krung Thai Bank', alt: 'ธนาคารกรุงไทย (Krung Thai Bank)', localAsset: MARK('ktb'), officialSource: null, verifiedAt: null },
  BBL: { code: 'BBL', nameTh: 'ธนาคารกรุงเทพ', nameEn: 'Bangkok Bank', alt: 'ธนาคารกรุงเทพ (Bangkok Bank)', localAsset: MARK('bbl'), officialSource: null, verifiedAt: null },
  BAY: { code: 'BAY', nameTh: 'ธนาคารกรุงศรีอยุธยา', nameEn: 'Bank of Ayudhya', alt: 'ธนาคารกรุงศรีอยุธยา (Krungsri)', localAsset: MARK('bay'), officialSource: null, verifiedAt: null },
  TTB: { code: 'TTB', nameTh: 'ธนาคารทหารไทยธนชาต', nameEn: 'TMBThanachart Bank', alt: 'ธนาคารทหารไทยธนชาต (ttb)', localAsset: MARK('ttb'), officialSource: null, verifiedAt: null },
  GSB: { code: 'GSB', nameTh: 'ธนาคารออมสิน', nameEn: 'Government Savings Bank', alt: 'ธนาคารออมสิน (GSB)', localAsset: MARK('gsb'), officialSource: null, verifiedAt: null },
  BAAC: { code: 'BAAC', nameTh: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', nameEn: 'BAAC', alt: 'ธ.ก.ส. (BAAC)', localAsset: MARK('baac'), officialSource: null, verifiedAt: null },
  CIMB: { code: 'CIMB', nameTh: 'ธนาคารซีไอเอ็มบีไทย', nameEn: 'CIMB Thai', alt: 'ธนาคารซีไอเอ็มบีไทย (CIMB)', localAsset: MARK('cimb'), officialSource: null, verifiedAt: null },
  UOB: { code: 'UOB', nameTh: 'ธนาคารยูโอบี', nameEn: 'United Overseas Bank', alt: 'ธนาคารยูโอบี (UOB)', localAsset: MARK('uob'), officialSource: null, verifiedAt: null },
  LH: { code: 'LH', nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', nameEn: 'LH Bank', alt: 'ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)', localAsset: MARK('lh'), officialSource: null, verifiedAt: null },
  KKP: { code: 'KKP', nameTh: 'ธนาคารเกียรตินาคินภัทร', nameEn: 'Kiatnakin Phatra', alt: 'ธนาคารเกียรตินาคินภัทร (KKP)', localAsset: MARK('kkp'), officialSource: null, verifiedAt: null },
  UNKNOWN: { code: 'UNKNOWN', nameTh: 'ธนาคารอื่น', nameEn: 'Unknown bank', alt: 'ธนาคารอื่น (unknown bank)', localAsset: MARK('unknown'), officialSource: null, verifiedAt: null },
};

export const CATALOG_CODES: ThaiBankCode[] = [
  'KBANK', 'SCB', 'KTB', 'BBL', 'BAY', 'TTB', 'GSB', 'BAAC', 'CIMB', 'UOB', 'LH', 'KKP',
];

export function catalogCode(value: string | null | undefined): ThaiBankCode {
  const code = normalizeBankCode(value);
  if (code && code in thaiBankBrands && code !== 'UNKNOWN') return code as ThaiBankCode;
  return 'UNKNOWN';
}

export function normalizeBrandCode(value: string): ThaiBankCode | null {
  const code = catalogCode(value);
  return code === 'UNKNOWN' ? null : code;
}

export function getBankBrand(value: string | null | undefined): BankBrand {
  return thaiBankBrands[catalogCode(value)];
}
