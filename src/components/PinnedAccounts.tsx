'use client';

import BankLogo from './BankLogo';
import SyncBadge, { type SyncStatus } from './SyncBadge';
import { bankIdentity } from '@/lib/ct/bankIdentity';

export interface PinnedAccount {
  id: string;
  bankAccountId: string;
  accountName: string;
  bankName: string;
  last4: string;
  accountNumber?: string | null;
  pinnedForDate: string;
  transactionCount: number;
  totalThb: number;
  totalUsdt: number;
  dailyLimitThb?: number | null;
  status: 'active' | 'depleted' | 'inactive';
}

export interface PinChoice {
  id: string;
  bankName: string;
  last4: string;
  label?: string | null;
  accountNumber?: string | null;
}

interface PinnedAccountsProps {
  accounts: PinnedAccount[];
  catalog?: PinChoice[];
  selectedAccountId?: string;
  onSelectAccount?: (id: string) => void;
  onPin?: (accountId: string) => Promise<void> | void;
  pinning?: boolean;
  isLoading?: boolean;
  lastSync?: Date | null;
  syncStatus?: SyncStatus;
}

function acct(accountNumber?: string | null, last4?: string) {
  const full = String(accountNumber || '').trim();
  if (full) return full;
  return last4 || '—';
}

export default function PinnedAccounts({
  accounts,
  catalog = [],
  selectedAccountId,
  onSelectAccount,
  onPin,
  pinning,
  isLoading,
  lastSync,
  syncStatus,
}: PinnedAccountsProps) {
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const pinnedIds = new Set(accounts.map((a) => a.bankAccountId));
  const pinnedKeys = new Set(accounts.map((a) => `${a.bankName}-${a.last4}`));
  const choices = catalog.filter(
    (c) => /^\d{4}$/.test(c.last4) && !pinnedIds.has(c.id) && !pinnedKeys.has(`${c.bankName}-${c.last4}`),
  );

  if (accounts.length === 0) {
    return (
      <div className="glass accent-top reveal p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[color:var(--fg)]">ยังไม่มีบัญชีรับเงินวันนี้ — กดปักก่อนรับสลิป</p>
          <SyncBadge lastSync={lastSync} status={syncStatus} />
        </div>
        {choices.length > 0 && onPin ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {choices.map((c) => {
              const idn = bankIdentity(c.bankName);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={pinning || isLoading}
                  onClick={() => void onPin(c.id)}
                  className="keep inline-flex items-center gap-2 px-3 py-2 text-xs"
                  aria-label={`ใช้วันนี้ ${idn.alt} ${acct(c.accountNumber, c.last4)}`}
                >
                  <BankLogo bankName={c.bankName} size={20} />
                  ใช้วันนี้ {idn.code} {acct(c.accountNumber, c.last4)}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[color:var(--fg-muted)]">ปักบัญชีรับแล้วสลิปจึงเข้าคิวได้</p>
        )}
      </div>
    );
  }

  return (
    <div className="glass accent-top reveal overflow-hidden">
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-3">
        <h2 className="text-sm font-semibold tracking-[0.04em]">บัญชีรับเงินวันนี้</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[color:var(--fg-muted)]">{accounts.length} บัญชี</span>
          <SyncBadge lastSync={lastSync} status={syncStatus} />
        </div>
      </div>

      <div className="divide-y divide-[color:var(--border)]">
        {accounts.map((acc) => {
          const on = selectedAccountId === acc.bankAccountId;
          const cap = acc.dailyLimitThb;
          const left = cap != null ? Math.max(0, cap - acc.totalThb) : null;
          const idn = bankIdentity(acc.bankName);
          const number = acct(acc.accountNumber, acc.last4);
          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => onSelectAccount?.(acc.bankAccountId)}
              disabled={isLoading}
              className={`w-full px-5 py-3 text-left disabled:opacity-50 ${on ? 'bg-[color:var(--bg-subtle)]' : 'hover:bg-[color:var(--bg-subtle)]'}`}
              aria-label={`${idn.alt} ${acc.accountName} ${number}`}
              aria-pressed={on}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <BankLogo bankName={acc.bankName} size={28} eager />
                  <p className="min-w-0 truncate text-sm font-semibold">{acc.accountName}</p>
                </span>
                <span className={`pill ${acc.status === 'active' ? 'pill-wait' : 'pill-done'}`}>ปักอยู่</span>
              </div>
              <p className="mt-1 text-xs text-[color:var(--fg)]">
                {idn.nameTh}{' '}
                <span className="font-mono text-gold">{number}</span>
              </p>
              <p className="mt-1 font-mono text-xs font-medium text-[color:var(--fg)]">
                รับแล้ว {nf.format(acc.totalThb)} บาท · {acc.transactionCount} รายการ
                {cap != null ? ` · วงเงิน ${nf.format(cap)} · ใช้ไป ${nf.format(acc.totalThb)} · เหลือ ${nf.format(left ?? 0)}` : ''}
              </p>
            </button>
          );
        })}
      </div>
      {choices.length > 0 && onPin ? (
        <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] px-5 py-3">
          {choices.map((c) => {
            const idn = bankIdentity(c.bankName);
            return (
              <button
                key={c.id}
                type="button"
                disabled={pinning || isLoading}
                onClick={() => void onPin(c.id)}
                className="keep inline-flex items-center gap-2 px-3 py-2 text-xs"
                aria-label={`ใช้วันนี้ ${idn.alt} ${acct(c.accountNumber, c.last4)}`}
              >
                <BankLogo bankName={c.bankName} size={20} />
                ใช้วันนี้ {idn.code} {acct(c.accountNumber, c.last4)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
