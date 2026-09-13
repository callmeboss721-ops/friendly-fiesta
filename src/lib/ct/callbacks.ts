import { answerCallback, editMessage, sendMessage, sendPhoto, editPhoto, deleteMessage } from '../telegram';
import { parseAmounts } from '../amounts';
import { parseDeskPin, parseDeskRate, hasRatePrefix, isBareDeskRate, parseTelegramId } from '../../bot/parse';
import { listPinnedBanks, accountLast4, pinBankAccount, unpinBankAccount, matchSlipPins, parsePinLabel } from '../banks';
import {
  recordOutgoing,
  deleteTransaction,
  listAdmins,
  upsertAdmin,
} from '../transactions';
import {
  getSession,
  setSession,
  clearSession,
  ensureRoom,
  getRoom,
  listRooms,
  resolveOpsRoom,
  setOpsRoom,
} from '../botSessions';
import { findSlip, patchSlip, markSettledIfLocked, type PendingSlip } from './store';
import { renderVault, renderRecent } from './vault';
import { opsRates, applyDeskRate } from './rates';
import { commitIncomingLock, dueSummary, settleAllDue } from './queue';
import { outgoingLedgerRef, settleBlockReason, SKIP_TH } from './settleGuard';
import { clockBkk, displayLedger, adminKeyboard, thbCard, usdt } from './format';
import { VaultEngine } from './vaultEngine';
import { heroPng } from './brandCards';
import { gateOcr } from './gate';
import { renderGateCard } from './photo';
import * as C from './copy';
import { mapSettlementAction, claimSettlementConfirm } from './settlementRich';
import { parseWebAppPayload } from './webAppInit';
import type { Admin } from '@/types/transactions';
import { saveTyphoonSetting } from '../systemSettings';
import { readPayoutWallet } from './payoutWallet';

export function parseCb(data: string): {
  domain: string;
  action: string;
  ref: string;
  extra: string;
} {
  const parts = (data || '').split(':');
  return {
    domain: parts[0] || '',
    action: parts[1] || '',
    ref: (parts[2] || '').toUpperCase(),
    extra: parts.slice(3).join(':'),
  };
}

export function isCtCallback(data: string): boolean {
  const d = (data || '').split(':')[0];
  return d === 'vault' || d === 'slip' || d === 'pin' || d === 'admin' || d === 'room';
}

export const SLIP_ACTIONS = new Set([
  'lock', 'queue', 'force', 'forceask', 'settle', 'undo', 'delask', 'delete',
  'open', 'copy', 'hold', 'cancel', 'retry', 'edit', 'note', 'amt', 'unit',
  'pinthis', 'pinslot',
]);

export const VAULT_ACTIONS = new Set(['today', 'pending', 'rateask', 'newday', 'recent', 'all', 'set', 'batch']);
export const PIN_ACTIONS = new Set(['view', 'unpin']);
export const ADMIN_ACTIONS = new Set(['add']);
export const ROOM_ACTIONS = new Set(['list', 'here', 'use']);

export type ReplyCmd = 'vault' | 'pending' | 'menu' | 'newday' | 'pin' | 'rate' | 'recent' | 'settings' | 'addadmin' | 'rooms';

export function matchReplyCommand(text: string): ReplyCmd | null {
  const t = (text || '').trim();
  const low = t.toLowerCase();
  if (
    t === 'ยอดวันนี้' || t === 'VAULT' || t === 'VAULT วันนี้' || t === '/vault' || t === '/today' ||
    t === 'สรุปวันนี้'
  ) return 'vault';
  if (t === 'รอส่ง' || t === '/pending') return 'pending';
  if (t === 'ตั้งค่า' || t === '/settings') return 'settings';
  if (t === '/admin' || t === '+แอด' || t === 'เพิ่มผู้ดูแล') return 'addadmin';
  if (t === 'เมนู' || t === '/menu' || t === '/help' || low === 'menu') return 'settings';
  if (t === 'วันใหม่' || t === '/newday') return 'newday';
  if (t === 'pin' || t === 'หมุด' || t === 'บัญชีรับ' || t === '/pin') return 'pin';
  if (t === 'เลือกห้อง' || t === '/rooms' || t === '/room' || low === 'rooms' ||
      /^(?:\/rooms?(?:@[a-z0-9_]+)?)$/i.test(t)) return 'rooms';
  if (t === '/recent' || t === '/recent_slips') return 'recent';
  if (
    t === 'อัตรา' || t === 'เราขาย' ||
    /^(?:\/setrate(?:@[a-z0-9_]+)?|\/rate(?:@[a-z0-9_]+)?|setrate|เรทตอนนี้|เรทวันนี้|อัตราแลกเปลี่ยน)\s*$/i.test(t)
  ) {
    return 'rate';
  }
  return null;
}

