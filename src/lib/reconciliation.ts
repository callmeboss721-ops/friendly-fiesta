export const RECONCILIATION_STATES = [
  'RECEIVED',
  'OCR_VERIFIED',
  'MATCHED',
  'READY',
  'SENT',
  'SETTLED',
  'DUPLICATE',
  'MISMATCH',
  'MISSING_BANK_CREDIT',
] as const;

export type ReconciliationStatus = (typeof RECONCILIATION_STATES)[number];
export type ReconciliationExceptionType = 'AMOUNT_MISMATCH' | 'TIMING_GAP' | 'DUPLICATE' | 'UNKNOWN_TRANSACTION' | 'MISSING_BANK_CREDIT';
export type ExceptionSeverity = 'AUTO_RESOLVE' | 'REVIEW_REQUIRED' | 'ESCALATE';

export interface Money {
  minorUnits: number;
  currency: string;
}

export interface ReconciliationAuditEvent {
  entityId: string;
  from: ReconciliationStatus;
  to: ReconciliationStatus;
  actorId: string;
  occurredAt: string;
  reason?: string;
}

const transitions: Record<ReconciliationStatus, readonly ReconciliationStatus[]> = {
  RECEIVED: ['OCR_VERIFIED', 'DUPLICATE', 'MISMATCH'],
  OCR_VERIFIED: ['MATCHED', 'DUPLICATE', 'MISMATCH'],
  MATCHED: ['READY', 'MISMATCH'],
  READY: ['SENT', 'MISMATCH'],
  SENT: ['SETTLED', 'MISSING_BANK_CREDIT'],
  SETTLED: [],
  DUPLICATE: [],
  MISMATCH: [],
  MISSING_BANK_CREDIT: [],
};

export function assertMoney(value: Money): Money {
  if (!Number.isSafeInteger(value.minorUnits) || value.minorUnits < 0) throw new Error('Money minorUnits must be a non-negative safe integer');
  const currency = value.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Money currency must be an ISO 4217 code');
  return { minorUnits: value.minorUnits, currency };
}

export function canTransition(from: ReconciliationStatus, to: ReconciliationStatus) {
  return transitions[from].includes(to);
}

export function transitionReconciliation(input: {
  entityId: string;
  from: ReconciliationStatus;
  to: ReconciliationStatus;
  actorId: string;
  occurredAt?: Date;
  reason?: string;
}): ReconciliationAuditEvent {
  if (!canTransition(input.from, input.to)) throw new Error(`Invalid reconciliation transition: ${input.from} -> ${input.to}`);
  if (!input.entityId.trim() || !input.actorId.trim()) throw new Error('Transition requires entityId and actorId');
  return {
    entityId: input.entityId,
    from: input.from,
    to: input.to,
    actorId: input.actorId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
  };
}
