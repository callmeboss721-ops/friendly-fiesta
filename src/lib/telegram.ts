// ============================================================
// Telegram Bot API helper (ฝั่ง server, ใช้ fetch — เหมาะกับ webhook/serverless)
// ============================================================
import { supabaseAdmin } from './supabaseAdmin';
import { createHash, randomUUID } from 'crypto';
import { getBotToken } from './runtimeEnv';

function botToken(): string {
  const token = getBotToken();
  if (!token) throw new Error('BOT_TOKEN_NOT_CONFIGURED');
  return token;
}

function apiBase(): string {
  return `https://api.telegram.org/bot${botToken()}`;
}

function bucketName(): string {
  return process.env['SUPABASE_BUCKET'] || 'slips';
}

async function tg<T = any>(method: string, payload: Record<string, any>): Promise<T> {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(`Telegram ${method}: ${json?.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

export interface OutgoingMessage {
  text: string;
  reply_markup?: unknown;
}

/** ส่งข้อความ → คืน message_id */
export async function sendMessage(chatId: number, m: OutgoingMessage): Promise<number> {
  const r = await tg<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: m.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: m.reply_markup,
  });
  return r.message_id;
}

/** ส่งไฟล์ (เช่น CSV) เป็น document ในแชต */
export async function sendDocument(
  chatId: number,
  filename: string,
  content: string,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  form.append('document', new Blob(['﻿' + content], { type: 'text/csv' }), filename);
  const response = await fetch(`${apiBase()}/sendDocument`, { method: 'POST', body: form });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Telegram sendDocument: ${result?.description ?? `HTTP ${response.status}`}`);
}

/** แก้ไขข้อความในที่เดิม (เอฟเฟกต์ progress) */
export async function editMessage(chatId: number, messageId: number, m: OutgoingMessage): Promise<void> {
  try {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: m.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: m.reply_markup,
    });
  } catch (e) {
    console.warn(`editMessage failed (chat=${chatId}, msg=${messageId}):`, e instanceof Error ? e.message : e);
  }
}

export async function sendChatAction(chatId: number, action: string): Promise<void> {
  try {
    await tg('sendChatAction', { chat_id: chatId, action });
  } catch (e) {
    console.warn(`sendChatAction failed (chat=${chatId}, action=${action}):`, e instanceof Error ? e.message : e);
  }
}

/** ตอบ callback_query (ปิดสถานะ "กำลังโหลด" ที่ปุ่ม) */
export async function answerCallback(id: string, text?: string): Promise<void> {
  try {
    await tg('answerCallbackQuery', { callback_query_id: id, text });
  } catch (e) {
    console.warn(`answerCallback failed (id=${id}):`, e instanceof Error ? e.message : e);
  }
}

/** ส่ง sticker (ใช้ file_id จาก env vars) — ไม่ throw ถ้า error */
export async function sendSticker(chatId: number, fileId: string): Promise<void> {
  try {
    await tg('sendSticker', { chat_id: chatId, sticker: fileId });
  } catch (e) {
    console.warn(`sendSticker failed (chat=${chatId}):`, e instanceof Error ? e.message : e);
  }
}

/** ดาวน์โหลดรูปจาก Telegram แล้วอัปโหลดขึ้น Supabase Storage → คืน public URL */
export async function uploadSlipFromTelegram(fileId: string): Promise<string> {
  const file = await tg<{ file_path: string }>('getFile', { file_id: fileId });
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`);
  if (!fileRes.ok) throw new Error(`TELEGRAM_FILE_DOWNLOAD_FAILED: HTTP ${fileRes.status}`);
  const contentLength = Number(fileRes.headers.get('content-length') || 0);
  if (contentLength > 15 * 1024 * 1024) throw new Error('SLIP_FILE_TOO_LARGE');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) throw new Error('INVALID_SLIP_FILE');

  const fileKey = createHash('sha256').update(fileId).digest('hex').slice(0, 20);
  const path = `slips/${Date.now()}_${fileKey}_${randomUUID()}.jpg`;
  const { error } = await supabaseAdmin.storage.from(bucketName()).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  return supabaseAdmin.storage.from(bucketName()).getPublicUrl(path).data.publicUrl;
}
