import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value;

export function money(value: MoneyInput): Decimal {
  return new Decimal(value);
}

export function roundMoney(value: MoneyInput): number {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function roundRate(value: MoneyInput): number {
  return money(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

export function divideMoney(amount: MoneyInput, rate: MoneyInput): number {
  const divisor = money(rate);
  return divisor.isPositive()
    ? money(amount).div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : 0;
}
