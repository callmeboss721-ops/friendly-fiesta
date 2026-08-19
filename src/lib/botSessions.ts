// ============================================================
// จัดการสถานะสนทนาต่อผู้ใช้ + chat-level settings (per-group rate)
// ============================================================
import { supabaseAdmin } from './supabaseAdmin';

export type SessionState = 'AWAITING_NAME' | 'AWAITING_AMOUNT' | 'EDITING' | 'WAITING_USDT';

export interface BotSession {
  chat_id: number;
  telegram_user_id: number;
  state: SessionState;
  pending_type?: 'THB_DEPOSIT' | 'USDT_SEND' | null;
  slip_url?: string | null;
  slip_fingerprint?: string | null;
  caption?: string | null;
  ocr_thb?: number | null;
  slip_date?: string | null;
  slip_time?: string | null;
  slip_last4?: string | null;
  slip_bank?: string | null;
  slip_receiver_name?: string | null;
  ocr_conf?: number | null;          // ความมั่นใจ OCR สลิป THB
  ledger_ref?: string | null;        // Ledger ID ของดีลที่กำลังทำ
  // ── pending USDT (ระหว่างรอ/ยืนยัน) ──
  pending_usdt?: number | null;
  usdt_network?: string | null;
  usdt_txid?: string | null;
  usdt_image_url?: string | null;
  admin_id?: string | null; // cache admin id เพื่อไม่ต้อง re-query
  admin_name?: string | null; // cache admin name
  live_message_id?: number | null;
  live_tx_id?: string | null;
  vision_message_id?: number | null; // message_id ของ Vision Verification Card สำหรับ inline editing
}

export async function getSession(chatId: number, userId: number): Promise<BotSession | null> {
  const { data, error } = await supabaseAdmin
    .from('bot_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .eq('telegram_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as BotSession) ?? null;
}

export async function setSession(
  chatId: number,
  userId: number,
  patch: Partial<Omit<BotSession, 'chat_id' | 'telegram_user_id'>>,
): Promise<void> {
  const values = Object.fromEntries(
    Object.entries({ ...patch, updated_at: new Date().toISOString() })
      .filter(([, value]) => value !== undefined),
  );
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('bot_sessions')
    .update(values)
    .eq('chat_id', chatId)
    .eq('telegram_user_id', userId)
    .select('chat_id');
  if (updateError) throw new Error(`SESSION_WRITE_FAILED: ${updateError.message}`);
  if ((updated ?? []).length > 0) return;

  if (!patch.state) throw new Error('SESSION_NOT_FOUND');
  const { error: insertError } = await supabaseAdmin.from('bot_sessions').insert({
    chat_id: chatId,
    telegram_user_id: userId,
    ...values,
  });
  if (insertError?.code === '23505') {
    const { error: retryError } = await supabaseAdmin
      .from('bot_sessions')
      .update(values)
      .eq('chat_id', chatId)
      .eq('telegram_user_id', userId);
    if (!retryError) return;
  }
  if (insertError) throw new Error(`SESSION_WRITE_FAILED: ${insertError.message}`);
}

export async function clearSession(chatId: number, userId: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from('bot_sessions')
    .delete()
    .eq('chat_id', chatId)
    .eq('telegram_user_id', userId);
  if (error) throw error;
}

// ─── Per-chat fixed rate (เรตของแต่ละกลุ่ม) — degrade เงียบถ้ายังไม่มีตาราง chat_settings ───
export async function getChatRate(chatId: number): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_settings')
      .select('fixed_rate')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (error) return null;
    return data?.fixed_rate ? Number(data.fixed_rate) : null;
  } catch {
    return null;
  }
}

export async function setChatRate(chatId: number, rate: number, roomName?: string | null): Promise<void> {
  const row: any = { chat_id: chatId, fixed_rate: rate, updated_at: new Date().toISOString() };
  if (roomName) row.room_name = roomName;
  const { error } = await supabaseAdmin
    .from('chat_settings')
    .upsert(row);
  if (error) throw error;
}

/** ดึงเรต + ชื่อห้อง + จุดตัดวัน (Sell Rate มาจาก fixed_rate) */
export async function getRoom(
  chatId: number,
): Promise<{ rate: number | null; name: string | null; dayCutAt: string | null }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_settings')
      .select('fixed_rate, room_name, day_cut_at')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (error || !data) return { rate: null, name: null, dayCutAt: null };
    return {
      rate: data.fixed_rate ? Number(data.fixed_rate) : null,
      name: (data as any).room_name ?? null,
      dayCutAt: (data as any).day_cut_at ?? null,
    };
  } catch {
    return { rate: null, name: null, dayCutAt: null };
  }
}

/** เริ่มวันใหม่ — ตั้งจุดตัดวันของห้องนี้ = ตอนนี้ (ยอดวันนี้เริ่มนับใหม่จากตรงนี้) */
export async function startNewDay(chatId: number): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('chat_settings')
    .upsert({ chat_id: chatId, day_cut_at: now, updated_at: now });
  if (error) throw error;
}

/** ตั้งชื่อห้อง (แสดงใน dashboard / ledger แทนเลข chat) */
export async function setRoomName(chatId: number, name: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('chat_settings')
    .upsert({ chat_id: chatId, room_name: name, updated_at: now });
  if (error) throw error;
}