function pinCard(pinned: Awaited<ReturnType<typeof listPinnedBanks>>) {
  return C.pinView(pinned.map((b) => {
    const meta = parsePinLabel(b.label);
    return {
      bank: b.bank_name,
      last4: accountLast4(b.account_number) ?? '????',
      account: b.account_number,
      name: meta.name || b.label,
      limit: meta.limit,
    };
  }));
}

function isLead(admin: Admin): boolean {
  return admin.role === 'SuperAdmin' || admin.role === 'Admin';
}

function canUndo(p: PendingSlip): boolean {
  if (!p.undo_until) return false;
  return Date.now() < new Date(p.undo_until).getTime();
}

async function renderSettings(chatId: number) {
  const [rates, pinned, admins, room] = await Promise.all([
    opsRates(chatId),
    listPinnedBanks(chatId),
    listAdmins().catch(() => [] as Admin[]),
    getRoom(chatId),
  ]);
  return C.settingsCard({
    desk: rates.desk || null,
    mkt: rates.mkt,
    pins: pinned.map((b) => ({
      bank: b.bank_name,
      last4: accountLast4(b.account_number) ?? '????',
      account: b.account_number,
    })),
    admins: admins.map((a) => ({ name: a.name, role: a.role || 'admin' })),
    roomName: room.name,
  });
}

async function renderRoomPicker(chatId: number, userId: number) {
  await ensureRoom(chatId);
  const [rooms, active] = await Promise.all([
    listRooms(),
    resolveOpsRoom(userId, chatId),
  ]);
  const current = rooms.find((r) => r.chatId === active) || rooms.find((r) => r.chatId === chatId);
  return C.roomPicker({
    currentName: current?.name || `ห้อง ${String(Math.abs(active)).slice(-4)}`,
    currentId: active,
    rooms: rooms.map((r) => ({ ...r, current: r.chatId === active })),
  });
}

async function activateRoom(userId: number, targetChatId: number, name?: string | null) {
  await ensureRoom(targetChatId, name);
  await setOpsRoom(userId, targetChatId);
  const room = await getRoom(targetChatId);
  return room.name || name || `ห้อง ${String(Math.abs(targetChatId)).slice(-4)}`;
}

async function armRatePrompt(chatId: number, userId: number) {
  try {
    await setSession(chatId, userId, { state: 'AWAITING_RATE' });
  } catch { /* session table optional */ }
}

async function armAdminPrompt(chatId: number, userId: number) {
  try {
    await setSession(chatId, userId, { state: 'AWAITING_ADMIN' });
  } catch { /* session table optional */ }
}

async function addAdminById(chatId: number, tgId: number) {
  const row = await upsertAdmin(tgId, `Admin ${tgId}`);
  await sendMessage(chatId, C.adminAdded(tgId, row.name));
  await sendMessage(chatId, await renderSettings(chatId));
}

async function load(chatId: number, ref: string, cbId: string, roomId?: number): Promise<PendingSlip | null> {
  const p = await findSlip(roomId ?? chatId, ref)
    || (roomId && roomId !== chatId ? await findSlip(chatId, ref) : null);
  if (!p) {
    await answerCallback(cbId, 'ปุ่มนี้หมดอายุแล้วครับ');
    return null;
  }
  return p;
}

async function redraw(chatId: number, messageId: number | undefined, card: { text: string; reply_markup?: unknown }) {
  if (messageId) await editMessage(chatId, messageId, card);
  else await sendMessage(chatId, card);
}

async function sendHero(
  chatId: number,
  messageId: number | undefined,
  kind: 'vault' | 'locked' | 'settled',
  card: { text: string; reply_markup?: unknown },
  hero: string,
  sub?: string,
  meta?: string,
): Promise<number> {
  const png = heroPng(kind, { hero, sub, meta });
  if (messageId) {
    const ok = await editPhoto(chatId, messageId, png, card);
    if (ok) return messageId;
  }
  const id = await sendPhoto(chatId, png, card);
  if (messageId) await deleteMessage(chatId, messageId);
  return id;
}

export async function handleWebAppData(opts: {
  chatId: number;
  userId: number;
  admin: Admin;
  data: string;
}): Promise<boolean> {
  const payload = parseWebAppPayload(opts.data);
  if (!payload) return false;
  const action = mapSettlementAction(payload.action);
  if (!action) return false;
  await handleCtCallback({
    id: 'webapp',
    chatId: opts.chatId,
    userId: opts.userId,
    admin: opts.admin,
    data: action,
  });
  return true;
}

