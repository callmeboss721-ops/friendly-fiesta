// ============================================================
// POST /api/telegram/webhook — ตัวรับ update จาก Telegram (ออนไลน์ 24/7 บน Netlify)
// รวม logic ทั้งหมด: onboarding (ถามชื่อ) + อัปโหลดสลิป + บันทึกธุรกรรม + ธีม CE Vault
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import * as UI from '@/lib/botUi';
import { sendMessage, editMessage, answerCallback, uploadSlipFromTelegram, sendSticker,  } from '@/lib/telegram';
import { getSession, setSession, clearSession } from '@/lib/botSessions';
import LiveMessageService from '@/lib/liveMessage';
import {
  getAdminByTelegramId,
  upsertAdmin,
  getLatestRates,
  getDefaultBankAccountId,
  insertRate,
  editTransaction,
  deleteTransaction,
  getTodayLedger,
  recordDeal,
  resetRoom,
  getStaffLeaderboard,
  exportRoomCsv,
  recordIncoming,
  recordOutgoing,
  getRecentPairs,
  getRecentSlips,
  getTodayBankAccountTotals,
  DuplicateSlipError,
} from '@/lib/transactions';
import { getChatRate, setChatRate, getRoom, startNewDay, setRoomName } from '@/lib/botSessions';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sendDocument } from '@/lib/telegram';
import { notifyDailySummary, notifyReady } from '@/lib/notifier';
import { analyzeSlip, analyzeUsdtScreenshot } from '@/lib/ocr';
import { getBotGate } from '@/lib/systemSettings';
import { parseAmounts } from '@/lib/amounts';
import { findReceiversByLast4, upsertReceiverOnDeposit } from '@/lib/receivers';
import { getSticker, validateStickers, type StickerState } from '@/config/stickers';
import {
  commandName,
  isBootstrapAdmin,
  isLowConfidence,
  requiresAdminAccess,
  parseRecentLimit,
  parseSaveSlipArgs,
  slipFingerprint,
} from '@/lib/botSecurity';
import {
  getOcrAutoMin,
  getSupabaseAdminKey,
  getTelegramWebhookSecret,
  validateWebhookEnvironment,
} from '@/lib/runtimeEnv';
import {
  accountLast4,
  listPinnedBanks,
  matchPinnedBank,
  pinBankAccount,
  unpinBankAccount,
} from '@/lib/banks';

// ตรวจ USDT (OCR vs พิมพ์เอง) ต้องตรงกันในระดับ 0.0001 (req 13)
const USDT_TOLERANCE = 0.0001;
// OCR มั่นใจ >= ค่านี้ → บันทึกขาเข้าทันที ไม่ต้องถาม
const OCR_AUTO_MIN = getOcrAutoMin();

// fire-and-forget — ไม่ block flow หลัก ไม่ throw
function sticker(chatId: number, key: StickerState): void {
  const id = getSticker(key);
  if (id) sendSticker(chatId, id).catch(() => undefined);
}

export const runtime = 'nodejs';
export const maxDuration = 30; // serverless function timeout budget (seconds)

// Validate sticker config at cold-start (logs warning, never crashes the webhook)
try { validateStickers(); } catch (e: any) { console.warn(`[sticker config] ${e.message}`); }

const WEBHOOK_SECRET = getTelegramWebhookSecret();
const WEBHOOK_CONFIG_ISSUES = validateWebhookEnvironment();

