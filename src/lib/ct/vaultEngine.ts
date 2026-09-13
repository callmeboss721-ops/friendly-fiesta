import { divideMoney, money, roundMoney, roundRate } from '../money';
import { gateOcr, type OcrGate } from './gate';
import { settlementState, type SettlementState } from './settlementMath';
import { vaultKpi, type VaultKpi, type VaultKpiRow } from './vaultKpi';

export type ReceiveVerification = {
  state: 'OCR' | 'REVIEW' | 'MISMATCH' | 'READY';
  expectedUsdt: number;
  gate: OcrGate;
};

/** Shared, pure business rules for Dashboard and Telegram operator surfaces. */
export const VaultEngine = {
  verifyReceive(input: { thb: number | null; rate: number | null; confidence: number | null; pinMatch: boolean; hasCurrency?: boolean; qrVerified?: boolean }): ReceiveVerification {
    const gate = gateOcr({ thb: input.thb, confidence: input.confidence, pinMatch: input.pinMatch, hasCurrency: input.hasCurrency, qrVerified: input.qrVerified });
    const expectedUsdt = input.thb != null && input.rate != null ? divideMoney(input.thb, input.rate) : 0;
    const state = gate === 'IN_READY' ? 'READY' : gate === 'IN_READY_REVIEW' ? 'REVIEW' : gate === 'PIN_MISMATCH' ? 'MISMATCH' : 'OCR';
    return { state, expectedUsdt, gate };
  },
  settlement(input: { depositThb: number; rate: number; sentUsdt?: number | null; settled?: boolean }): { expectedUsdt: number; deltaUsdt: number | null; state: SettlementState } {
    const expectedUsdt = divideMoney(input.depositThb, input.rate);
    const sent = input.sentUsdt == null ? null : roundMoney(input.sentUsdt);
    const deltaUsdt = sent == null ? null : roundMoney(money(sent).minus(expectedUsdt));
    return { expectedUsdt, deltaUsdt, state: settlementState({ depositThb: input.depositThb, depositCount: input.depositThb > 0 ? 1 : 0, roomRate: input.rate, sentUsdt: sent, settled: input.settled }) };
  },
  kpi(rows: VaultKpiRow[], limit: number | null = null): VaultKpi {
    return vaultKpi(rows, limit);
  },
  rate(value: number): number {
    return roundRate(value);
  },
};
