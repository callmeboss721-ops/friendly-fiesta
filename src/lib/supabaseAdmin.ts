// Supabase client ฝั่ง server (ใช้ service_role key) — ใช้ใน API route เท่านั้น
// service_role bypass RLS จึงเขียน/อัปเดตตารางได้ ห้าม import ไฟล์นี้ใน client component
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminKey, getSupabaseUrl } from './runtimeEnv';

const supabaseUrl = getSupabaseUrl();
const serviceRoleKey = getSupabaseAdminKey();
const hasSupabaseAdminConfig = Boolean(supabaseUrl && serviceRoleKey);

// Keep module initialization build-safe, but never pretend the runtime is configured.
if (!hasSupabaseAdminConfig && process.env.NODE_ENV === 'production') {
  console.error('[supabaseAdmin] Supabase admin configuration is missing; set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).');
}

export function isSupabaseAdminConfigured(): boolean {
  return hasSupabaseAdminConfig;
}

export const supabaseAdmin = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  serviceRoleKey ?? 'missing-supabase-admin-key',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