const log = (msg: string, data?: any) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`, data || '');
};

const parseNums = (s: string): number[] =>
  s.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));

type NlIntent = 'today' | 'profit' | 'recent' | 'rate';
/** จับ intent จากข้อความธรรมชาติ (ไม่ต้องมี /); คืน null ถ้าไม่ match */
function matchNlIntent(text?: string): NlIntent | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t.startsWith('/')) return null;
  if (/(^|\s)(ยอด|สรุป)?วันนี้(\s|$)|today|summary/i.test(t)) return 'today';
  if (/กำไร|profit/i.test(t)) return 'profit';
  if (/(ลูกค้า|รายการ)?ล่าสุด|recent|ผู้รับล่าสุด/i.test(t)) return 'recent';
  if (/(เรท|เรต|rate|exchange)/i.test(t)) return 'rate';
  return null;
}

export async function POST(req: NextRequest) {
  if (WEBHOOK_CONFIG_ISSUES.length > 0 || !WEBHOOK_SECRET || !getSupabaseAdminKey()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'service_not_configured',
        configuration: WEBHOOK_CONFIG_ISSUES.map((issue) => `${issue.key}:${issue.code}`),
      },
      { status: 503 },
    );
  }
  // ตรวจ secret จาก Telegram (ตั้งตอน setWebhook)
  if (req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    log('❌ Invalid webhook secret');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let claimedUpdateId: number | null = null;
  let failureChatId: number | null = null;
  try {
    const update = await req.json();
    failureChatId = Number(update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id) || null;
    const updateId = Number(update?.update_id);
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
      return NextResponse.json({ ok: false, error: 'invalid_update' }, { status: 400 });
    }
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc('claim_telegram_update', {
      p_update_id: updateId,
    });
    if (claimError) throw new Error(`DATABASE_MIGRATION_REQUIRED: ${claimError.message}`);
    if (!claimed) return NextResponse.json({ ok: true, duplicate: true });
    claimedUpdateId = updateId;
    log(`📨 incoming update #${updateId}`);

    // Kill-switch จาก dashboard — ตอบข้อความแจ้งปิดปรับปรุงแล้วจบ
    const gate = await getBotGate();
    if (!gate.botEnabled) {
      log(`⏸️ bot disabled — skipping update #${updateId}`);
      if (failureChatId != null) {
        try {
          await sendMessage(failureChatId, UI.error(gate.maintenanceMessage));
        } catch {
          // Telegram may itself be unavailable.
        }
      }
      return NextResponse.json({ ok: true, botDisabled: true });
    }

    // Timeout protection: 25s (function budget ~30s, buffer 5s)
    await Promise.race([
      handleUpdate(update),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WEBHOOK_TIMEOUT')), 25000)
      ),
    ]);
    log(`✅ update #${updateId} processed`);
  } catch (e: any) {
    log(`⚠️ webhook error: ${e?.message || e}`, e?.stack?.slice(0, 200));
    if (failureChatId != null) {
      try {
        await sendMessage(failureChatId, UI.error('ระบบยังดำเนินการไม่ได้ — รอสักครู่แล้วลองคำสั่งเดิมอีกครั้ง'));
      } catch {
        // Telegram may itself be unavailable.
      }
    }
    if (claimedUpdateId != null) {
      try {
        await supabaseAdmin.from('telegram_updates').delete().eq('update_id', claimedUpdateId);
      } catch {
        // The original failure remains authoritative; Telegram will retry.
      }
    }
    return NextResponse.json({ ok: false, error: 'processing_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleUpdate(update: any): Promise<void> {
  // ----- callback_query จากปุ่ม แก้ไข/ลบ -----
  if (update?.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update?.message;
  if (!msg) return;
  const chatId: number = msg.chat?.id;
  const userId: number | undefined = msg.from?.id;
  if (!chatId || !userId) return;
  const text: string | undefined = msg.text?.trim();
  const chatType: string = msg.chat?.type ?? 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const cmd = commandName(text);
  const admin = await getAdminByTelegramId(userId);

  if ((requiresAdminAccess(text) || Boolean(msg.photo)) && !admin) {
    await sendMessage(chatId, UI.error('คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบ — ติดต่อ SuperAdmin เพื่อเพิ่มสิทธิ์'));
    return;
  }

  // ----- ภาษาธรรมชาติ (NL): พิมพ์ 'ยอดวันนี้' / 'กำไรวันนี้' / 'ลูกค้าล่าสุด' / 'เรทตอนนี้' -----
  const intent = matchNlIntent(text);
  if (intent && !cmd) {
    if (intent === 'today' || intent === 'profit') { await sendLedger(chatId); return; }
    if (intent === 'recent') {
      try {
        const slips = await getRecentSlips(chatId, 5);
        await sendMessage(chatId, UI.recentSlipsList(slips));
      } catch (e: any) {
        await sendMessage(chatId, UI.error(e?.message ?? 'ไม่สามารถดึงรายการล่าสุดได้'));
      }
      return;
    }
    if (intent === 'rate') {
      const r = await getLatestRates();
      await sendMessage(chatId, UI.rateShow(r.sellRate, r.marketUsdtRate, r.marketSource));
      return;
    }
  }

  // ----- /summary : สรุปวันนี้ (ส่งไปกลุ่มแจ้งเตือน CEempire) -----
  if (cmd === 'summary') {
    await notifyDailySummary();
    return;
  }
  // ----- /ping : เช็คสถานะ CEempire -----
  if (cmd === 'ping') {
    await notifyReady();
    return;
  }

  // ----- /receiver <last4> : ดูประวัติผู้รับ -----
  if (text && text.startsWith('/receiver')) {
    const last4 = (text.replace('/receiver', '').trim().match(/\d{4}/) || [])[0];
    if (!last4) {
      await sendMessage(chatId, UI.commandUsage('ค้นหาผู้รับ', 'Find Receiver', '/receiver 6578', 'ระบุเลขท้ายบัญชี 4 ตัว'));
      return;
    }
    const found = await findReceiversByLast4(last4);
    if (found.length === 0) {
      await sendMessage(chatId, UI.receiverNotFound(last4));
      return;
    }
    for (const r of found.slice(0, 3)) {
      await sendMessage(
        chatId,
        UI.receiverCard({
          bank: r.bank, last4: r.account_last4, name: r.receiver_name, status: r.status,
          totalTx: r.total_transactions, totalThb: Number(r.total_amount_thb),
          totalUsdt: Number(r.total_usdt), maxThb: Number(r.max_amount_thb),
          lastThb: Number(r.last_amount_thb), lastAt: r.last_transaction_at, lastRef: r.last_ledger_ref,
        }),
      );
    }
    return;
  }

  // ----- /cancel : ออกจากโหมดใดๆ -----
  if (text && text.startsWith('/cancel')) {
    await clearSession(chatId, userId);
    await sendMessage(chatId, UI.cancelled());
    return;
  }

  // ----- /setrate <n> : ตั้งเรตแลกของ "ห้องนี้" -----
  if (text && (text.startsWith('/setrate') || text.startsWith('/เรต'))) {
    const nums = parseNums(text.replace('/setrate', '').replace('/เรต', ''));
    if (nums.length >= 1 && nums[0] > 0) {
      await setChatRate(chatId, nums[0]);
      await sendMessage(chatId, UI.chatRateSet(nums[0]));
    } else {
      const cur = await getChatRate(chatId);
      await sendMessage(chatId, UI.chatRateSet(cur ?? 0));
    }
    return;
  }

  // ----- /menu : เมนูคำสั่งทั้งหมด -----
  if (text && text.startsWith('/menu')) {
    await sendMessage(chatId, UI.menuCard());
    return;
  }

  // ----- /ยอด , /today , /ledger : สรุปยอดห้องนี้วันนี้ (แยกห้อง) -----
  if (text && (text.startsWith('/ยอด') || text.startsWith('/today') || text.startsWith('/ledger') || text.startsWith('/สรุป'))) {
    await sendLedger(chatId);
    return;
  }

  // ----- /newday : เริ่มวันใหม่ (day-cut) — โพสต์สรุปวันเก่าก่อน -----
  if (text && text.startsWith('/newday')) {
    await doNewDay(chatId);
    return;
  }

  // ----- /reset : ล้างยอดห้องนี้ (ถามยืนยันก่อน) -----
  if (text && text.startsWith('/reset')) {
    const room = await getRoom(chatId);
    await sendMessage(chatId, UI.resetAsk(room.name));
    return;
  }

  // ----- /setroom <ชื่อ> : ตั้งชื่อห้อง -----
  if (text && (text.startsWith('/setroom') || text.startsWith('/ห้อง'))) {
    const name = text.replace('/setroom', '').replace('/ห้อง', '').trim().slice(0, 40);
    if (!name) {
      await sendMessage(chatId, UI.commandUsage('ตั้งชื่อห้อง', 'Set Room Name', '/setroom ห้อง A'));
      return;
    }
    await setRoomName(chatId, name);
    await sendMessage(chatId, UI.roomNameSet(name));
    return;
  }

  // ----- /export : ดาวน์โหลด CSV ยอดห้องนี้ (ส่งเป็นไฟล์ในแชต) -----
  if (text && text.startsWith('/export')) {
    const room = await getRoom(chatId);
    // /export all = ทั้งหมด, ไม่งั้นเฉพาะช่วงวันนี้ (จาก day-cut)
    const wantAll = /all|ทั้งหมด/.test(text);
    const { csv, rows } = await exportRoomCsv(chatId, wantAll ? null : room.dayCutAt);
    if (rows === 0) {
      await sendMessage(chatId, UI.emptyState('ส่งออกรายการ', 'Export Transactions', 'ยังไม่มีธุรกรรมให้ส่งออก'));
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await sendDocument(
      chatId,
      `ce-vault-${room.name || chatId}-${stamp}.csv`,
      csv,
      `📄 <b>${rows} รายการ</b> · ${room.name || 'ห้องนี้'}${wantAll ? ' (ทั้งหมด)' : ' (วันนี้)'}`,
    );
    return;
  }

  // ----- /start , /help , /register -----
  if (cmd === 'start' || cmd === 'help' || cmd === 'register') {
    let existing = admin;
    if (!existing && isBootstrapAdmin(userId)) {
      const displayName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').slice(0, 60) || `Admin ${userId}`;
      existing = await upsertAdmin(userId, displayName);
    }
    if (!existing) {
      await sendMessage(chatId, UI.error('บัญชีนี้ยังไม่ได้รับสิทธิ์ — ให้ SuperAdmin เพิ่ม Telegram ID ก่อน'));
      return;
    }
    await sendMessage(chatId, UI.welcomeRegistered(existing.name));
    sticker(chatId, 'WELCOME');
    return;
  }

  const session = await getSession(chatId, userId);

  // ----- /rate : ดูเรต (ตลาด=Binance TH สด) / ตั้งเรตขาย -----
  if (text && text.startsWith('/rate')) {
    const nums = parseNums(text.replace('/rate', ''));
    const r = await getLatestRates(); // marketUsdtRate = Binance TH real-time
    if (nums.length >= 1) {
      if (!admin) {
        await setSession(chatId, userId, { state: 'AWAITING_NAME' });
        await sendMessage(chatId, UI.askName());
        return;
      }
      const sell = nums[0];
      const market: number = (nums[1] ?? r.marketUsdtRate ?? Number(process.env.DEFAULT_MARKET_RATE) ?? 34.8) as number;
      await insertRate(admin.id, sell, market);
      await sendMessage(chatId, UI.rateSet(admin.name, sell, market));
    } else {
      await sendMessage(chatId, UI.rateShow(r.sellRate, r.marketUsdtRate, r.marketSource));
    }
    return;
  }

  // ----- /pin /unpin : บัญชีรับของห้องนี้สำหรับวันนี้ -----
  if (cmd === 'pin') {
    const rest = text!.replace(/^\/pin(?:@[a-z0-9_]+)?/i, '').trim();
    if (!rest) {
      const pinned = await listPinnedBanks(chatId);
      await sendMessage(
        chatId,
        UI.pinnedAccounts(
          pinned.map((bank) => ({
            bank: bank.bank_name,
            last4: accountLast4(bank.account_number) ?? '????',
          })),
        ),
      );
      return;
    }
    const parts = rest.split(/\s+/);
    if (parts.length < 2) {
      await sendMessage(chatId, UI.error('รูปแบบไม่ถูกต้อง — ใช้ /pin KBANK 1234567890'));
      return;
    }
    try {
      const result = await pinBankAccount(chatId, parts[0], parts.slice(1).join(''));
      await sendMessage(
        chatId,
        UI.pinUpdated(
          'pin',
          result.bank.bank_name,
          accountLast4(result.bank.account_number) ?? '????',
          result.pinned.length,
        ),
      );
    } catch (error: any) {
      const detail = error?.message === 'PIN_LIMIT_REACHED' ?'Pin ได้สูงสุด 3 บัญชีต่อวัน — ใช้ /unpin 1 ก่อนเพิ่มบัญชีใหม่' :'เพิ่มบัญชีไม่สำเร็จ — ตรวจรูปแบบ /pin KBANK 1234567890 แล้วลองใหม่';
      await sendMessage(chatId, UI.error(detail));
    }
    return;
  }

  if (cmd === 'unpin') {
    const selector = text!.replace(/^\/unpin(?:@[a-z0-9_]+)?/i, '').trim();
    if (!selector) {
      await sendMessage(chatId, UI.error('ระบุลำดับหรือเลขท้ายบัญชี เช่น /unpin 1 หรือ /unpin 7890'));
      return;
    }
    const removed = await unpinBankAccount(chatId, selector);
    if (!removed) {
      await sendMessage(chatId, UI.error('ไม่พบบัญชีที่ต้องการลบ — ใช้ /pin เพื่อดูรายการ'));
      return;
    }
    await sendMessage(
      chatId,
      UI.pinUpdated('unpin', removed.bank_name, accountLast4(removed.account_number) ?? '????'),
    );
    return;
  }

  // ----- /recent_slips : ส่งรายการสลิปล่าสุดเป็นเทมเพลตข้อความ พร้อม mention ผู้ดูแล -----
  if (cmd === 'recent_slips') {
    const limit = parseRecentLimit(text!);
    if (limit == null) {
      await sendMessage(chatId, UI.error('จำนวนรายการต้องอยู่ระหว่าง 1–20 เช่น /recent_slips 10'));
      return;
    }
    try {
      const slips = await getRecentSlips(chatId, limit);
      await sendMessage(chatId, UI.recentSlipsList(slips));
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'ไม่สามารถดึงรายการล่าสุดได้'));
    }
    return;
  }

  // ----- /save_slip : บันทึกรูปสลิป (ส่งคำสั่งโดย reply ถึงรูป) -----
  if (cmd === 'save_slip') {
    const manual = parseSaveSlipArgs(text!);
    if (!manual) {
      await sendMessage(chatId, UI.error('รูปแบบไม่ถูกต้อง — ใช้ /save_slip, /save_slip +500B หรือ /save_slip +500B KBANK 7890'));
      return;
    }
    sticker(chatId, 'PROCESSING');
    try {
      const replyPhoto = msg.reply_to_message?.photo?.at(-1);
      let imgUrl = session?.slip_url ?? null;
      let fingerprint = session?.slip_fingerprint ?? null;
      let slip: Awaited<ReturnType<typeof analyzeSlip>> = {
        thbAmount: session?.ocr_thb ?? null,
        bank: session?.slip_bank ?? null,
        receiverLast4: session?.slip_last4 ?? null,
        receiverName: session?.slip_receiver_name ?? null,
        senderName: null,
        date: session?.slip_date ?? null,
        time: session?.slip_time ?? null,
        confidence: session?.ocr_conf ?? null,
      };
      if (replyPhoto) {
        fingerprint = slipFingerprint(replyPhoto.file_unique_id);
        imgUrl = await uploadSlipFromTelegram(replyPhoto.file_id);
        slip = await analyzeSlip(imgUrl);
      }
      if (!imgUrl || !fingerprint) {
        await sendMessage(chatId, UI.error('ไม่พบสลิป — Reply รูปด้วย /save_slip หรือส่งรูปใหม่'));
        return;
      }

      const amount = manual.thb ?? slip.thbAmount;
      await setSession(chatId, userId, {
        state: 'WAITING_USDT', pending_type: 'THB_DEPOSIT', slip_url: imgUrl,
        slip_fingerprint: fingerprint, ocr_thb: slip.thbAmount,
        slip_last4: slip.receiverLast4, slip_bank: slip.bank,
        slip_receiver_name: slip.receiverName, ocr_conf: slip.confidence,
        admin_id: admin!.id, admin_name: admin!.name,
      });
      if (!amount || amount <= 0 || (isLowConfidence(slip.confidence, OCR_AUTO_MIN) && !manual.thb)) {
        await sendMessage(
          chatId,
          UI.ocrUnclear(
            slip.confidence,
            'ตรวจยอดจริงแล้วใช้ /save_slip +500B โดยเปลี่ยน 500 เป็นยอดจริง',
          ),
        );
        return;
      }

      const pinned = await listPinnedBanks(chatId);
      if (pinned.length === 0) {
        await sendMessage(chatId, UI.error('ยังไม่มีบัญชีรับที่ Pin — ใช้ /pin KBANK 1234567890 แล้วลอง /save_slip อีกครั้ง'));
        return;
      }
      if (
        (manual.bank && slip.bank && manual.bank !== slip.bank.toUpperCase()) ||
        (manual.last4 && slip.receiverLast4 && manual.last4 !== slip.receiverLast4)
      ) {
        await sendMessage(chatId, UI.accountMismatch('ข้อมูลบัญชี Manual ขัดกับ Vision OCR'));
        return;
      }
      const bank = matchPinnedBank(slip.bank ?? manual.bank, slip.receiverLast4 ?? manual.last4, pinned);
      if (!bank) {
        await sendMessage(chatId, UI.accountMismatch('หาก OCR อ่านไม่ได้ ใช้ /save_slip +500B KBANK 7890'));
        return;
      }

      const res = await commitIncoming(chatId, userId, amount, {
        slipUrl: imgUrl, slipFingerprint: fingerprint, bankAccountId: bank.id,
        bank: bank.bank_name, last4: accountLast4(bank.account_number),
        receiverName: slip.receiverName ?? null, confidence: slip.confidence ?? null,
      });
      await clearSession(chatId, userId);
      sticker(chatId, 'SUCCESS');
      await sendMessage(chatId, UI.incomingRecorded({
        transactionId: res.transactionId, ledgerRef: res.ledgerRef, thb: res.thb,
        usdtOwed: res.usdtOwed, sellRate: res.sellRate, adminName: res.adminName,
        bank: res.bank, last4: res.last4, confidence: res.confidence,
        todayIncoming: res.todayIncoming, todayTotalThb: res.todayTotalThb,
      }));
    } catch (e: any) {
      const detail = e instanceof DuplicateSlipError
        ? 'สลิปนี้ถูกบันทึกแล้ว — ใช้ /recent_slips เพื่อตรวจ Ledger Reference' : e?.message ??'บันทึกสลิปไม่สำเร็จ — ตรวจรูปและลองใหม่';
      await sendMessage(chatId, UI.error(detail));
    }
    return;
  }

  // ----- รูปภาพ: ส่ง Vision Verification Card (ยังไม่บันทึก) -----
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    let fingerprint = slipFingerprint(photo.file_unique_id);
    sticker(chatId, 'PROCESSING');
    try {
      let imgUrl = await uploadSlipFromTelegram(fileId);
      let slip = await analyzeSlip(imgUrl);
      const ledgerRef = UI.newLedgerRef();

      // THB slip: show Vision Verification Card
      if (slip?.thbAmount && slip.thbAmount > 0) {
        const pinned = await listPinnedBanks(chatId);
        const bank = matchPinnedBank(slip.bank, slip.receiverLast4, pinned);
        const r = await getLatestRates();
        const roomRate = (await getChatRate(chatId)) ?? r.sellRate;

        const accountMatched = !!bank;
        let todayCount = 0;
        let todayTotal = 0;
        if (bank) {
          const dayTotals = await getTodayBankAccountTotals(bank.id);
          todayCount = dayTotals.count;
          todayTotal = dayTotals.totalThb;
        }

        const suggestedUsdt = roomRate > 0 ? slip.thbAmount / roomRate : 0;

        // Save session state before showing verification
        await setSession(chatId, userId, {
          state: 'WAITING_USDT', pending_type: 'THB_DEPOSIT', slip_url: imgUrl,
          slip_fingerprint: fingerprint, ocr_thb: slip.thbAmount,
          slip_date: slip.date, slip_time: slip.time, slip_last4: slip.receiverLast4,
          slip_bank: slip.bank, slip_receiver_name: slip.receiverName,
          ocr_conf: slip.confidence, ledger_ref: ledgerRef,
          admin_id: admin!.id, admin_name: admin!.name,
          vision_message_id: null, // will update in next step
        });

        // Send verification card
        const verifyMsg = await sendMessage(
          chatId,
          UI.visionSlipVerification({
            thb: slip.thbAmount,
            bank: slip.bank,
            last4: slip.receiverLast4,
            receiverName: slip.receiverName,
            confidence: slip.confidence,
            accountMatched,
            accountClear: slip.bank != null && slip.receiverLast4 != null,
            matchedBank: bank?.bank_name,
            matchedLast4: accountLast4(bank?.account_number) ?? '????',
            roomRate,
            suggestedUsdt,
            todayCountForAccount: accountMatched ? todayCount : undefined,
            todayTotalThbForAccount: accountMatched ? todayTotal : undefined,
          }),
        );

        // Store message_id for later inline editing
        await setSession(chatId, userId, { vision_message_id: verifyMsg });
        return;
      }

      // USDT screenshot: keep OCR result, require explicit -13.6U confirmation.
      const u = await analyzeUsdtScreenshot(imgUrl);
      if (u?.amount && u.amount > 0) {
        await setSession(chatId, userId, {
          state: 'WAITING_USDT', pending_type: 'USDT_SEND', pending_usdt: u.amount,
          slip_url: imgUrl, slip_fingerprint: fingerprint,
          usdt_network: u.network, usdt_txid: u.txid, ocr_conf: u.confidence,
          admin_id: admin!.id, admin_name: admin!.name,
          ledger_ref: ledgerRef,
        });
        await sendMessage(
          chatId,
          UI.usdtSlipPending({
            usdt: u.amount,
            confidence: u.confidence,
            lowConfidence: isLowConfidence(u.confidence, OCR_AUTO_MIN),
          }),
        );
        return;
      }

      // (C) OCR unclear
      await setSession(chatId, userId, {
        state: 'WAITING_USDT',
        pending_type: 'THB_DEPOSIT',
        slip_url: imgUrl,
        slip_fingerprint: fingerprint,
        ocr_thb: slip?.thbAmount ?? null,
        slip_last4: slip?.receiverLast4 ?? null,
        slip_bank: slip?.bank ?? null,
        slip_receiver_name: slip?.receiverName ?? null,
        ocr_conf: slip?.confidence ?? null,
        ledger_ref: ledgerRef,
        admin_id: admin!.id,
        admin_name: admin!.name,
      });
      await sendMessage(chatId, UI.ocrUnclear(
        slip?.confidence,
        'ตรวจยอด/บัญชีแล้วใช้ /save_slip +500B KBANK 7890'
      ));
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'upload failed'));
    }
    return;
  }

  // ----- ข้อความตัวอักษร -----
  if (!text) return;

  const accessAmounts = parseAmounts(text);
  if (!admin && (accessAmounts.thb || accessAmounts.usdt)) {
    await sendMessage(chatId, UI.error('การบันทึก Ledger ใช้ได้เฉพาะผู้ดูแลระบบ'));
    return;
  }

  // (ก) รอชื่อ → ลงทะเบียน
  if (session?.state === 'AWAITING_NAME') {
    await clearSession(chatId, userId);
    await sendMessage(chatId, UI.error('การลงทะเบียนอัตโนมัติถูกปิด — ให้ SuperAdmin เพิ่ม Telegram ID ก่อน'));
    return;
  }

  // (ข.5) กำลังแก้ไขธุรกรรม → อัปเดต tx เดิม (ใช้รูปแบบ +500B / -13.6U เหมือนกัน)
  if (session?.state === 'EDITING' && session.caption) {
    const amt = parseAmounts(text);
    if (amt.hasBareNumber || amt.ambiguous || (!amt.thb && !amt.usdt)) {
      await sendMessage(chatId, UI.error('ใช้รูปแบบชัดเจนเท่านั้น: +500B หรือ -13.6U'));
      return;
    }
    const txId = session.caption; // เก็บ tx_id ไว้ในฟิลด์ caption
    await clearSession(chatId, userId);
    try {
      const { data: old } = await supabaseAdmin
        .from('transactions')
        .select('type, usdt_amount')
        .eq('id', txId)
        .single();
      if (!old) throw new Error('ไม่พบธุรกรรมเดิม');

      const newUsdt = amt.usdt ? amt.usdt.value : Number(old.usdt_amount);
      const patch = amt.thb ? { newThb: amt.thb.value, newUsdt } : { newUsdt };
      const r = await editTransaction(txId, patch);
      await sendMessage(
        chatId,
        UI.editSuccess({
          transactionId: txId,
          adminName: r.admin.name,
          type: old.type,
          thb: Number(r.tx.thb_amount),
          usdt: Number(r.tx.usdt_amount),
          netProfitThb: Number(r.tx.netProfitThb ?? r.tx.net_profit_thb),
          profitPercent: Number(r.tx.profitPercent ?? r.tx.profit_percent),
          feeUsdt: Number(r.tx.feeUsdt ?? r.tx.fee_usdt),
          feePercent: Number(r.tx.feePercent ?? r.tx.fee_percent),
          holdingUsdt: r.admin.holdingUsdt,
        }),
      );
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'edit failed'));
    }
    return;
  }

  // (ข) พิมพ์ยอด: +500 = บาทเข้า · -13.6 = USDT ออก · อย่างอื่นเงียบ (ไม่ถามกลับ)
  {
    const amt = parseAmounts(text);
    if (amt.ambiguous) {
      await sendMessage(chatId, UI.error('พบยอดซ้ำหลายค่า — ส่งครั้งละหนึ่งยอด เช่น +500B หรือ -13.6U'));
      return;
    }
    if (amt.thb && amt.thb.sign > 0) {
      if (!session?.slip_url || !session.slip_fingerprint || session.pending_type !== 'THB_DEPOSIT') {
        await sendMessage(chatId, UI.error('ต้องส่งรูปสลิปก่อน — จากนั้นยืนยันด้วย /save_slip +500B'));
        return;
      }
      try {
        const pinned = await listPinnedBanks(chatId);
        const bank = matchPinnedBank(session.slip_bank, session.slip_last4, pinned);
        if (!bank) {
          await sendMessage(chatId, UI.accountMismatch('แก้บัญชีด้วย /pin แล้วใช้ /save_slip +500B'));
          return;
        }
        const res = await commitIncoming(chatId, userId, amt.thb.value, {
          slipUrl: session.slip_url, slipFingerprint: session.slip_fingerprint,
          bankAccountId: bank.id, bank: bank.bank_name,
          last4: accountLast4(bank.account_number), receiverName: session.slip_receiver_name,
          confidence: session.ocr_conf,
        });
        await clearSession(chatId, userId);
        await sendMessage(chatId, UI.incomingRecorded({
          transactionId: res.transactionId, ledgerRef: res.ledgerRef, thb: res.thb,
          usdtOwed: res.usdtOwed, sellRate: res.sellRate, adminName: res.adminName,
          bank: res.bank, last4: res.last4, confidence: res.confidence,
          todayIncoming: res.todayIncoming, todayTotalThb: res.todayTotalThb,
        }));
        sticker(chatId, 'SUCCESS');
      } catch (e: any) {
        const detail = e instanceof DuplicateSlipError
          ? 'สลิปนี้ถูกบันทึกแล้ว — ใช้ /recent_slips เพื่อตรวจ Ledger Reference' : e?.message ??'บันทึกไม่สำเร็จ — ตรวจข้อมูลแล้วลองใหม่';
        await sendMessage(chatId, UI.error(detail));
      }
      return;
    }
    if (amt.usdt && amt.usdt.sign < 0) {
      try {
        const screenshotSession = session?.pending_type === 'USDT_SEND' ? session : null;
        const res = await commitOutgoing(chatId, userId, amt.usdt.value, {
          slipUrl: screenshotSession?.slip_url,
          slipFingerprint: screenshotSession?.slip_fingerprint,
          network: screenshotSession?.usdt_network,
          txid: screenshotSession?.usdt_txid,
        });
        if (screenshotSession) await clearSession(chatId, userId);
        await sendMessage(chatId, UI.outgoingRecorded({
          transactionId: res.transactionId, ledgerRef: res.ledgerRef,
          usdt: res.usdt, adminName: res.adminName,
          shouldSendUsdt: res.shouldSendUsdt, remainingUsdt: res.remainingUsdt,
        }));
        sticker(chatId, 'SUCCESS');
      } catch (e: any) {
        const detail = e instanceof DuplicateSlipError
          ? 'หลักฐานนี้ถูกบันทึกแล้ว — ใช้ /recent_slips เพื่อตรวจ Ledger Reference' : e?.message ??'บันทึกไม่สำเร็จ — ตรวจยอดแล้วลองใหม่';
        await sendMessage(chatId, UI.error(detail));
      }
      return;
    }
    // ทิศทางผิด: THB ต้องเป็นเงินเข้า (+), USDT ต้องเป็นเหรียญออก (-) — ห้ามบันทึกเงียบ
    if (amt.thb && amt.thb.sign < 0) {
      await sendMessage(chatId, UI.wrongDirection('THB'));
      return;
    }
    if (amt.usdt && amt.usdt.sign > 0) {
      await sendMessage(chatId, UI.wrongDirection('USDT'));
      return;
    }
    if (amt.hasBareNumber) {
      await sendMessage(chatId, UI.error('ห้ามเดาสกุลเงิน — ใช้ +500B สำหรับ THB IN หรือ -13.6U สำหรับ USDT OUT'));
      return;
    }
    if (amt.thb || amt.usdt) return;
  }

  // ผู้ใช้ที่ไม่ได้รับสิทธิ์จะไม่ถูก auto-register จากข้อความทั่วไป
  if (!admin && !isGroup) {
    await sendMessage(chatId, UI.error('บัญชีนี้ยังไม่ได้รับสิทธิ์ — ให้ SuperAdmin เพิ่ม Telegram ID ก่อน'));
  }
}

