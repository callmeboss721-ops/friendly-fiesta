import { createHash } from 'crypto';

type EnvMap = Record<string, string | undefined>;

export interface ConfigIssue {
  key: string;
  code: 'missing' | 'placeholder' | 'invalid' | 'insecure' | 'conflict';
}

const PLACEHOLDER_PATTERNS = [
  /^your[-_]/i,
  /^replace[-_]/i,
  /^change[-_]/i,
  /^example/i,
  /^placeholder/i,
  /^x{4,}/i,
  /^<.+>$/,
  /^\.\.\.$/,
];

export function envValue(env: EnvMap, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function isPlaceholderValue(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getSupabaseUrl(env: EnvMap = process.env): string | null {
  return envValue(env, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
}

export function getSupabaseAdminKey(env: EnvMap = process.env): string | null {
  return envValue(env, 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
}

function derivedSecret(env: EnvMap, purpose: string): string | null {
  const seed = envValue(env, 'BOT_TOKEN', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!seed || isPlaceholderValue(seed)) return null;
  return createHash('sha256').update(`ce-vault:${purpose}:${seed}`).digest('hex');
}

export function getApiSecret(env: EnvMap = process.env): string | null {
  const explicit = envValue(env, 'API_SECRET');
  if (explicit && !isPlaceholderValue(explicit)) return explicit;
  return derivedSecret(env, 'api-secret');
}

export function getBotToken(env: EnvMap = process.env): string | null {
  const token = envValue(env, 'BOT_TOKEN');
  if (!token || isPlaceholderValue(token)) return null;
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  return token;
}

export function getTelegramWebhookSecret(env: EnvMap = process.env): string | null {
  const explicit = envValue(env, 'TELEGRAM_WEBHOOK_SECRET');
  if (explicit && !isPlaceholderValue(explicit)) return explicit;
  return derivedSecret(env, 'telegram-webhook');
}

export function getAppUrl(env: EnvMap = process.env): string | null {
  const raw = envValue(env, 'APP_URL', 'URL', 'DEPLOY_PRIME_URL', 'RENDER_EXTERNAL_URL');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    const href = url.toString().replace(/\/$/, '');
    return href;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

export function getDefaultSellRate(env: EnvMap = process.env): string {
  const value = envValue(env, 'DEFAULT_SELL_RATE');
  if (value && Number.isFinite(Number(value)) && Number(value) > 0) return value;
  return '35.5';
}

export function getDefaultMarketRate(env: EnvMap = process.env): string {
  const value = envValue(env, 'DEFAULT_MARKET_RATE');
  if (value && Number.isFinite(Number(value)) && Number(value) > 0) return value;
  return '34.8';
}

export function getOcrAutoMin(env: EnvMap = process.env): number {
  const parsed = Number(envValue(env, 'OCR_AUTO_MIN') ?? '90');
  if (!Number.isFinite(parsed) || parsed < 90 || parsed > 100) return 90;
  return parsed;
}

export function configuredAdminIds(env: EnvMap = process.env): number[] {
  return (envValue(env, 'ADMIN_TELEGRAM_IDS') ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isSafeInteger(item) && item > 0);
}

function requireValue(
  issues: ConfigIssue[],
  env: EnvMap,
  canonicalKey: string,
  aliases: string[] = [],
): string | null {
  const value = envValue(env, canonicalKey, ...aliases);
  if (!value) {
    issues.push({ key: canonicalKey, code: 'missing' });
    return null;
  }
  if (isPlaceholderValue(value)) {
    issues.push({ key: canonicalKey, code: 'placeholder' });
    return null;
  }
  return value;
}

function isHttpsUrl(value: string, allowPath = true): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (allowPath || url.pathname === '/')
    );
  } catch {
    return false;
  }
}

export function validateWebhookEnvironment(env: EnvMap = process.env): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const supabaseUrl = requireValue(issues, env, 'NEXT_PUBLIC_SUPABASE_URL', ['SUPABASE_URL']);
  requireValue(issues, env, 'SUPABASE_SECRET_KEY', [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY',
  ]);
  const apiSecret = getApiSecret(env);
  const botToken = requireValue(issues, env, 'BOT_TOKEN');
  const webhookSecret = getTelegramWebhookSecret(env);
  requireValue(issues, env, 'ADMIN_TELEGRAM_IDS');
  if (!apiSecret) issues.push({ key: 'API_SECRET', code: 'missing' });
  if (!webhookSecret) issues.push({ key: 'TELEGRAM_WEBHOOK_SECRET', code: 'missing' });

  if (supabaseUrl && !isHttpsUrl(supabaseUrl)) {
    issues.push({ key: 'NEXT_PUBLIC_SUPABASE_URL', code: 'invalid' });
  }
  if (apiSecret && apiSecret.length < 32) {
    issues.push({ key: 'API_SECRET', code: 'insecure' });
  }
  if (botToken && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    issues.push({ key: 'BOT_TOKEN', code: 'invalid' });
  }
  if (
    webhookSecret &&
    (webhookSecret.length < 16 || webhookSecret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(webhookSecret))
  ) {
    issues.push({ key: 'TELEGRAM_WEBHOOK_SECRET', code: 'invalid' });
  }
  if (apiSecret && webhookSecret && apiSecret === webhookSecret) {
    issues.push({ key: 'TELEGRAM_WEBHOOK_SECRET', code: 'conflict' });
  }
  if (configuredAdminIds(env).length === 0) {
    issues.push({ key: 'ADMIN_TELEGRAM_IDS', code: 'invalid' });
  }

  const threshold = Number(envValue(env, 'OCR_AUTO_MIN') ?? '90');
  if (!Number.isFinite(threshold) || threshold < 90 || threshold > 100) {
    issues.push({ key: 'OCR_AUTO_MIN', code: 'invalid' });
  }

  return dedupeIssues(issues);
}

export function validateProductionEnvironment(env: EnvMap = process.env): ConfigIssue[] {
  const issues = validateWebhookEnvironment(env);
  const appUrl = getAppUrl(env);
  if (!appUrl) {
    issues.push({ key: 'APP_URL', code: 'missing' });
  } else if (!isHttpsUrl(appUrl, false)) {
    issues.push({ key: 'APP_URL', code: 'invalid' });
  }

  for (const [key, value] of [
    ['DEFAULT_SELL_RATE', getDefaultSellRate(env)],
    ['DEFAULT_MARKET_RATE', getDefaultMarketRate(env)],
  ] as const) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      issues.push({ key, code: 'invalid' });
    }
  }

  const hasOcrProvider = [
    envValue(env, 'GROK_API_KEY', 'XAI_API_KEY'),
    envValue(env, 'OCR_SPACE_API_KEY'),
  ].some((value) => value != null && !isPlaceholderValue(value));
  if (!hasOcrProvider) issues.push({ key: 'GROK_API_KEY|OCR_SPACE_API_KEY', code: 'missing' });

  return dedupeIssues(issues);
}

function dedupeIssues(issues: ConfigIssue[]): ConfigIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const id = `${issue.key}:${issue.code}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
