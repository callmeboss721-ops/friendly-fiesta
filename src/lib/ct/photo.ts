import { sendMessage, editMessage, sendChatAction, downloadTelegramFile, uploadSlipBuffer, getChatPinnedText, sendPhoto, editPhoto, deleteMessage } from '../telegram';
import { analyzeSlipFast, type SlipExtract } from '../ocr';
import { listPinnedBanks, matchSlipPins, accountLast4, pinBankAccount, ensureTodayPins } from '../banks';
import { findSlipByFingerprint } from '../transactions';
import { findReceiversByLast4 } from '../receivers';
import { slipFingerprint, qrSlipFingerprint } from '../botSecurity';
import { parseDeskPin } from '../../bot/parse';
import { gateOcr, type OcrGate } from './gate';
import { opsRates } from './rates';
import { insertPending, findPendingByFingerprint, type PendingSlip } from './store';
import { clockBkk } from './format';
import { VaultEngine } from './vaultEngine';
import { canAutoQueue, commitIncomingLock, dueSummary } from './queue';
import { isOcrJunkAmount } from './settleGuard';
import { applyQrToOcr, type SlipQrResult } from './slipQr';
import { inspectSlipImage } from './slipInquiry';
import * as C from './copy';
import { cardDuplicate, cardAlreadyQueued } from './notice';
import { renderScanPng } from './cardImage';
import { heroPng } from './brandCards';
import { AiTransition, aiReceived } from './aiTransition';
import { decodeStillFrame } from './livePhoto';
import type { Admin } from '@/types/transactions';
import type { PinnedBank } from '../banks';

async function pinsForToday(chatId: number): Promise<PinnedBank[]> {
  try {
    const rolled = await ensureTodayPins(chatId);
    if (rolled.length) return rolled;
  } catch {
    /* fall through to telegram pin text */
  }
  const existing = await listPinnedBanks(chatId);
  if (existing.length) return existing;
  const pinnedText = await getChatPinnedText(chatId);
  const desk = pinnedText ? parseDeskPin(pinnedText) : null;
  if (!desk) return [];
  try {
    const { pinned } = await pinBankAccount(chatId, desk.bank, desk.account, desk.name, desk.limit);
    return pinned;
  } catch {
    return [];
  }
}

async function rejectDuplicate(chatId: number, fingerprint: string): Promise<boolean> {
  const [ledger, pending] = await Promise.all([
    findSlipByFingerprint(fingerprint),
    findPendingByFingerprint(fingerprint),
  ]);
  if (ledger) {
    await sendMessage(chatId, cardDuplicate(ledger.ledgerRef));
    return true;
  }
  if (pending) {
    await sendMessage(chatId, cardAlreadyQueued(pending.ledger_ref));
    return true;
  }
  return false;
}

