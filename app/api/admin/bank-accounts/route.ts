// GET /api/admin/bank-accounts — รายชื่อบัญชีธนาคารทั้งหมด (ใช้เป็นตัวเลือกตอน pin)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { logServerError, requestId, safeErrorCode } from '@/lib/safeServerError';

export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  const id = requestId();
  try {
    const { data, error } = await supabaseAdmin.from('bank_accounts').select('id, label, bank_name, account_number, current_balance').order('label', { ascending: true });
    if (error) throw error;

    return NextResponse.json({
    data: (data ?? [])?.map((b) => ({
      id: b?.id,
      label: b?.label,
      bankName: b?.bank_name,
      last4: (b?.account_number ?? '')?.slice(-4) || '----',
      currentBalance: Number(b?.current_balance),
    })),
    error: null,
    });
  } catch (error) {
    logServerError({ requestId: id, route: '/api/admin/bank-accounts', operation: 'list_bank_accounts', error });
    return NextResponse.json({ data: null, error: { code: safeErrorCode(error), requestId: id } }, { status: 500 });
  }
}