export async function handleCtCallback(opts: {
  id: string;
  chatId: number;
  userId: number;
  admin: Admin;
  data: string;
  messageId?: number;
}): Promise<void> {
  const { id, chatId, userId, admin, data, messageId } = opts;
  const cb = parseCb(data);
  const roomId = await resolveOpsRoom(userId, chatId);

  if (cb.domain === 'room') {
    if (cb.action === 'list') {
      await answerCallback(id, 'เลือกห้อง');
      await redraw(chatId, messageId, await renderRoomPicker(chatId, userId));
      return;
    }
    if (cb.action === 'here') {
      const name = await activateRoom(userId, chatId);
      await answerCallback(id, `ใช้ ${name}`);
      await sendMessage(chatId, {
        text: `ใช้ห้อง <b>${name}</b> แล้ว (active room)\nเขียว = ใช้ต่อ · น้ำเงิน = สลับห้อง`,
        reply_markup: adminKeyboard(),
      });
      await redraw(chatId, messageId, await renderRoomPicker(chatId, userId));
      return;
    }
    if (cb.action === 'use') {
      const target = Number(data.split(':').slice(2).join(':'));
      if (!Number.isFinite(target) || target === 0) {
        await answerCallback(id, 'ห้องไม่ถูกต้อง');
        return;
      }
      const name = await activateRoom(userId, target);
      await answerCallback(id, `ใช้ ${name}`);
      const view = await renderVault(target, 'today');
      await sendHero(chatId, messageId, 'vault', view, name, 'ROOM', 'CE');
      return;
    }
    await answerCallback(id, 'ปุ่มนี้หมดอายุแล้วครับ');
    return;
  }

  if (cb.domain === 'vault') {
    if (cb.action === 'batch') {
      if (!claimSettlementConfirm(`tg:${roomId}:${userId}`)) {
        await answerCallback(id, 'กำลังบันทึกอยู่');
        return;
      }
      const due = await dueSummary(roomId);
      if (!due.count) {
        await answerCallback(id, 'ยังไม่มีคิวรอส่ง');
        return;
      }
      const done = await settleAllDue(roomId, userId);
      const skipBit = done.skipped.length
        ? ` · ข้าม ${done.skipped.map((s) => `${s.short} ${SKIP_TH[s.reason] ?? s.reason}`).join(' · ')}`
        : '';
      if (!done.count) {
        await answerCallback(id, done.skipped.length ? `ยังไม่ได้โอน${skipBit}` : 'ยังไม่มีคิวรอส่ง');
        return;
      }
      await answerCallback(id, `โอนรวม ${done.count} ใบ${skipBit}`);
      const payout = await readPayoutWallet(roomId);
      const card = C.cardSettledBatch({
        count: done.count,
        thb: done.thb,
        usdt: done.usdt,
        adminName: admin.name,
        payout,
      });
      await sendHero(chatId, messageId, 'settled', card, `${usdt(done.usdt)} USDT`, `${done.count} TX`, 'CE');
      return;
    }
    if (cb.action === 'rateask') {
      const rates = await opsRates(roomId);
      await armRatePrompt(chatId, userId);
      await answerCallback(id, 'อัตรา');
      await sendMessage(chatId, C.askDeskRate(rates.desk || null));
      return;
    }
    if (cb.action === 'set') {
      await answerCallback(id, 'ตั้ง');
      await redraw(chatId, messageId, await renderSettings(roomId));
      return;
    }
    if (cb.action === 'newday') {
      const { startNewDay } = await import('../botSessions');
      await startNewDay(roomId);
      await answerCallback(id, 'วันใหม่');
      const view = await renderVault(roomId, 'today');
      await sendHero(chatId, messageId, 'vault', view, 'VAULT', 'NEW DAY', '◈');
      return;
    }
    const mode = cb.action === 'pending' ? 'pending' : cb.action === 'all' ? 'all' : 'today';
    await answerCallback(id, mode === 'pending' ? 'รอส่ง' : 'สรุปยอด');
    const view = cb.action === 'recent'
      ? await renderRecent(roomId, admin.name)
      : await renderVault(roomId, mode);
    await sendHero(chatId, messageId, 'vault', view, mode === 'pending' ? 'WAIT' : 'VAULT', 'CE VAULT', '◈');
    return;
  }

  if (cb.domain === 'pin' && cb.action === 'view') {
    await answerCallback(id, 'บัญชีรับ');
    const pinned = await listPinnedBanks(roomId);
    await redraw(chatId, messageId, pinCard(pinned));
    return;
  }

  if (cb.domain === 'pin' && cb.action === 'unpin') {
    const slot = cb.ref || cb.extra;
    await unpinBankAccount(roomId, slot);
    await answerCallback(id, 'ยกเลิกบัญชีแล้ว');
    const pinned = await listPinnedBanks(roomId);
    await redraw(chatId, messageId, pinCard(pinned));
    return;
  }

  if (cb.domain === 'admin' && cb.action === 'add') {
    if (!isLead(admin)) {
      await answerCallback(id, 'ใช้ได้เฉพาะหัวหน้าห้องครับ');
      return;
    }
    await armAdminPrompt(chatId, userId);
    await answerCallback(id, 'กรุณาส่งไอดี');
    await sendMessage(chatId, C.askAdminId());
    return;
  }

  if (cb.domain === 'slip' && cb.action === 'unithelp') {
    await answerCallback(id);
    await sendMessage(chatId, C.unitHelp());
    return;
  }

  if (cb.domain === 'slip' && cb.action === 'recent') {
    await answerCallback(id, 'TODAY');
    await redraw(chatId, messageId, await renderRecent(roomId, admin.name));
    return;
  }

  if (cb.domain !== 'slip') {
    await answerCallback(id, 'ปุ่มนี้หมดอายุแล้วครับ');
    return;
  }

  const p = await load(chatId, cb.ref, id, roomId);
  if (!p) {
    if (messageId) await editMessage(chatId, messageId, C.expiredToastCard());
    return;
  }

  switch (cb.action) {
    case 'lock':
      await doLock(id, chatId, userId, admin, p, messageId, false, false);
      return;
    case 'queue':
      await doLock(id, chatId, userId, admin, p, messageId, false, true);
      return;
    case 'force':
      if (!isLead(admin)) {
        await answerCallback(id, 'ใช้ได้เฉพาะหัวหน้าห้องครับ');
        return;
      }
      await doLock(id, chatId, userId, admin, p, messageId, true, false);
      return;
    case 'forceask':
      if (!isLead(admin)) {
        await answerCallback(id, 'ใช้ได้เฉพาะหัวหน้าห้องครับ');
        return;
      }
      await answerCallback(id);
      await redraw(chatId, messageId, C.cardForceAsk({ short: p.short_ref, ledger: p.ledger_ref }));
      return;
    case 'settle':
      await doSettle(id, chatId, userId, p, messageId);
      return;
    case 'undo':
      await doUndo(id, chatId, p, messageId);
      return;
    case 'delask':
      await answerCallback(id);
      await redraw(chatId, messageId, C.cardDeleteAsk({
        ledger: p.ledger_ref, thb: p.thb_in ?? 0, short: p.short_ref,
      }));
      return;
    case 'delete':
      await doDelete(id, chatId, p, messageId);
      return;
    case 'open':
      await answerCallback(id);
      await redraw(chatId, messageId, detailCard(p));
      return;
    case 'copy':
      await answerCallback(id, displayLedger(p.ledger_ref));
      await sendMessage(chatId, { text: `<code>${displayLedger(p.ledger_ref)}</code>` });
      return;
    case 'hold':
      await answerCallback(id, 'พักรายการแล้ว');
      await patchSlip(p.id, { status: 'HOLD' });
      await redraw(chatId, messageId, {
        text: `◈  <b>CE</b>\n<i>[ แจ้งเตือน ]  พักรายการ</i>\n<code>${displayLedger(p.ledger_ref)}</code>\nถือไว้ก่อน ยังไม่บันทึกลงสมุดครับ`,
      });
      return;
    case 'cancel':
      await answerCallback(id, 'ยกเลิกแล้ว');
      await patchSlip(p.id, { status: 'DELETED' });
      await redraw(chatId, messageId, { text: 'ยกเลิกรายการแล้ว ไม่ได้บันทึกครับ' });
      return;
    case 'retry':
      await answerCallback(id, 'กรุณาส่งสลิปใหม่');
      await patchSlip(p.id, { status: 'DELETED' });
      await redraw(chatId, messageId, { text: 'กรุณาส่งสลิปใหม่อีกครั้งครับ' });
      return;
    case 'pinthis':
      await doPinFromSlip(id, chatId, userId, admin, p, messageId, 0);
      return;
    case 'pinslot':
      await doPinFromSlip(id, chatId, userId, admin, p, messageId, Number(cb.extra) || 0);
      return;
    case 'edit':
      await answerCallback(id, 'กรุณาพิมพ์ยอด');
      await sendMessage(chatId, {
        text: `กรุณาแก้ยอดของ <code>${p.short_ref}</code>\nพิมพ์เช่น <code>เข้า 500</code>`,
      });
      return;
    case 'note':
      await answerCallback(id, 'กรุณาพิมพ์หมายเหตุ');
      await sendMessage(chatId, { text: `หมายเหตุสำหรับ <code>${p.short_ref}</code>\nกรุณาพิมพ์ต่อข้อความนี้ครับ` });
      return;
    case 'amt': {
      const parsed = parseAmounts(cb.extra.startsWith('+') || cb.extra.startsWith('-') ? cb.extra : `+${cb.extra}`);
      const thb = parsed.thb?.value;
      if (!thb) {
        await answerCallback(id, 'ยอดไม่ถูกต้องครับ');
        return;
      }
      await answerCallback(id, `บันทึกเรียบร้อย · ${p.short_ref}`);
      const desk = p.desk_rate || (await opsRates(chatId)).desk;
      const owed = VaultEngine.verifyReceive({ thb, rate: desk, confidence: null, pinMatch: true }).expectedUsdt;
      const next = await patchSlip(p.id, {
        thb_in: thb,
        should_send: owed,
        desk_rate: desk,
        status: 'IN_READY',
      });
      await redraw(chatId, messageId, C.cardInReady({
        review: false,
        thb,
        shouldSend: owed,
        desk,
        mkt: next.mkt_rate,
        bank: next.bank ?? '—',
        last4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
        receiverAccount: next.account_masked,
        name: next.name,
        confidence: next.ocr_confidence ?? 95,
        ledger: next.ledger_ref,
        adminName: next.admin_name ?? admin.name,
        short: next.short_ref,
      }));
      return;
    }
    case 'unit':
      await answerCallback(id, cb.extra === '-U' ? 'กรุณาพิมพ์ยอด USDT' : 'กรุณาพิมพ์ยอดบาท');
      await sendMessage(chatId, {
        text: cb.extra === '-U' ? 'กรุณาพิมพ์ยอด เช่น <code>-13.6U</code>' : 'กรุณาพิมพ์ยอด เช่น <code>+500</code>',
      });
      return;
    default:
      await answerCallback(id, 'ปุ่มนี้หมดอายุแล้วครับ');
      if (messageId) await editMessage(chatId, messageId, C.expiredToastCard());
  }
}

