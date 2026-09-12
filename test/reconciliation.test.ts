const { assertMoney, canTransition, transitionReconciliation } = require('../src/lib/reconciliation');

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

assert(canTransition('RECEIVED', 'OCR_VERIFIED'), 'received advances to OCR verified');
assert(canTransition('OCR_VERIFIED', 'DUPLICATE'), 'OCR can flag duplicate');
assert(canTransition('READY', 'SENT'), 'ready advances to sent');
assert(!canTransition('SETTLED', 'READY'), 'settled is terminal');
assert(!canTransition('DUPLICATE', 'MATCHED'), 'duplicate is terminal');
assert(assertMoney({ minorUnits: 125050, currency: 'thb' }).currency === 'THB', 'money normalizes ISO currency');
assert(assertMoney({ minorUnits: 0, currency: 'USDT' }).minorUnits === 0, 'zero minor units are valid');
assertThrows(() => assertMoney({ minorUnits: 1.5, currency: 'THB' }), 'fractional minor units rejected');
assertThrows(() => transitionReconciliation({ entityId: 'd1', from: 'RECEIVED', to: 'SENT', actorId: 'system' }), 'invalid transition rejected');
const event = transitionReconciliation({ entityId: 'd1', from: 'MATCHED', to: 'READY', actorId: 'reviewer', occurredAt: new Date('2026-09-12T00:00:00.000Z') });
assert(event.occurredAt === '2026-09-12T00:00:00.000Z', 'audit event is deterministic');

function assertThrows(action: () => unknown, message: string) {
  try { action(); } catch { console.log(`PASS: ${message}`); return; }
  throw new Error(`FAIL: ${message}`);
}
