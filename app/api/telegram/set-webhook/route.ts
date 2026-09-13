// ============================================================
// POST /api/telegram/set-webhook (header x-api-key)
// เรียกครั้งเดียวหลัง deploy เพื่อบอก Telegram ให้ยิง update มาที่ webhook ของเรา
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import { getBotToken, validateProductionEnvironment } from '@/lib/runtimeEnv';
import { requireApiKey } from '@/lib/apiAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const issues = validateProductionEnvironment();
  if (issues.length > 0) {
    return NextResponse.json(
      {
        error: 'production_environment_invalid',
        configuration: issues.map((issue) => `${issue.key}:${issue.code}`),
      },
      { status: 503 },
    );
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET!;

  const token = getBotToken();
  if (!token) return NextResponse.json({ error: 'BOT_TOKEN ไม่ได้ตั้งค่า' }, { status: 500 });

  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!base.startsWith('https://')) {
    return NextResponse.json({ error: 'APP_URL ต้องเป็น HTTPS URL ที่เข้าถึงได้จาก Telegram' }, { status: 503 });
  }
  const webhookUrl = `${base}/api/telegram/webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.ok) {
    return NextResponse.json({ error: 'Telegram ปฏิเสธ webhook', telegram: result }, { status: 502 });
  }

  return NextResponse.json({ webhookUrl, telegram: result });
}

export async function GET() {
  return NextResponse.json(
    { error: 'ใช้ POST พร้อม header x-api-key เพื่อไม่ให้ secret รั่วใน URL' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