async function ingestSlip(chatId: number, fileId: string, buffer: Buffer, cardIdP: Promise<number>): Promise<{
  cardId: number;
  url: string;
  slip: SlipExtract;
  qr: SlipQrResult | null;
} | null> {
  try {
    const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    const qrP = inspectSlipImage(buffer).catch(() => null);
    const [cardId, analyzed, qr] = await Promise.all([
      cardIdP,
      analyzeSlipFast(dataUrl, uploadSlipBuffer(buffer, fileId)),
      qrP,
    ]);
    const slip = qr ? applyQrToOcr(analyzed.slip, qr) : analyzed.slip;
    return { cardId, url: analyzed.url, slip, qr };
  } catch (e: any) {
    const cardId = await cardIdP.catch(() => 0);
    if (cardId) await editMessage(chatId, cardId, { text: `อ่านสลิปไม่สำเร็จ — ${e?.message ?? 'ลองส่งใหม่'}` });
    return null;
  }
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

export async function handleCtPhoto(opts: { chatId: number; userId: number; admin: Admin; fileId: string; fileUniqueId: string; livePhoto?: boolean; }): Promise<void> {
  const { chatId, userId, admin, fileId, fileUniqueId, livePhoto } = opts;
  const [pins, rates] = await Promise.all([pinsForToday(chatId), opsRates(chatId)]);
  const todayPin = pins[0];
  await sendChatAction(chatId, 'upload_photo');
  let buffer: Buffer;
  try {
    buffer = await downloadTelegramFile(fileId);
  } catch (e: any) {
    await sendMessage(chatId, { text: `อ่านสลิปไม่สำเร็จ — ${e?.message ?? 'ลองส่งใหม่'}` });
    return;
  }
  const still = decodeStillFrame(buffer);
  const opening = aiReceived({ live: Boolean(livePhoto) });
  const scanPng = renderScanPng({ still, sweep: 0.16, live: Boolean(livePhoto) });
  const cardIdP = sendPhoto(chatId, scanPng, opening).catch(() => sendMessage(chatId, opening));
  const read = await ingestSlip(chatId, fileId, buffer, cardIdP);
  if (!read) return;
  const { cardId, url, slip, qr } = read;

  const fileFp = slipFingerprint(fileUniqueId);
  const fingerprints = qr?.transRef
    ? [qrSlipFingerprint(qr.transRef, qr.sendingBankCode), fileFp]
    : [fileFp];
  for (const fp of fingerprints) {
    if (await rejectDuplicate(chatId, fp)) return;
  }
  const fingerprint = fingerprints[0];

  const ai = new AiTransition(chatId, cardId, Boolean(livePhoto), still);
  const matchedPin = matchSlipPins(slip.bank, slip.receiverLast4, slip.senderLast4, pins);
  const pinMatch = Boolean(matchedPin);
  const thb = slip.thbAmount && slip.thbAmount > 0 ? slip.thbAmount : null;
  const last4Early = accountLast4(matchedPin?.account_number) ?? slip.receiverLast4 ?? slip.senderLast4;
  const ctx = {
    thb,
    usdt: null as number | null,
    bank: matchedPin?.bank_name ?? slip.bank ?? todayPin?.bank_name ?? null,
    last4: last4Early,
    ref: slip.transRef,
    time: slip.time,
    date: slip.date,
    name: slip.receiverName ?? slip.senderName,
    sender: slip.senderName,
    channel: slip.channel,
    fee: slip.feeThb,
    confidence: slip.confidence,
    account: slip.receiverAccount || matchedPin?.account_number || last4Early,
    senderAccount: slip.senderAccount,
    senderBank: slip.senderBank,
    balance: slip.balanceThb,
    slipType: slip.slipType,
  };
  await ai.step('ocr', ctx);
  await ai.step('extract', ctx);
  await ai.step('match', ctx);
  const qrVerified = Boolean(qr?.inquiry?.valid);
  let gate = gateOcr({ thb, confidence: slip.confidence, pinMatch, hasCurrency: thb != null, qrVerified });
  if (qr?.inquiry && qr.inquiry.valid === false) gate = 'OCR_WEAK';
  const usdtDue = thb && rates.desk ? VaultEngine.verifyReceive({ thb, rate: rates.desk, confidence: slip.confidence ?? null, pinMatch, qrVerified: Boolean(qr) }).expectedUsdt : null;
  ctx.usdt = usdtDue;
  await ai.step('calc', ctx);
  const notes = [
    isOcrJunkAmount(thb) ? 'OCR_JUNK:AMOUNT_TOO_LARGE' : null,
    qr?.transRef ? `QR:${qr.transRef}` : null,
    qrVerified ? `QR_OK:${qr?.inquiry?.provider ?? 'ok'}` : null,
    qr?.inquiry && qr.inquiry.valid === false ? 'QR_INVALID' : null,
    slip.transRef ? `REF:${slip.transRef}` : null,
    slip.channel ? `CH:${slip.channel}` : null,
    slip.senderName ? `FROM:${slip.senderName}` : null,
    slip.senderAccount ? `FROMACCT:${String(slip.senderAccount).replace(/\D/g, '')}` : null,
    slip.senderBank ? `FROMBANK:${slip.senderBank}` : null,
    slip.feeThb != null ? `FEE:${slip.feeThb}` : null,
    (slip.receiverAccount || last4Early) ? `ACCT:${String(slip.receiverAccount || last4Early).replace(/\D/g, '')}` : null,
    slip.bank ? `BANK:${slip.bank}` : null,
    slip.date ? `DATE:${slip.date}` : null,
    slip.time ? `TIME:${slip.time}` : null,
    slip.promptpay ? `PP:${slip.promptpay}` : null,
    slip.balanceThb != null ? `BAL:${slip.balanceThb}` : null,
    slip.slipType ? `TYPE:${slip.slipType}` : null,
  ].filter(Boolean).join('|') || null;
  const pending = await insertPending({
    chat_id: chatId, admin_tg_id: userId, admin_name: admin.name,
    status: gate === 'IN_READY_REVIEW' ? 'IN_READY_REVIEW' : gate,
    thb_in: thb, should_send: usdtDue, desk_rate: rates.desk || null, mkt_rate: rates.mkt, bot_usd: rates.usd,
    bank: matchedPin?.bank_name ?? slip.bank ?? null,
    account_masked: slip.receiverAccount || matchedPin?.account_number || last4Early,
    name: slip.receiverName ?? slip.senderName ?? null, pin_match: pinMatch, ocr_confidence: slip.confidence ?? null,
    source_file_id: fileId, slip_url: url, slip_fingerprint: fingerprint, message_id: cardId,
    undo_until: null, tx_id: null,
    note: notes,
    bank_account_id: matchedPin?.id ?? null,
  });
  const last4 = last4Early;
  if (canAutoQueue(gate, thb, rates.desk) && pinMatch) {
    const queued = await tryQueue(pending, { chatId, userId, admin, cardId, last4, bank: matchedPin?.bank_name ?? todayPin?.bank_name ?? slip.bank ?? '—' });
    if (queued) return;
  }
  const known = last4 ? await findReceiversByLast4(last4) : [];
  const card = renderGateCard(pending, {
    gate, slipBank: slip.bank ?? '—', slipLast4: last4Early ?? slip.receiverLast4 ?? '????',
    pinBank: matchedPin?.bank_name ?? todayPin?.bank_name ?? '—',
    pinLast4: accountLast4(matchedPin?.account_number ?? todayPin?.account_number) ?? 'ยังไม่หมุด',
    pinAccount: matchedPin?.account_number ?? todayPin?.account_number ?? null,
    lead: admin.role === 'SuperAdmin' || admin.role === 'Admin',
    chips: thb ? [thb] : [500, 1000], fresh: Boolean(last4) && known.length === 0,
    slip,
    pins: pins.map((b) => ({
      bank: b.bank_name,
      last4: accountLast4(b.account_number) ?? '????',
      account: b.account_number,
    })),
  });
  const hero = gate === 'PIN_MISMATCH'
    ? 'MISMATCH'
    : thb
      ? `${thb.toLocaleString('en-US')} THB`
      : 'SLIP';
  await sendHero(chatId, cardId, gate === 'PIN_MISMATCH' ? 'vault' : 'locked', card, hero, gate === 'PIN_MISMATCH' ? 'PIN' : 'IN', pending.short_ref);
}

async function tryQueue(pending: PendingSlip, ctx: { chatId: number; userId: number; admin: Admin; cardId: number; last4: string | null; bank: string; }): Promise<boolean> {
  try {
    const locked = await commitIncomingLock(pending, { chatId: ctx.chatId, userId: ctx.userId, admin: ctx.admin, force: false, queued: true });
    const batch = await dueSummary(ctx.chatId);
    const card = C.cardLocked({
      thb: locked.thb_in ?? 0, shouldSend: locked.should_send ?? 0, desk: locked.desk_rate ?? 0, mkt: locked.mkt_rate,
      ledger: locked.ledger_ref, adminName: ctx.admin.name, time: clockBkk(), short: locked.short_ref,
      canUndo: true, queued: true, batch, bank: locked.bank ?? ctx.bank, last4: ctx.last4 ?? '????',
      account: locked.account_masked, name: locked.name,
    });
    await sendHero(
      ctx.chatId,
      ctx.cardId,
      'locked',
      card,
      `${(locked.thb_in ?? 0).toLocaleString('en-US')} THB`,
      'WAIT',
      locked.short_ref,
    );
    return true;
  } catch { return false; }
}

export function renderGateCard(p: PendingSlip, extra: {
  gate: OcrGate; slipBank: string; slipLast4: string; pinBank: string; pinLast4: string;
  pinAccount?: string | null;
  lead: boolean; chips: number[]; fresh?: boolean; slip?: SlipExtract;
  pins?: Array<{ bank: string; last4: string; account?: string | null }>;
}) {
  const s = extra.slip;
  if (extra.gate === 'PIN_MISMATCH') return C.cardPinMismatch({
    slipBank: extra.slipBank, slipLast4: extra.slipLast4, pinBank: extra.pinBank, pinLast4: extra.pinLast4,
    name: p.name, confidence: p.ocr_confidence ?? 0, short: p.short_ref, lead: extra.lead,
    slipAccount: s?.receiverAccount, pinAccount: extra.pinAccount, pins: extra.pins,
  });
  if (extra.gate === 'NEED_UNIT') return C.cardNeedUnit({ short: p.short_ref });
  if (extra.gate === 'OCR_WEAK') return C.cardOcrWeak({
    bank: extra.slipBank, last4: extra.slipLast4, name: p.name, confidence: p.ocr_confidence ?? 0,
    short: p.short_ref, chips: extra.chips,
    account: s?.receiverAccount, senderName: s?.senderName, senderAccount: s?.senderAccount,
    senderBank: s?.senderBank, transRef: s?.transRef, time: s?.time, date: s?.date,
    channel: s?.channel, raw: s?.raw,
  });
  return C.cardInReady({
    review: extra.gate === 'IN_READY_REVIEW',
    thb: p.thb_in ?? 0,
    shouldSend: p.should_send ?? 0,
    desk: p.desk_rate ?? 0,
    mkt: p.mkt_rate,
    bank: extra.pinBank || extra.slipBank,
    last4: extra.pinLast4 || extra.slipLast4,
    name: p.name,
    confidence: p.ocr_confidence ?? 0,
    ledger: p.ledger_ref,
    adminName: p.admin_name ?? 'Admin',
    short: p.short_ref,
    fresh: extra.fresh,
    time: s?.time ?? undefined,
    date: s?.date,
    senderName: s?.senderName,
    senderLast4: s?.senderLast4,
    senderBank: s?.senderBank,
    senderAccount: s?.senderAccount,
    receiverAccount: s?.receiverAccount || p.account_masked,
    transRef: s?.transRef,
    feeThb: s?.feeThb,
    channel: s?.channel,
    promptpay: s?.promptpay,
    balanceThb: s?.balanceThb,
    slipType: s?.slipType,
    raw: s?.raw,
  });
}
