// GET /api/admin/bank-accounts — รายชื่อบัญชีธนาคารทั้งหมด (ใช้เป็นตัวเลือกตอน pin)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getSupabaseAdminKey, getSupabaseUrl } from '@/lib/runtimeEnv';

export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  if (!getSupabaseUrl() || !getSupabaseAdminKey()) {
    return NextResponse.json(
      { data: [], error: { code: 'NOT_CONFIGURED', message: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' } },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin.from('bank_accounts').select('id, label, bank_name, account_number, current_balance').order('label', { ascending: true });

  if (error) {
    return NextResponse?.json(
      { data: null, error: { code: 'DB_ERROR', message: error?.message } },
      { status: 500 }
    );
  }

  return NextResponse?.json({
    data: (data ?? [])?.map((b) => ({
      id: b?.id,
      label: b?.label,
      bankName: b?.bank_name,
      last4: (b?.account_number ?? '')?.slice(-4) || '----',
      currentBalance: Number(b?.current_balance),
    })),
    error: null,
  });
}
