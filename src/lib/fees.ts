// ============================================================
// Fee calculations use decimal.js and ROUND_HALF_UP for persisted values.
// ============================================================
import { divideMoney, money, roundRate } from './money';

export interface FeeResult {
  expectedUsdt: number;
  feeUsdt: number;
  feePercent: number;
}

export function calculateFee(thbAmount: number, marketUsdtRate: number, actualUsdt: number): FeeResult {
  const expectedUsdt = divideMoney(thbAmount, marketUsdtRate);
  const feeUsdt = money(expectedUsdt).sub(money(actualUsdt)).toDecimalPlaces(2).toNumber();
  const feePercent = money(expectedUsdt).isPositive()
    ? roundRate(money(feeUsdt).div(expectedUsdt).mul(100))
    : 0;
  return { expectedUsdt, feeUsdt, feePercent };
}
