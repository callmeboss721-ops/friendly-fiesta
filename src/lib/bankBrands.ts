export type ThaiBankCode = 'KBANK' | 'SCB' | 'KTB' | 'BBL' | 'BAY' | 'TTB' | 'GSB';

export interface BankBrand {
  code: ThaiBankCode;
  nameTh: string;
  nameEn: string;
  alt: string;
  localAsset: string | null;
  officialSource: string | null;
  verifiedAt: string | null;
}

export const thaiBankBrands: Record<ThaiBankCode, BankBrand> = {
  KBANK: { code: 'KBANK', nameTh: 'ธนาคารกสิกรไทย', nameEn: 'Kasikornbank', alt: 'ธนาคารกสิกรไทย (Kasikornbank)', localAsset: null, officialSource: null, verifiedAt: null },
  SCB: { code: 'SCB', nameTh: 'ธนาคารไทยพาณิชย์', nameEn: 'Siam Commercial Bank', alt: 'ธนาคารไทยพาณิชย์ (SCB)', localAsset: null, officialSource: null, verifiedAt: null },
  KTB: { code: 'KTB', nameTh: 'ธนาคารกรุงไทย', nameEn: 'Krung Thai Bank', alt: 'ธนาคารกรุงไทย (Krung Thai Bank)', localAsset: null, officialSource: null, verifiedAt: null },
  BBL: { code: 'BBL', nameTh: 'ธนาคารกรุงเทพ', nameEn: 'Bangkok Bank', alt: 'ธนาคารกรุงเทพ (Bangkok Bank)', localAsset: null, officialSource: null, verifiedAt: null },
  BAY: { code: 'BAY', nameTh: 'ธนาคารกรุงศรีอยุธยา', nameEn: 'Bank of Ayudhya', alt: 'ธนาคารกรุงศรีอยุธยา (Krungsri)', localAsset: null, officialSource: null, verifiedAt: null },
  TTB: { code: 'TTB', nameTh: 'ธนาคารทหารไทยธนชาต', nameEn: 'TMBThanachart Bank', alt: 'ธนาคารทหารไทยธนชาต (ttb)', localAsset: null, officialSource: null, verifiedAt: null },
  GSB: { code: 'GSB', nameTh: 'ธนาคารออมสิน', nameEn: 'Government Savings Bank', alt: 'ธนาคารออมสิน (GSB)', localAsset: null, officialSource: null, verifiedAt: null },
};

export function normalizeBrandCode(value: string): ThaiBankCode | null {
  const code = value.toUpperCase().replace(/[^A-Z]/g, '');
  return code in thaiBankBrands ? code as ThaiBankCode : null;
}

export function getBankBrand(value: string): BankBrand | null {
  const code = normalizeBrandCode(value);
  return code ? thaiBankBrands[code] : null;
}
