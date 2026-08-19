// ============================================================
// อ่านค่า system_settings (แก้ได้จาก dashboard)
// - cache สั้น ๆ กันยิง DB ทุก update
// - ถ้าตาราง/DB มีปัญหา → ถือว่าบอทเปิด (fail-open) เพื่อไม่ให้บอทตายทั้งระบบ
// ============================================================
import { supabaseAdmin } from './supabaseAdmin';

const CACHE_TTL_MS = 10_000;

let cache: { botEnabled: boolean; maintenanceMessage: string; fetchedAt: number } | null = null;

export interface BotGate {
  botEnabled: boolean;
  maintenanceMessage: string;
}

export async function getBotGate(): Promise<BotGate> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { botEnabled: cache.botEnabled, maintenanceMessage: cache.maintenanceMessage };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('key, value')
      .in('key', ['bot_enabled', 'maintenance_message']);

    if (error) throw error;

    const map: Record<string, any> = {};
    for (const row of data ?? []) map[row.key] = row.value;

    const gate: BotGate = {
      botEnabled: map.bot_enabled !== false,
      maintenanceMessage:
        typeof map.maintenance_message === 'string' && map.maintenance_message.trim()
          ? map.maintenance_message
          : 'ระบบกำลังปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง',
    };
    cache = { ...gate, fetchedAt: Date.now() };
    return gate;
  } catch {
    return {
      botEnabled: true,
      maintenanceMessage: 'ระบบกำลังปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง',
    };
  }
}

/** ล้าง cache ทันที (เรียกหลัง dashboard แก้ค่า) */
export function invalidateBotGateCache(): void {
  cache = null;
}
