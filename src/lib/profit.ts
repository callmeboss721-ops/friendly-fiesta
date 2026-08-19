// ============================================================
// คำนวณกำไรจากการขาย USDT
// ทุนต่อหน่วย     = THB / USDT
// มูลค่าขายต่อ THB = USDT * sellRate
// กำไรสุทธิ THB    = มูลค่าขายต่อ - THB
// % กำไร          = (กำไรสุทธิ / THB) * 100
// ============================================================

export interface ProfitResult {
  costPerUnit: number;    // ทุนต่อหน่วย (บาท/USDT)
  sellValueThb: number;   // มูลค่าเมื่อขายออก (บาท)
  netProfitThb: number;   // กำไรสุทธิ (บาท)
  profitPercent: number;  // % กำไร
}

/** กันค่า NaN/Infinity ไม่ให้เข้าสู่ ledger — คืน 0 เมื่อคำนวณไม่ได้ */
export function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** ปัดเป็นทศนิยม 2 ตำแหน่งแบบ deterministic (กัน floating-point drift ใน ledger) */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateProfit(
  thbAmount: number,
  usdtAmount: number,
  sellRate: number,
): ProfitResult {
  const thb = safeNumber(thbAmount);
  const usdt = safeNumber(usdtAmount);
  const rate = safeNumber(sellRate);
  const costPerUnit = usdt > 0 ? thb / usdt : 0;
  const sellValueThb = usdt * rate;
  const netProfitThb = sellValueThb - thb;
  const profitPercent = thb > 0 ? (netProfitThb / thb) * 100 : 0;

  return {
    costPerUnit: safeNumber(costPerUnit),
    sellValueThb: safeNumber(sellValueThb),
    netProfitThb: safeNumber(netProfitThb),
    profitPercent: safeNumber(profitPercent),
  };
}

/**
 * โมเดล "ฝาก THB → ส่ง USDT ให้จีน" (ตามธุรกิจจริง)
 * - รับ THB จากลูกค้า, ให้ USDT ที่เรตห้อง (roomRate) → usdtToSend = thb / roomRate
 * - ต้นทุนซื้อ USDT = usdtToSend × เรตตลาด (Binance)
 * - กำไร = THB ที่รับ − ต้นทุน
 */
export function calculateDepositProfit(
  thbAmount: number,
  usdtAmount: number,
  marketRate: number,
): ProfitResult {
  const thb = safeNumber(thbAmount);
  const usdt = safeNumber(usdtAmount);
  const rate = safeNumber(marketRate);
  const costThb = usdt * rate; // ต้นทุนซื้อ USDT ที่จะส่ง
  const netProfitThb = thb - costThb;
  const profitPercent = thb > 0 ? (netProfitThb / thb) * 100 : 0;
  return {
    costPerUnit: rate,
    sellValueThb: thb,
    netProfitThb: safeNumber(netProfitThb),
    profitPercent: safeNumber(profitPercent),
  };
}
