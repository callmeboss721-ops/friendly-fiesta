import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { validateProductionEnvironment, validateWebhookEnvironment } from '@/lib/runtimeEnv';
import { configuredSlipProvider } from '@/lib/ct/slipInquiry';
import { ensureTelegramWebhook } from '@/lib/ct/telegramWebhook';
import { opsChatId } from '@/lib/ct/deskChat';
import { resolveTyphoonKey } from '@/lib/typhoon';

export const runtime = 'nodejs';
export const revalidate = 0;

function staleWebhookError(webhook: {
  pending?: number | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
}) {
  if (!webhook.lastError) return null;
  if ((webhook.pending ?? 0) > 0) return webhook.lastError;
  const at = webhook.lastErrorAt ? Date.parse(webhook.lastErrorAt) : NaN;
  if (!Number.isFinite(at)) return webhook.lastError;
  if (Date.now() - at > 15 * 60 * 1000) return null;
  return webhook.lastError;
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const fatal = validateWebhookEnvironment();
  const extra = validateProductionEnvironment().filter(
    (issue) => !fatal.some((f) => f.key === issue.key && f.code === issue.code),
  );
  const forceWebhook = req.nextUrl.searchParams.get('forceWebhook') === '1';

  let db: 'ok' | 'error' = 'ok';
  let detail: 'DATABASE_QUERY_FAILED' | undefined;
  try {
    const { error } = await supabaseAdmin.from('admins').select('id').limit(1);
    if (error) {
      db = 'error';
      detail = 'DATABASE_QUERY_FAILED';
    }
  } catch (e: any) {
    db = 'error';
    detail = 'DATABASE_QUERY_FAILED';
  }

  const webhook = fatal.length === 0
    ? await ensureTelegramWebhook(forceWebhook).catch(() => ({
        ok: false,
        url: null,
        pending: null,
        error: 'ENSURE_FAILED',
        lastError: null,
        lastErrorAt: null,
        set: false,
      }))
    : { ok: false, url: null, pending: null, error: 'ENV', lastError: null, lastErrorAt: null, set: false };
  const chatId = await opsChatId(null).catch(() => null);

  const latency = Date.now() - startedAt;
  const isUp = fatal.length === 0 && db === 'ok' && latency < 5000;
  const vision = Boolean(
    process.env.GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim(),
  );
  const typhoon = Boolean(await resolveTyphoonKey());
  const ocrFallback = Boolean(process.env.OCR_SPACE_API_KEY?.trim());
  const slipVerify = configuredSlipProvider()?.name ?? false;
  const liveError = staleWebhookError(webhook);

  return NextResponse.json(
    {
      status: !isUp ? 'down' : extra.length ? 'degraded' : 'ok',
      service: 'ce-vault-bot-api',
      db,
      detail,
      vision,
      typhoon,
      ocrFallback,
      slipVerify,
      pinGate: Boolean(process.env.DASHBOARD_PIN),
      opsChat: Boolean(process.env.OPS_CHAT_ID || process.env.NOTIFY_CHAT_ID || chatId),
      chatId,
      webhook: {
        ok: webhook.ok,
        url: webhook.url,
        pending: webhook.pending,
        set: webhook.set,
        error: webhook.error,
        lastError: liveError,
        lastErrorAt: webhook.lastErrorAt ?? null,
        lastErrorArchived: webhook.lastError && !liveError ? webhook.lastError : null,
      },
      app: (process.env.APP_URL || '').replace(/\/$/, '') || null,
      configuration: [...fatal, ...extra].map((issue) => `${issue.key}:${issue.code}`),
      latencyMs: latency,
      version: '2.1-optimized',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
    { status: isUp ? 200 : 503 },
  );
}