function detailCard(p: PendingSlip) {
  return C.cardDetail({
    ledger: p.ledger_ref,
    thb: p.thb_in ?? 0,
    usdtOut: p.status === 'SETTLED' ? p.should_send : null,
    desk: p.desk_rate ?? 0,
    mkt: p.mkt_rate,
    usd: p.bot_usd,
    bank: p.bank ?? '—',
    last4: (p.account_masked ?? '').replace(/\D/g, '').slice(-4),
    account: p.account_masked,
    name: p.name,
    pinMatch: p.pin_match,
    confidence: p.ocr_confidence,
    adminIn: p.admin_name ?? 'Admin',
    inTime: clockBkk(p.undo_until ? new Date(new Date(p.undo_until).getTime() - 30_000) : new Date()),
    outTime: p.status === 'SETTLED' ? clockBkk() : null,
    adminOut: p.status === 'SETTLED' ? p.admin_name : null,
    note: p.note,
    short: p.short_ref,
  });
}

async function doLock(
  cbId: string,
  chatId: number,
  userId: number,
  admin: Admin,
  p: PendingSlip,
  messageId: number | undefined,
  force: boolean,
  queued: boolean,
) {
  if (p.status === 'LOCKED' || p.status === 'SETTLED') {
    await answerCallback(cbId, `บันทึกเรียบร้อย · ${p.short_ref}`);
    return;
  }
  try {
    const next = await commitIncomingLock(p, { chatId: p.chat_id, userId, admin, force, queued });
    const batch = await dueSummary(p.chat_id);
    await answerCallback(cbId, queued ? `เก็บไว้แล้ว · ${p.short_ref}` : `บันทึกเรียบร้อย · ${p.short_ref}`);
    const card = C.cardLocked({
      thb: next.thb_in ?? 0,
      shouldSend: next.should_send ?? 0,
      desk: next.desk_rate ?? 0,
      mkt: next.mkt_rate,
      ledger: next.ledger_ref,
      adminName: admin.name,
      time: clockBkk(),
      short: next.short_ref,
      canUndo: true,
      queued,
      batch,
      bank: next.bank ?? undefined,
      last4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
      account: next.account_masked,
      name: next.name,
    });
    const photoId = await sendHero(
      chatId,
      messageId,
      'locked',
      card,
      `${thbCard(next.thb_in ?? 0)} THB`,
      queued ? `KEEP ${usdt(next.should_send ?? 0)} USDT` : `DUE ${usdt(next.should_send ?? 0)} USDT`,
      next.ledger_ref,
    );
    await patchSlip(p.id, { message_id: photoId });
  } catch (e: any) {
    const msg = e?.message === 'PIN_MISMATCH'
      ? 'บัญชีไม่ตรงกับบัญชีรับเงินวันนี้ครับ'
      : e?.message === 'NO_AMOUNT'
        ? 'ยังไม่พบยอดเงินครับ'
        : e?.message === 'HIGH_VALUE'
          ? 'ยอดสูง ต้องยืนยันก่อนครับ'
          : e?.message === 'AMOUNT_TOO_LARGE'
            ? 'ยอดเกินเพดาน ไม่บันทึกครับ'
            : 'บันทึกไม่สำเร็จครับ';
    await answerCallback(cbId, msg);
  }
}

