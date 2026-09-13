import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sql = await readFile(resolve(import.meta.dirname, '../db/migrations/20260912_canonical_reconciliation.sql'), 'utf8');
for (const table of ['cycles','deposits','slips','ocr_results','matches','settlements','exceptions','audit_logs']) {
  if (!sql.includes(`reconciliation_${table}`)) throw new Error(`Missing canonical table: ${table}`);
}
if (/\b(drop|truncate)\s+(table\s+)?/i.test(sql)) throw new Error('P0 migration must be additive');
if (!sql.includes('amount_minor bigint')) throw new Error('Money must use integer minor units');
if (!sql.includes('enable row level security')) throw new Error('RLS must be enabled');
console.log('Canonical migration is additive and structurally valid.');
