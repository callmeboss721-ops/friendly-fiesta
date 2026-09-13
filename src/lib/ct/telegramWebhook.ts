import { getBotToken } from '../runtimeEnv';
export type WebhookState = {
  ok: boolean;
  url: string | null;
  pending: number | null;
  error: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

function appBase(): string | null {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return base.startsWith('https://') ? base : null;
}

function wantedUrl(): string | null {
  const base = appBase();
  return base ? `${base}/api/telegram/webhook` : null;
}

function telegramDescription(body: any): string | null {
  const text = [body?.description, body?.result?.last_error_message]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .find(Boolean);
  return text ? text.slice(0, 180) : null;
}

function lastErrorAt(info: any): string | null {
  const raw = Number(info?.last_error_date);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(raw * 1000).toISOString();
}

export async function readTelegramWebhook(): Promise<WebhookState> {
  const token = getBotToken();
  if (!token) return { ok: false, url: null, pending: null, error: 'NO_BOT_TOKEN', lastError: null, lastErrorAt: null };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        url: null,
        pending: null,
        error: telegramDescription(body) || 'TELEGRAM_REJECTED',
        lastError: telegramDescription(body),
        lastErrorAt: lastErrorAt(body?.result),
      };
    }
    const info = body.result ?? {};
    return {
      ok: true,
      url: info.url || null,
      pending: Number.isFinite(info.pending_update_count) ? Number(info.pending_update_count) : 0,
      error: null,
      lastError: info.last_error_message || null,
      lastErrorAt: lastErrorAt(info),
    };
  } catch {
    return { ok: false, url: null, pending: null, error: 'NETWORK', lastError: null, lastErrorAt: null };
  }
}

export async function ensureTelegramWebhook(force = false): Promise<WebhookState & { set: boolean }> {
  const token = getBotToken();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const wanted = wantedUrl();
  if (!token || !secret || !wanted) {
    return { ok: false, url: wanted, pending: null, error: 'NOT_CONFIGURED', lastError: null, lastErrorAt: null, set: false };
  }
  const current = await readTelegramWebhook();
  if (!force && current.ok && current.url === wanted) {
    return { ...current, error: null, set: false };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: wanted,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      const description = telegramDescription(body) || 'SET_FAILED';
      const after = await readTelegramWebhook().catch(() => current);
      if (after.url === wanted) {
        return { ...after, error: null, lastError: after.lastError || description, set: false };
      }
      return {
        ok: false,
        url: after.url || wanted,
        pending: after.pending ?? current.pending,
        error: description,
        lastError: after.lastError || description,
        lastErrorAt: after.lastErrorAt ?? current.lastErrorAt,
        set: false,
      };
    }
    const after = await readTelegramWebhook().catch(() => current);
    return {
      ok: true,
      url: wanted,
      pending: after.pending ?? current.pending,
      error: null,
      lastError: after.lastError,
      lastErrorAt: after.lastErrorAt,
      set: true,
    };
  } catch {
    return {
      ok: false,
      url: wanted,
      pending: current.pending,
      error: 'NETWORK',
      lastError: current.lastError,
      lastErrorAt: current.lastErrorAt,
      set: false,
    };
  }
}