/** บันทึกขาเข้า (รับ THB) ทันที — ไม่ถามยืนยัน */
async function commitIncoming(
  chatId: number,
  userId: number,
  thb: number,
  meta: {
    slipUrl?: string | null;
    slipFingerprint?: string | null;
    bankAccountId?: string | null;
    bank?: string | null;
    last4?: string | null;
    receiverName?: string | null;
    confidence?: number | null;
  },
): Promise<any> {
  const [room, rates] = await Promise.all([getRoom(chatId), getLatestRates()]);
  const sellRate = room.rate ?? rates.sellRate;
  const ledgerRef = UI.newLedgerRef();

  const r = await recordIncoming({
    adminTelegramId: userId,
    chatId,
    thb,
    sellRate,
    marketRate: rates.marketUsdtRate,
    roomName: room.name,
    ledgerRef,
    ocrConfidence: meta.confidence ?? null,
    slipImageUrl: meta.slipUrl ?? null,
    slipFingerprint: meta.slipFingerprint ?? null,
    bankAccountId: meta.bankAccountId ?? null,
    receiver: { name: meta.receiverName ?? null, bank: meta.bank ?? null, last4: meta.last4 ?? null },
  });

  // Receiver History (fire-and-forget)
  if (meta.last4) {
    upsertReceiverOnDeposit({
      bank: meta.bank ?? null,
      last4: meta.last4,
      receiverName: meta.receiverName ?? null,
      thb,
      usdt: r.usdtOwed,
      ledgerRef,
    })
      .then((rid) => {
        if (rid)
          return supabaseAdmin.from('transactions').update({ receiver_id: rid })
            .eq('id', r.transactionId).then(() => undefined, () => undefined);
      })
      .catch(() => undefined);
  }

  const led = await getTodayLedger(room.dayCutAt, chatId);

  // Create a single live message via LiveMessageService (centralized)
  const { liveMessageId } = await LiveMessageService.create({
    transactionId: r.transactionId,
    chatId,
    userId,
    ledgerRef,
    adminName: r.adminName,
  });

  // Return data for caller to decide how to render or further edit the live message
  return {
    transactionId: r.transactionId,
    ledgerRef,
    thb,
    usdtOwed: r.usdtOwed,
    sellRate,
    adminName: r.adminName,
    bank: meta.bank ?? null,
    last4: meta.last4 ?? null,
    confidence: meta.confidence ?? null,
    todayIncoming: led.incomingList.map((e) => ({ time: e.time, date: e.date, thb: e.thb })),
    todayTotalThb: led.totalThb,
    liveMessageId,
  };
}