async function doSettle(
  cbId: string,
  chatId: number,
  userId: number,
  p: PendingSlip,
  messageId: number | undefined,
) {
  if (p.status === 'SETTLED') {
    await answerCallback(cbId, `โอนครบแล้ว · ${p.short_ref}`);
    return;
  }
  const pins = await listPinnedBanks(p.chat_id);
  const block = settleBlockReason(p, pins);
  if (block) {
    await answerCallback(cbId, `${SKIP_TH[block]} · ${p.short_ref}`);
    return;
  }
  try {
    await recordOutgoing({
      adminTelegramId: userId,
      chatId: p.chat_id,
      usdt: p.should_send as number,
      ledgerRef: outgoingLedgerRef(p.ledger_ref),
      slipImageUrl: p.slip_url,
    });
  } catch (e: any) {
    const dup = /duplicate key|unique constraint|23505/i.test(String(e?.message ?? e));
    if (!dup) {
      await answerCallback(cbId, `บันทึกส่งไม่สำเร็จ · ${p.short_ref}`);
      return;
    }
  }
  await markSettledIfLocked(p.id, `S-${p.short_ref}`);
  await answerCallback(cbId, `โอนครบแล้ว · ${p.short_ref}`);
  const card = C.cardSettled({
    thb: p.thb_in ?? 0,
    usdtOut: p.should_send ?? 0,
    desk: p.desk_rate ?? 0,
    ledger: p.ledger_ref,
    adminName: p.admin_name ?? 'Admin',
    inTime: clockBkk(),
    outTime: clockBkk(),
    short: p.short_ref,
  });
  await sendHero(
    chatId,
    messageId,
    'settled',
    card,
    `${usdt(p.should_send ?? 0)} USDT`,
    `IN ${thbCard(p.thb_in ?? 0)} THB`,
    p.ledger_ref,
  );
}

