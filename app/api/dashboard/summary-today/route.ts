import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const accountId = searchParams.get('accountId');
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  if (!accountId) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INVALID_QUERY', message: 'accountId required' },
      },
      { status: 400 }
    );
  }

  try {
    // Get account info
    const { data: account, error: accError } = await supabaseAdmin
      .from('bank_accounts')
      .select('id, label, bank_name, account_number')
      .eq('id', accountId)
      .maybeSingle();

    if (accError || !account) {
      return NextResponse.json(
        {
          data: null,
          error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' },
        },
        { status: 404 }
      );
    }

    // Get daily aggregates
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const { data: transactions, error: txError } = await supabaseAdmin
      .from('transactions')
      .select('thb_amount, usdt_amount, type, created_at')
      .eq('bank_account_id', accountId)
      .eq('type', 'THB_DEPOSIT')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString());

    if (txError) throw txError;

    const daily = {
      transactionCount: transactions?.length ?? 0,
      totalThbReceived: (transactions ?? []).reduce((s, t) => s + Number(t.thb_amount || 0), 0),
      totalUsdtSent: (transactions ?? []).reduce((s, t) => s + Number(t.usdt_amount || 0), 0),
    };

    // Get latest rates
    const { data: rateRow } = await supabaseAdmin
      .from('rates')
      .select('sell_rate, market_usdt_rate')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      data: {
        account: {
          id: account.id,
          name: account.label,
          bankName: account.bank_name,
          last4: String(account.account_number ?? '').replace(/\D/g, '').slice(-4) || '----',
        },
        daily,
        rates: {
          sellRate: Number(rateRow?.sell_rate ?? 0),
          marketRate: Number(rateRow?.market_usdt_rate ?? 0),
        },
      },
      error: null,
    });
  } catch (err) {
    console.error('summary-today error:', err);
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Server error' },
      },
      { status: 500 }
    );
  }
}
