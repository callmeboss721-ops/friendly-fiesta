import { supabaseAdmin } from '../supabaseAdmin';
import { roundMoney } from '../money';
import type { VaultKpi } from './vaultKpi';

export type VaultCycle = {
  id: string;
  chatId: number;
  status: 'OPEN' | 'CLOSED';
  dailyLimitThb: number | null;
  openedAt: string;
  closedAt: string | null;
};

type CycleRow = {
  id: string;
  chat_id: number;
  status: 'OPEN' | 'CLOSED';
  daily_limit_thb: number | string | null;
  opened_at: string;
  closed_at: string | null;
};

function mapCycle(row: CycleRow): VaultCycle {
  return {
    id: row.id,
    chatId: row.chat_id,
    status: row.status,
    dailyLimitThb: row.daily_limit_thb == null ? null : roundMoney(row.daily_limit_thb),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

export function cycleCloseBlock(kpi: VaultKpi, mismatches: number): string | null {
  if (kpi.counts.pending > 0) return 'CYCLE_HAS_PENDING';
  if (kpi.negative > 0) return 'CYCLE_HAS_NEGATIVE';
  if (mismatches > 0) return 'CYCLE_HAS_MISMATCH';
  return null;
}

export async function getOpenCycle(chatId: number): Promise<VaultCycle | null> {
  const { data, error } = await supabaseAdmin
    .from('vault_cycles')
    .select('id, chat_id, status, daily_limit_thb, opened_at, closed_at')
    .eq('chat_id', chatId)
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('CYCLE_READ_FAILED');
  return data ? mapCycle(data as CycleRow) : null;
}

export async function setCycleLimit(cycleId: string, limit: number, actor: string): Promise<void> {
  const safeLimit = roundMoney(limit);
  if (!(safeLimit > 0)) throw new Error('INVALID_DAILY_LIMIT');
  const { error } = await supabaseAdmin
    .from('vault_cycles')
    .update({ daily_limit_thb: safeLimit, updated_at: new Date().toISOString() })
    .eq('id', cycleId)
    .eq('status', 'OPEN');
  if (error) throw new Error('CYCLE_LIMIT_WRITE_FAILED');
  await writeVaultAudit({ cycleId, action: 'LIMIT_CHANGE', actor, metadata: { limit: safeLimit } });
}

export async function writeVaultAudit(input: { cycleId?: string | null; transactionId?: string | null; action: string; actor: string; reason?: string; metadata?: Record<string, unknown> }): Promise<void> {
  const metadata = { ...(input.metadata ?? {}), ...(input.reason ? { reason: input.reason } : {}) };
  const { error } = await supabaseAdmin.from('vault_audit_logs').insert({
    cycle_id: input.cycleId ?? null,
    transaction_id: input.transactionId ?? null,
    action: input.action,
    actor: input.actor,
    metadata,
  });
  if (error) throw new Error('AUDIT_WRITE_FAILED');
}