async function doUndo(
  cbId: string,
  chatId: number,
  p: PendingSlip,
  messageId: number | undefined,
) {
  if (!canUndo(p) || !p.tx_id) {
    await answerCallback(cbId, 'หมดเวลาแก้ไขแล้วครับ');
    await redraw(chatId, messageId, C.cardLocked({
      thb: p.thb_in ?? 0,
      shouldSend: p.should_send ?? 0,
      desk: p.desk_rate ?? 0,
      ledger: p.ledger_ref,
      adminName: p.admin_name ?? 'Admin',
      time: clockBkk(),
      short: p.short_ref,
      canUndo: false,
      queued: p.note === 'QUEUE',
    }));
    return;
  }
  await deleteTransaction(p.tx_id);
  const next = await patchSlip(p.id, { status: 'IN_READY', tx_id: null, undo_until: null });
  await answerCallback(cbId, 'ยกเลิกการบันทึกแล้วครับ');
  const gate = gateOcr({
    thb: next.thb_in,
    confidence: next.ocr_confidence,
    pinMatch: next.pin_match,
    hasCurrency: next.thb_in != null,
  });
  await redraw(chatId, messageId, renderGateCard(next, {
    gate,
    slipBank: next.bank ?? '—',
    slipLast4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
    pinBank: next.bank ?? '—',
    pinLast4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
    pinAccount: next.account_masked,
    lead: false,
    chips: next.thb_in ? [next.thb_in] : [500],
  }));
}

async function doDelete(
  cbId: string,
  chatId: number,
  p: PendingSlip,
  messageId: number | undefined,
) {
  if (p.tx_id) await deleteTransaction(p.tx_id);
  await patchSlip(p.id, { status: 'DELETED', tx_id: null });
  await answerCallback(cbId, `ลบรายการแล้ว · ${p.short_ref}`);
  await redraw(chatId, messageId, { text: `ลบ <code>${displayLedger(p.ledger_ref)}</code> แล้ว` });
}

