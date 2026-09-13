// ============================================================
// Monetary calculations use decimal.js and ROUND_HALF_UP so binary floating
// point never determines a persisted settlement amount.
// ============================================================
import { money, roundMoney, roundRate } from './money';

export interface ProfitResult {
  costPerUnit: number;
  sellValueThb: number;
  netProfitThb: number;
  profitPercent: number;
}

export function calculateProfit(thbAmount: number, usdtAmount: number, sellRate: number): ProfitResult {
  const thb = money(thbAmount);
  const usdt = money(usdtAmount);
  const rate = money(sellRate);
  const costPerUnit = usdt.isPositive() ? roundRate(thb.div(usdt)) : 0;
  const sellValueThb = roundMoney(usdt.mul(rate));
  const netProfitThb = roundMoney(money(sellValueThb).sub(thb));
  const profitPercent = thb.isPositive() ? roundRate(money(netProfitThb).div(thb).mul(100)) : 0;
  return { costPerUnit, sellValueThb, netProfitThb, profitPercent };
}

export function calculateDepositProfit(thbAmount: number, usdtAmount: number, marketRate: number): ProfitResult {
  const thb = money(thbAmount);
  const cost = money(usdtAmount).mul(money(marketRate));
  const netProfitThb = roundMoney(thb.sub(cost));
  return {
    costPerUnit: roundRate(marketRate),
    sellValueThb: roundMoney(thb),
    netProfitThb,
    profitPercent: thb.isPositive() ? roundRate(money(netProfitThb).div(thb).mul(100)) : 0,
  };
}