/** บันทึกขาออก (ส่ง USDT) ทันที */
async function commitOutgoing(
  chatId: number,
  userId: number,
  usdt: number,
  meta: { slipUrl?: string | null; slipFingerprint?: string | null; network?: string | null; txid?: string | null },
): Promise<any> {
  const room = await getRoom(chatId);
  const ledgerRef = UI.newLedgerRef();
  const r = await recordOutgoing({
    adminTelegramId: userId,
    chatId,
    usdt,
    ledgerRef,
    slipImageUrl: meta.slipUrl ?? null,
    usdtNetwork: meta.network ?? null,
    usdtTxid: meta.txid ?? null,
    slipFingerprint: meta.slipFingerprint ?? null,
  });

  // คงเหลือที่ต้องส่ง = (ยอดรับรวม / เรต) − ส่งไปแล้ว
  const led = await getTodayLedger(room.dayCutAt, chatId);
  const shouldSend = room.rate ? led.totalThb / room.rate : led.totalIncomingUsdt;
  const remaining = shouldSend - led.totalOutgoingUsdt;

  // Try to update live message (if any) with completed outgoing info via LiveMessageService
  try {
    const s = await getSession(chatId, userId);
    const liveId = s?.live_message_id ?? null;
    if (liveId) {
      await LiveMessageService.complete(r.transactionId, chatId, liveId, {
        ledgerRef,
        thb: led.totalThb,
        usdt,
        profitThb: Number((led.netProfitThb ?? 0)),
        remaining: remaining,
        todayTotalThb: led.totalThb,
      });
    }
  } catch (e) {
    // ignore edit failures
  }

  // Return data for caller to render/update a live message
  return {
    transactionId: r.transactionId,
    ledgerRef,
    usdt,
    adminName: r.adminName,
    shouldSendUsdt: shouldSend,
    remainingUsdt: remaining,
  };
}