async function doPinFromSlip(
  cbId: string,
  chatId: number,
  userId: number,
  admin: Admin,
  p: PendingSlip,
  messageId: number | undefined,
  slot: number,
) {
  const acct = (p.note?.match(/ACCT:([0-9]{4,20})/) || [])[1]
    || String(p.account_masked || '').replace(/\D/g, '');
  const bank = (p.note?.match(/BANK:([A-Z0-9]+)/) || [])[1] || p.bank;
  if (!bank || acct.length < 4) {
    await answerCallback(cbId, 'อ่านเลขบัญชีจากสลิปไม่ครบ');
    return;
  }
  if (slot >= 1) {
    await unpinBankAccount(p.chat_id, String(slot));
  }
  try {
    const result = await pinBankAccount(p.chat_id, bank, acct, p.name);
    const matched = matchSlipPins(bank, acct.slice(-4), null, result.pinned);
    await answerCallback(cbId, matched ? `ปักหมุดแล้ว · ${p.short_ref}` : 'ปักแล้ว ยังไม่ตรง');
    const next = await patchSlip(p.id, {
      pin_match: Boolean(matched),
      bank: matched?.bank_name ?? bank,
      bank_account_id: matched?.id ?? result.bank.id,
      account_masked: acct,
      status: matched && p.thb_in ? 'IN_READY' : p.status,
    });
    if (matched && next.thb_in) {
      const owed = VaultEngine.verifyReceive({ thb: next.thb_in, rate: next.desk_rate || 0, confidence: next.ocr_confidence, pinMatch: next.pin_match }).expectedUsdt;
      await redraw(chatId, messageId, C.cardInReady({
        review: false,
        thb: next.thb_in,
        shouldSend: owed,
        desk: next.desk_rate ?? 0,
        mkt: next.mkt_rate,
        bank: next.bank ?? bank,
        last4: acct.slice(-4),
        name: next.name,
        confidence: next.ocr_confidence ?? 90,
        ledger: next.ledger_ref,
        adminName: next.admin_name ?? admin.name,
        short: next.short_ref,
      }));
      return;
    }
    await redraw(chatId, messageId, pinCard(result.pinned));
  } catch (e: any) {
    const full = e?.message === 'PIN_LIMIT_REACHED';
    await answerCallback(cbId, full ? 'หมุดเต็ม — กดแทนหมุด 1/2/3' : 'ปักหมุดไม่สำเร็จ');
  }
}

