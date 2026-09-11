import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, isAuthConfigured } from '@/lib/dashboardAuth';

export const config = {
  matcher: ['/dashboard/:path*', '/api/dashboard/:path*', '/api/admin/:path*', '/api/telegram/webhook'],
};

export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === '/api/telegram/webhook') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return NextResponse.json({ ok: true, expect: 'POST' });
    }
    return NextResponse.next();
  }

  if (!isAuthConfigured()) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const isValid = await verifySessionToken(token);
  if (isValid) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}
