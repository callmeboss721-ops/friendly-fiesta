import { NextRequest, NextResponse } from 'next/server';
import { loadVault } from '@/lib/ct/vault';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { opsRates } from '@/lib/ct/rates';
import { requireDashboardSession } from '@/lib/dashboardAuth';
import { ensureTodayPins, accountLast4Candidates } from '@/lib/banks';
import { opsChatId } from '@/lib/ct/deskChat';
import { quarantineOcrJunk } from '@/lib/ct/store';
import { logServerError, requestId, safeErrorCode } from '@/lib/safeServerError';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = requestId();
  const denied = await requireDashboardSession(req);
  if (denied) return denied;
  const chatParam = req.nextUrl.searchParams.get('chatId');
  const chatId = chatParam ? Number(chatParam) : await opsChatId(null);
  const mode = (req.nextUrl.searchParams.get('mode') as 'today' | 'pending' | 'all') || 'today';

  try {
    if (chatId != null && Number.isFinite(chatId)) {
      await ensureTodayPins(chatId).catch(() => []);
      await quarantineOcrJunk(chatId).catch(() => []);
    }
    const pendingQ = supabaseAdmin
        .from('pending_slips')
        .select('short_ref, ledger_ref, status, thb_in, should_send, bank, name, note, created_at')
        .in('status', ['IN_READY', 'IN_READY_REVIEW', 'LOCKED', 'OCR_WEAK', 'PIN_MISMATCH', 'HOLD'])
        .order('created_at', { ascending: false })
        .limit(20);
    const pinQ = supabaseAdmin
        .from('pinned_bank_accounts')
        .select('chat_id, pinned_for_date, bank_account_id, bank_accounts(id, bank_name, account_number, label)')
        .eq('pinned_for_date', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
    const [vault, pins, pending, rates] = await Promise.all([
      loadVault(Number.isFinite(chatId) ? chatId : null, mode),
      chatId != null && Number.isFinite(chatId) ? pinQ.eq('chat_id', chatId) : pinQ,
      chatId != null && Number.isFinite(chatId) ? pendingQ.eq('chat_id', chatId) : pendingQ,
      opsRates(0),
    ]);

    const pinsOut = (pins.data ?? []).map((p: any) => {
      const acct = String(p.bank_accounts?.account_number ?? '');
      const last4s = accountLast4Candidates(acct);
      return {
        id: p.bank_accounts?.id ?? p.bank_account_id,
        chatId: p.chat_id,
        date: p.pinned_for_date,
        bank: p.bank_accounts?.bank_name ?? '—',
        last4: last4s[0] ?? '',
        last4s,
        account: acct || null,
        label: p.bank_accounts?.label ?? null,
      };
    });

    const accounts = pinsOut.map((p) => {
      const rows = (vault.tape ?? []).filter((t: any) => {
        const slip4 = String(t.last4 ?? '');
        if (!slip4 || !p.last4s.includes(slip4)) return false;
        if (t.bank && p.bank && t.bank !== p.bank) return false;
        return true;
      });
      return {
        ...p,
        count: rows.length,
        totalThb: rows.reduce((s: number, r: any) => s + Number(r.thb || 0), 0),
        totalUsdt: rows.reduce((s: number, r: any) => s + Number(r.usdt || 0), 0),
      };
    });

    return NextResponse.json({
      ok: true,
      chatId,
      vault,
      rates,
      pins: pinsOut,
      accounts,
      queue: pending.data ?? [],
    });
  } catch (error) {
    logServerError({ requestId: id, route: '/api/dashboard/vault', operation: 'load_vault', error });
    return NextResponse.json({ ok: false, error: safeErrorCode(error), requestId: id }, { status: 500 });
  }
}
