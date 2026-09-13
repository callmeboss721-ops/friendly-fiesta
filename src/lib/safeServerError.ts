type UnknownError = { code?: unknown; message?: unknown; name?: unknown };

const SECRET_PATTERN = /(sb_secret|service_role|bearer\s+|api[_-]?key|token|password|postgres(?:ql)?:\/\/[^\s]+)/ig;

export function requestId(): string {
  return crypto.randomUUID();
}

export function safeErrorCode(error: unknown): string {
  const candidate = error && typeof error === 'object' ? (error as UnknownError).code : undefined;
  return typeof candidate === 'string' && /^[A-Z0-9_]{2,32}$/i.test(candidate)
    ? candidate
    : 'DATABASE_QUERY_FAILED';
}

export function logServerError(input: { requestId: string; route: string; operation: string; error: unknown }): void {
  const source = input.error && typeof input.error === 'object' ? input.error as UnknownError : {};
  const message = typeof source.message === 'string' ? source.message.replace(SECRET_PATTERN, '[redacted]').slice(0, 500) : 'unknown error';
  console.error(JSON.stringify({
    level: 'error',
    request_id: input.requestId,
    route: input.route,
    operation: input.operation,
    error_code: safeErrorCode(input.error),
    error: message,
    timestamp: new Date().toISOString(),
  }));
}
