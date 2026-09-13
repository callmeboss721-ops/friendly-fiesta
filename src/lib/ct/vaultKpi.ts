import { money, roundMoney } from '../money';

export type VaultKpiRow = {
  ledger: string | null;
  short: string;
  thb: number | null;
  expectedUsdt: number | null;
  sentUsdt: number | null;
  status: string;
  pending: boolean;
  profitThb?: number | null;
};

export type VaultKpi = {
  limit: number | null;
  used: number;
  remaining: number | null;
  received: number;
  sent: number;
  pending: number;
  negative: number;
  profit: number;
  counts: { received: number; pending: number; settled: number; negative: number };
};

const EXCLUDED = new Set(['ERR', 'ERROR', 'SCAN', 'HOLD', 'REJECTED', 'DUPLICATE']);
const SETTLED = new Set(['DONE', 'SETTLED']);

export function vaultKpi(rows: VaultKpiRow[], dailyLimit: number | null = null): VaultKpi {
  const seen = new Set<string>();
  let received = money(0);
  let sent = money(0);
  let pending = money(0);
  let negative = money(0);
  let profit = money(0);
  let receivedCount = 0;
  let pendingCount = 0;
  let settledCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const key = row.ledger || row.short;
    if (seen.has(key) || EXCLUDED.has(row.status)) continue;
    seen.add(key);
    const thb = money(row.thb ?? 0);
    const expected = money(row.expectedUsdt ?? 0);
    const sentUsdt = money(row.sentUsdt ?? 0);
    received = received.plus(thb);
    sent = sent.plus(sentUsdt);
    profit = profit.plus(row.profitThb ?? 0);
    receivedCount += 1;
    if (SETTLED.has(row.status)) settledCount += 1;
    if (row.pending) {
      pending = pending.plus(expected.minus(sentUsdt).isPositive() ? expected.minus(sentUsdt) : money(0));
      pendingCount += 1;
    }
    const delta = sentUsdt.minus(expected);
    if (delta.isNegative()) {
      negative = negative.plus(delta.abs());
      negativeCount += 1;
    }
  }

  const used = roundMoney(received);
  const limit = dailyLimit == null ? null : roundMoney(dailyLimit);
  return {
    limit,
    used,
    remaining: limit == null ? null : roundMoney(money(limit).minus(used).isPositive() ? money(limit).minus(used) : money(0)),
    received: used,
    sent: roundMoney(sent),
    pending: roundMoney(pending),
    negative: roundMoney(negative),
    profit: roundMoney(profit),
    counts: { received: receivedCount, pending: pendingCount, settled: settledCount, negative: negativeCount },
  };
}