/** เริ่มวันใหม่: โพสต์สรุปวันเก่าก่อน → ตั้ง day-cut → ยืนยัน */
async function doNewDay(chatId: number): Promise<void> {
  await sendMessage(chatId, UI.sectionIntro('สรุปก่อนเริ่มวันใหม่', 'Closing Summary'));
  await sendLedger(chatId); // สรุปวันเก่า (ก่อนตัด)
  await startNewDay(chatId);
  const label = new Date().toLocaleString('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  });
  await sendMessage(chatId, UI.newDayStarted(label));
}

/** ส่งการ์ดสรุปยอด "ห้องนี้" (แยกตาม chat_id + day-cut) + Top Staff + 5 รายการล่าสุด */
async function sendLedger(chatId: number): Promise<void> {
  const room = await getRoom(chatId);
  const [led, staff, recent] = await Promise.all([
    getTodayLedger(room.dayCutAt, chatId),
    getStaffLeaderboard(room.dayCutAt, chatId),
    getRecentPairs(chatId, room.dayCutAt, 5),
  ]);
  await sendMessage(
    chatId,
    UI.ledgerCard({
      incomingList: led.incomingList,
      outgoingList: led.outgoingList,
      totalThb: led.totalThb,
      totalIncomingUsdt: led.totalIncomingUsdt,
      totalOutgoingUsdt: led.totalOutgoingUsdt,
      fixedRate: room.rate,
      feePercent: 0,
      netProfitThb: led.netProfitThb,
      lastAdminName: led.lastAdminName,
      roomName: room.name,
      staff,
      recent,
    }),
  );
}

// รวมฟิลด์ deal ของ session เดิม (setSession เขียนทับทุกคอลัมน์ ต้องส่งครบกันหาย)
function dealSessionFields(session: any): any {
  return {
    pending_type: 'THB_DEPOSIT',
    slip_url: session.slip_url ?? null,
    ocr_thb: session.ocr_thb ?? null,
    slip_date: session.slip_date ?? null,
    slip_time: session.slip_time ?? null,
    slip_last4: session.slip_last4 ?? null,
    slip_bank: session.slip_bank ?? null,
    slip_receiver_name: session.slip_receiver_name ?? null,
    ocr_conf: session.ocr_conf ?? null,
    ledger_ref: session.ledger_ref ?? null,
    pending_usdt: session.pending_usdt ?? null,
    usdt_network: session.usdt_network ?? null,
    usdt_txid: session.usdt_txid ?? null,
    usdt_image_url: session.usdt_image_url ?? null,
    admin_id: session.admin_id ?? null,
    admin_name: session.admin_name ?? null,
  };
}

/**
 * คำนวณดีล + โชว์การ์ดยืนยัน (Confirm/Edit/Cancel)
 * usdtMeta != null = มาจากสกรีนช็อต (OCR), = null = พิมพ์เอง (manual)
 * req13: ถ้ามีทั้ง OCR และ manual แล้วต่างกัน > 0.0001 → block + manual review
 */
async function presentDealConfirm(
  chatId: number,
  userId: number,
  session: any,
  usdt: number,
  usdtMeta: { network: string | null; txid: string | null; imageUrl: string } | null,
  thbOverride?: number,
): Promise<void> {
  const thb = Number(thbOverride ?? session.ocr_thb) || 0;
  if (!thb) {
    await sendMessage(chatId, UI.needThb());
    return;
  }

  // req13: cross-verify OCR vs manual
  const prior = session.pending_usdt != null ? Number(session.pending_usdt) : null;
  const priorFromOcr = !!session.usdt_image_url;
  const nowFromOcr = !!usdtMeta;
  if (prior != null && prior > 0 && priorFromOcr !== nowFromOcr && Math.abs(prior - usdt) > USDT_TOLERANCE) {
    const ocrVal = nowFromOcr ? usdt : prior;
    const manualVal = nowFromOcr ? prior : usdt;
    // block: ล้าง pending_usdt เพื่อกันกดปุ่มยืนยันเก่า → dealok จะปฏิเสธ
    await setSession(chatId, userId, { ...dealSessionFields(session), state: 'WAITING_USDT', pending_usdt: null });
    await sendMessage(chatId, UI.usdtMismatch(ocrVal, manualVal));
    return;
  }

  const room = await getRoom(chatId);
  const sellRate = room.rate ?? (await getLatestRates()).sellRate;
  const buyRate = usdt > 0 ? thb / usdt : 0;
  const profitThb = usdt * sellRate - thb;

  await setSession(chatId, userId, {
    ...dealSessionFields(session),
    state: 'WAITING_USDT',
    ocr_thb: thb,
    pending_usdt: usdt,
    usdt_network: usdtMeta?.network ?? session.usdt_network ?? null,
    usdt_txid: usdtMeta?.txid ?? session.usdt_txid ?? null,
    usdt_image_url: usdtMeta?.imageUrl ?? session.usdt_image_url ?? null,
  });

  await sendMessage(
    chatId,
    UI.dealConfirm({
      ledgerRef: session.ledger_ref || '—',
      thb, usdt, buyRate, sellRate, profitThb,
      receiverName: session.slip_receiver_name,
      bank: session.slip_bank,
      last4: session.slip_last4,
      network: usdtMeta?.network ?? session.usdt_network ?? null,
    }),
  );
}

/** บันทึกดีลจริง + การ์ดสำเร็จ + ledger รวมของวัน (รวม recent pairs) */
async function finalizeDeal(
  chatId: number,
  userId: number,
  session: any,
  thb: number,
  usdt: number,
  sellRate: number,
  roomName: string | null,
): Promise<void> {
  const [bankAccountId, room] = await Promise.all([getDefaultBankAccountId(), getRoom(chatId)]);
  const ledgerRef = session.ledger_ref || UI.newLedgerRef();

  const r = await recordDeal({
    adminTelegramId: userId,
    chatId,
    thb, usdt, sellRate, roomName: roomName ?? room.name,
    ocrConfidence: session.ocr_conf ?? null,
    ledgerRef,
    slipImageUrl: session.slip_url ?? null,
    usdtImageUrl: session.usdt_image_url ?? null,
    usdtNetwork: session.usdt_network ?? null,
    usdtTxid: session.usdt_txid ?? null,
    receiver: { name: session.slip_receiver_name, bank: session.slip_bank, last4: session.slip_last4 },
    bankAccountId,
  });

  // Receiver History (fire-and-forget)
  if (session.slip_last4) {
    upsertReceiverOnDeposit({
      bank: session.slip_bank ?? null,
      last4: session.slip_last4,
      receiverName: session.slip_receiver_name ?? null,
      thb, usdt, ledgerRef,
    })
      .then((receiverId) => {
        if (receiverId)
          return supabaseAdmin.from('transactions').update({ receiver_id: receiverId })
            .eq('id', r.transactionId).then(() => undefined, () => undefined);
      })
      .catch(() => undefined);
  }

  await sendMessage(
    chatId,
    UI.dealSuccess({
      transactionId: r.transactionId,
      ledgerRef,
      adminName: r.adminName,
      thb, usdt,
      buyRate: r.buyRate,
      sellRate: r.sellRate,
      profitThb: r.profitThb,
      receiverName: session.slip_receiver_name,
      bank: session.slip_bank,
      last4: session.slip_last4,
    }),
  );
  sticker(chatId, 'SUCCESS');

  // แสดง ledger สดรวม recent (หลัง recordDeal แล้ว → ข้อมูลครบ)
  await sendLedger(chatId);

  // Brand Success Card — ส่งต่อท้ายหลังข้อความปกติเสร็จทั้งหมด (fire-and-forget)
  sendMessage(
    chatId,
    UI.brandCard({
      usdt,
      txid: session.usdt_txid ?? null,
      network: session.usdt_network ?? null,
      ledgerRef,
      transactionId: r.transactionId,
    }),
  ).catch(() => undefined);
}

/** จัดการปุ่ม inline: edit:<txId> / del:<txId> / confirm:<usdt> */
async function handleCallback(cb: any): Promise<void> {
  const id: string = cb.id;
  const chatId: number = cb.message?.chat?.id;
  const userId: number = cb.from?.id;
  const data: string = cb.data || '';
  if (!chatId || !userId) return await answerCallback(id);

  const [action, arg] = data.split(':');
  if (!action) return await answerCallback(id);
  const actor = await getAdminByTelegramId(userId);
  if (!actor) return await answerCallback(id, 'เฉพาะผู้ดูแลระบบเท่านั้น');
  const currentActor = actor;

  // helper: check role
  async function hasRole(required: ('SuperAdmin'|'Admin'|'Operator'|'Viewer')[]) {
    try {
      const role = currentActor.role ?? 'Operator';
      return required.includes(role as any);
    } catch (e) {
      return false;
    }
  }

  // ----- quick no-arg actions -----
  if (action === 'cancelop') {
    await clearSession(chatId, userId);
    await answerCallback(id, 'ยกเลิกแล้ว');
    await sendMessage(chatId, UI.cancelled());
    return;
  }

  // ----- Quick Actions (qa:*) — edit the same message in place -----
  if (action === 'qa') {
    const msgId: number | undefined = cb.message?.message_id;
    if (arg === 'today') {
      await answerCallback(id, '📊 ยอดวันนี้');
      const room = await getRoom(chatId);
      const [led, staff, recent] = await Promise.all([
        getTodayLedger(room.dayCutAt, chatId),
        getStaffLeaderboard(room.dayCutAt, chatId),
        getRecentPairs(chatId, room.dayCutAt, 5),
      ]);
      const view = UI.ledgerCard({
        incomingList: led.incomingList,
        outgoingList: led.outgoingList,
        totalThb: led.totalThb,
        totalIncomingUsdt: led.totalIncomingUsdt,
        totalOutgoingUsdt: led.totalOutgoingUsdt,
        fixedRate: room.rate,
        feePercent: 0,
        netProfitThb: led.netProfitThb,
        lastAdminName: led.lastAdminName,
        roomName: room.name,
        staff,
        recent,
      });
      if (msgId) await editMessage(chatId, msgId, view);
      else await sendMessage(chatId, view);
      return;
    }
    if (arg === 'rate') {
      await answerCallback(id, '📈 Rate');
      const r = await getLatestRates();
      const view = UI.rateShow(r.sellRate, r.marketUsdtRate, r.marketSource);
      if (msgId) await editMessage(chatId, msgId, view);
      else await sendMessage(chatId, view);
      return;
    }
    if (arg === 'receiver') {
      await answerCallback(id, '👤 ผู้รับ');
      try {
        const slips = await getRecentSlips(chatId, 5);
        const view = UI.recentSlipsList(slips);
        if (msgId) await editMessage(chatId, msgId, view);
        else await sendMessage(chatId, view);
      } catch (e: any) {
        await sendMessage(chatId, UI.error(e?.message ?? 'ไม่สามารถดึงรายการล่าสุดได้'));
      }
      return;
    }
    if (arg === 'export') {
      await answerCallback(id, '📄 กำลังสร้างไฟล์...');
      const room = await getRoom(chatId);
      const { csv, rows } = await exportRoomCsv(chatId, room.dayCutAt);
      if (rows === 0) {
        await sendMessage(chatId, UI.emptyState('ส่งออกรายการ', 'Export Transactions', 'ยังไม่มีธุรกรรมให้ส่งออก'));
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `ce-vault-${room.name || chatId}-${stamp}.csv`;
      await sendDocument(chatId, filename, csv, `📄 <b>${rows} รายการ</b> · ${room.name || 'ห้องนี้'} (วันนี้)`);
      return;
    }
    return await answerCallback(id);
  }

  if (action === 'refresh') {
    // Refresh live daily summary or a live message — permission: Viewer+
    await answerCallback(id, '🔄 Refreshing...');
    // If button is bound to a tx id, refresh that tx's live message
    if (arg) {
      const txId = arg;
      const { data: tx } = await supabaseAdmin.from('transactions').select('id, live_message_id, live_chat_id').eq('id', txId).maybeSingle();
      if (tx?.live_message_id && tx.live_chat_id) {
        // re-render liveCompleted minimal placeholder to force-update
        await LiveMessageService.update(txId, tx.live_chat_id, tx.live_message_id, 'Refresh', { text: UI.liveRefreshPlaceholder(txId).text });
      }
    } else {
      // fallback: send ledger
      await sendLedger(chatId);
    }
    return;
  }

  // ----- newday / menu_today / reset actions (permission Admin+ required) -----
  if (action === 'newday') {
    if (!await hasRole(['SuperAdmin','Admin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id, '🔄 เริ่มวันใหม่');
    await doNewDay(chatId);
    return;
  }
  if (action === 'menu_today') {
    await answerCallback(id);
    await sendLedger(chatId);
    return;
  }

  if (action === 'resetask') {
    if (!await hasRole(['SuperAdmin','Admin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id);
    const room = await getRoom(chatId);
    await sendMessage(chatId, UI.resetAsk(room.name));
    return;
  }
  if (action === 'resetgo') {
    if (!await hasRole(['SuperAdmin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id, '🗓 กำลังเริ่มรอบใหม่...');
    try {
      await sendMessage(chatId, UI.sectionIntro('สรุปก่อนเริ่มรอบใหม่', 'Cycle Closing Summary'));
      await sendLedger(chatId);
      const n = await resetRoom(chatId);
      await startNewDay(chatId);
      await sendMessage(chatId, UI.resetDone(n));
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'reset failed'));
    }
    return;
  }

  // ----- slip:confirm / slip:edit / slip:cancel — Vision Verification flow -----
  if (action === 'slip') {
    const session = await getSession(chatId, userId);
    if (!session) return await answerCallback(id, 'ไม่พบการทำงาน — ส่งสลิปใหม่');

    const msgId: number | undefined = cb.message?.message_id;

    if (arg === 'confirm') {
      await answerCallback(id, '✅ กำลังบันทึก...');
      try {
        const amount = session.ocr_thb ?? null;
        if (!amount || amount <= 0) {
          const msg = UI.error('ยอดเงินไม่ชัดเจน — ส่งสลิปใหม่');
          if (msgId) await editMessage(chatId, msgId, msg);
          else await sendMessage(chatId, msg);
          await clearSession(chatId, userId);
          return;
        }

        const pinned = await listPinnedBanks(chatId);
        const bank = matchPinnedBank(session.slip_bank, session.slip_last4, pinned);
        if (!bank) {
          const msg = UI.accountMismatch('บัญชีไม่ตรงกับปักหมุด');
          if (msgId) await editMessage(chatId, msgId, msg);
          else await sendMessage(chatId, msg);
          return;
        }

        const r = await getLatestRates();
        const roomRate = (await getChatRate(chatId)) ?? r.sellRate;

        const res = await recordIncoming({
          adminTelegramId: userId,
          chatId,
          thb: amount,
          sellRate: roomRate,
          marketRate: r.marketUsdtRate,
          roomName: (await getRoom(chatId)).name,
          ledgerRef: session.ledger_ref!,
          ocrConfidence: session.ocr_conf,
          slipImageUrl: session.slip_url,
          slipFingerprint: session.slip_fingerprint,
          bankAccountId: bank.id,
          receiver: session.slip_receiver_name
            ? { name: session.slip_receiver_name, bank: session.slip_bank, last4: session.slip_last4 }
            : null,
        });

        // Show summary banner
        const dayTotals = await getTodayBankAccountTotals(bank.id);
        const summaryMsg = UI.summaryBannerToday({
          bank: bank.bank_name,
          last4: accountLast4(bank.account_number) ?? '????',
          receiverCount: dayTotals.count,
          totalThb: dayTotals.totalThb,
          totalUsdt: dayTotals.totalUsdt,
        });

        if (msgId) await editMessage(chatId, msgId, summaryMsg);
        else await sendMessage(chatId, summaryMsg);
        await clearSession(chatId, userId);
        sticker(chatId, 'SUCCESS');
      } catch (e: any) {
        const detail = e instanceof DuplicateSlipError
          ? 'สลิปนี้ถูกบันทึกแล้ว' : e?.message ??'บันทึกไม่สำเร็จ';
        const msg = UI.error(detail);
        if (msgId) await editMessage(chatId, msgId, msg);
        else await sendMessage(chatId, msg);
        await clearSession(chatId, userId);
      }
      return;
    }

    if (arg === 'edit') {
      await answerCallback(id, '✏️ แก้ไข');
      await sendMessage(chatId, UI.error('ใช้ /save_slip +500B KBANK 7890 เพื่อแก้ไข'));
      return;
    }

    if (arg === 'cancel') {
      await answerCallback(id, '❌ ยกเลิก');
      await clearSession(chatId, userId);
      const msg = UI.cancelled();
      if (msgId) await editMessage(chatId, msgId, msg);
      else await sendMessage(chatId, msg);
      return;
    }

    return await answerCallback(id);
  }

  // Pending-deal callbacks do not target a transaction yet; validate against the actor's session.
  if (action === 'confirm' || action === 'dealok') {
    return await answerCallback(id, 'ปุ่มเวอร์ชันเก่าหมดอายุ — ส่งสลิปใหม่แล้วใช้ /save_slip');
  }

  if (action === 'dealedit') {
    return await answerCallback(id, 'ปุ่มเวอร์ชันเก่าหมดอายุ — ส่งสลิปใหม่');
  }

  // ----- actions that target a transaction id -----
  if (!arg) return await answerCallback(id);
  const txId = arg;

  // load transaction and verify minimal permissions
  const { data: tx } = await supabaseAdmin
    .from('transactions')
    .select('id, type, admin_id, live_message_id, live_chat_id')
    .eq('id', txId)
    .maybeSingle();

  if (!tx) return await answerCallback(id, 'รายการไม่พบ');

  // permission: owner or higher roles for edit/delete
  const isOwner = Boolean(actor && tx && actor.id === tx.admin_id);

  // ----- edit : allow owner or Admin to modify a committed transaction -----
  if (action === 'edit') {
    if (!isOwner && !await hasRole(['SuperAdmin','Admin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id, '✏️ แก้ USDT');
    await setSession(chatId, userId, {
      state: 'EDITING', caption: txId,
    });
    await sendMessage(chatId, UI.editPrompt());
    sticker(chatId, 'WAITING');
    return;
  }

  // ----- delete / del : allow owner or Admin (or SuperAdmin) -----
  if (action === 'delete' || action === 'del') {
    if (!isOwner && !await hasRole(['SuperAdmin','Admin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id, '🗑 กำลังลบ...');
    try {
      const r = await deleteTransaction(txId);
      await sendMessage(chatId, UI.deleteSuccess(r.name, r.holdingUsdt));
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'delete failed'));
    }
    return;
  }

  // ----- retry_ocr : re-run OCR for a pending slip (owner/Admin) -----
  if (action === 'retry_ocr') {
    if (!isOwner && !await hasRole(['SuperAdmin','Admin'])) return await answerCallback(id, 'สิทธิ์ไม่พอ');
    await answerCallback(id, '🔁 Re-running OCR...');
    const session = await getSession(chatId, userId);
    if (!session || !session.slip_url) return await answerCallback(id, 'ไม่พบสลิปที่ต้องการอ่านใหม่');
    try {
      let slip = await analyzeSlip(session.slip_url);
      // Update live message if exists
      const liveId = tx.live_message_id ?? session.live_message_id;
      if (liveId) {
        await LiveMessageService.update(txId, chatId, liveId, 'OCR', UI.liveOcrUpdate({
          ledgerRef: session.ledger_ref || '—',
          thb: slip.thbAmount ?? session.ocr_thb ?? 0,
          receiver: session.slip_receiver_name ?? undefined,
          bank: slip.bank ?? session.slip_bank ?? null,
          confidence: slip.confidence ?? null,
          sellRate: (await getRoom(chatId)).rate ?? (await getLatestRates()).sellRate,
          marketRate: null,
          shouldSend: Number(slip.thbAmount ? (slip.thbAmount / ((await getRoom(chatId)).rate || 1)) : 0),
        }));
      }
      await sendMessage(chatId, UI.info('OCR retried'));
    } catch (e: any) {
      await sendMessage(chatId, UI.error(e?.message ?? 'OCR failed'));
    }
    return;
  }

  // Unknown action — default reply
  await answerCallback(id);
}