export async function handleCtText(opts: {
  chatId: number;
  userId: number;
  admin: Admin;
  text: string;
}): Promise<boolean> {
  const t = opts.text.trim();
  const view = opts.chatId;
  const room = await resolveOpsRoom(opts.userId, opts.chatId);
  const typhoonCmd = t.match(/^\/typhoon(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
  if (typhoonCmd) {
    const key = (typhoonCmd[1] || '').trim();
    if (!key) {
      await sendMessage(opts.chatId, {
        text: 'วางคีย์ท้ายคำสั่ง เช่น <code>/typhoon sk-...</code>',
      });
      return true;
    }
    try {
      await saveTyphoonSetting(key);
      await sendMessage(opts.chatId, { text: 'Typhoon OCR พร้อมแล้ว (OCR ready)' });
    } catch {
      await sendMessage(opts.chatId, { text: 'คีย์ไม่ถูกต้อง' });
    }
    return true;
  }
  const cmd = matchReplyCommand(t);
  if (cmd === 'rooms') {
    await sendMessage(view, {
      ...await renderRoomPicker(view, opts.userId),
    });
    return true;
  }
  if (cmd === 'vault') {
    const vault = await renderVault(room, 'today');
    await sendHero(view, undefined, 'vault', vault, 'VAULT', 'TODAY', 'CE');
    return true;
  }
  if (cmd === 'pending') {
    const vault = await renderVault(room, 'pending');
    await sendHero(view, undefined, 'vault', vault, 'WAIT', 'DUE', 'CE');
    return true;
  }
  if (cmd === 'menu' || cmd === 'settings') {
    await sendMessage(view, await renderSettings(room));
    return true;
  }
  if (cmd === 'newday') {
    const { startNewDay } = await import('../botSessions');
    await startNewDay(room);
    const vault = await renderVault(room, 'today');
    await sendHero(view, undefined, 'vault', vault, 'VAULT', 'NEW DAY', '◈');
    return true;
  }
  if (cmd === 'pin') {
    const pasted = parseDeskPin(t);
    if (pasted) {
      try {
        const result = await pinBankAccount(room, pasted.bank, pasted.account, pasted.name, pasted.limit);
        await sendMessage(view, pinCard(result.pinned));
      } catch (e: any) {
        await sendMessage(view, { text: e?.message === 'PIN_LIMIT_REACHED' ? 'หมุดครบ 3 บัญชีแล้วครับ' : 'หมุดบัญชีไม่สำเร็จครับ' });
      }
      return true;
    }
    const pinned = await listPinnedBanks(room);
    await sendMessage(view, pinCard(pinned));
    return true;
  }

  const deskPin = parseDeskPin(t);
  if (deskPin) {
    try {
      const result = await pinBankAccount(room, deskPin.bank, deskPin.account, deskPin.name, deskPin.limit);
      await sendMessage(view, pinCard(result.pinned));
    } catch (e: any) {
      await sendMessage(view, { text: e?.message === 'PIN_LIMIT_REACHED' ? 'pin ครบ 3' : 'pin ไม่ติด' });
    }
    return true;
  }
  if (cmd === 'recent') {
    await sendMessage(view, await renderRecent(room, opts.admin.name));
    return true;
  }

  if (cmd === 'rate') {
    await armRatePrompt(view, opts.userId);
    const rates = await opsRates(room);
    await sendMessage(view, C.askDeskRate(rates.desk || null));
    return true;
  }

  if (cmd === 'addadmin') {
    if (!isLead(opts.admin)) {
      await sendMessage(opts.chatId, { text: 'ใช้ได้เฉพาะหัวหน้าห้องครับ' });
      return true;
    }
    await armAdminPrompt(opts.chatId, opts.userId);
    await sendMessage(opts.chatId, C.askAdminId());
    return true;
  }

  const tgId = parseTelegramId(t);
  if (tgId != null) {
    let allowed = /^\/admin/i.test(t);
    if (!allowed) {
      try {
        const session = await getSession(opts.chatId, opts.userId);
        allowed = session?.state === 'AWAITING_ADMIN';
      } catch {
        allowed = false;
      }
    }
    if (!allowed) return false;
    if (!isLead(opts.admin)) {
      await sendMessage(opts.chatId, { text: 'ใช้ได้เฉพาะหัวหน้าห้องครับ' });
      return true;
    }
    try { await clearSession(opts.chatId, opts.userId); } catch { /* ignore */ }
    await addAdminById(opts.chatId, tgId);
    return true;
  }

  const deskRate = parseDeskRate(t);
  if (deskRate != null) {
    let allowed = hasRatePrefix(t);
    if (!allowed && isBareDeskRate(t)) {
      try {
        const session = await getSession(opts.chatId, opts.userId);
        allowed = session?.state === 'AWAITING_RATE';
      } catch {
        allowed = false;
      }
    }
    if (!allowed) return false;
    try {
      await clearSession(opts.chatId, opts.userId);
    } catch { /* ignore */ }
    const saved = await applyDeskRate(room, opts.admin.id, deskRate);
    const open = await (await import('./store')).latestOpenSlip(room, opts.userId);
    if (open && open.thb_in && (open.status === 'OCR_WEAK' || open.status === 'NEED_UNIT' || open.status === 'IN_READY' || open.status === 'IN_READY_REVIEW' || open.status === 'HOLD')) {
      const owed = VaultEngine.verifyReceive({ thb: open.thb_in, rate: deskRate, confidence: open.ocr_confidence, pinMatch: open.pin_match }).expectedUsdt;
      const next = await patchSlip(open.id, {
        desk_rate: deskRate,
        should_send: owed,
        status: 'IN_READY',
      });
      const card = C.cardInReady({
        review: false,
        thb: next.thb_in ?? open.thb_in,
        shouldSend: owed,
        desk: deskRate,
        mkt: saved.mkt,
        bank: next.bank ?? '—',
        last4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
        receiverAccount: next.account_masked,
        name: next.name,
        confidence: next.ocr_confidence ?? 95,
        ledger: next.ledger_ref,
        adminName: next.admin_name ?? opts.admin.name,
        short: next.short_ref,
      });
      if (open.message_id) await editMessage(opts.chatId, open.message_id, card);
      else await sendMessage(opts.chatId, card);
      return true;
    }
    await sendMessage(opts.chatId, C.deskRateSet(saved.desk, saved.mkt));
    return true;
  }

  const parsed = parseAmounts(t);
  if (parsed.thb && !parsed.ambiguous) {
    const open = await (await import('./store')).latestOpenSlip(room, opts.userId);
    if (open && (open.status === 'OCR_WEAK' || open.status === 'NEED_UNIT' || open.status === 'IN_READY' || open.status === 'IN_READY_REVIEW' || open.status === 'HOLD')) {
      const desk = open.desk_rate || (await opsRates(room)).desk;
      const owed = VaultEngine.verifyReceive({ thb: parsed.thb.value, rate: desk, confidence: null, pinMatch: true }).expectedUsdt;
      const next = await patchSlip(open.id, {
        thb_in: parsed.thb.value,
        should_send: owed,
        desk_rate: desk,
        status: 'IN_READY',
      });
      const card = C.cardInReady({
        review: false,
        thb: parsed.thb.value,
        shouldSend: owed,
        desk,
        mkt: next.mkt_rate,
        bank: next.bank ?? '—',
        last4: (next.account_masked ?? '').replace(/\D/g, '').slice(-4),
        receiverAccount: next.account_masked,
        name: next.name,
        confidence: next.ocr_confidence ?? 95,
        ledger: next.ledger_ref,
        adminName: next.admin_name ?? opts.admin.name,
        short: next.short_ref,
      });
      if (open.message_id) await editMessage(opts.chatId, open.message_id, card);
      else await sendMessage(opts.chatId, card);
      return true;
    }
  }
  return false;
}

export { adminKeyboard };
