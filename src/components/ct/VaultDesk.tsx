'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import SummaryToday from '@/components/SummaryToday';
import PinnedAccounts, { type PinnedAccount } from '@/components/PinnedAccounts';
import { useVaultLive } from '@/lib/ct/realtime';
import { QueueTape } from '@/components/ct/TransactionFlow';
import StaffPlaybook from '@/components/ct/StaffPlaybook';
import DeskApiPanel from '@/components/ct/DeskApiPanel';
import { keepDeskSlip, loadDeskPayout, pinDeskAccount, resetDeskCycle, saveDeskPayout, setDeskRate, settleDeskQueue } from '@/lib/desk/actions';
import {
  STATUS_CONFIG,
  canConfirmSettlement,
  requiredUsdt,
  settlementDiff,
  settlementState,
  signedDiffText,
} from '@/lib/ct/settlementMath';

type TapeRow = {
  id: string;
  ledger: string | null;
  short: string;
  thb: number | null;
  usdt?: number | null;
  expectedUsdt?: number | null;
  dueUsdt: number | null;
  sentUsdt: number | null;
  createdAt: string | null;
  dateStamp: string;
  time: string;
  pending: boolean;
  status: string;
  bank: string | null;
  last4: string | null;
  name?: string | null;
};

type VaultPayload = {
  ok: boolean;
  chatId?: number | null;
  vault: {
    dateLabel: string;
    clock: string;
    inThb: number;
    inCount: number;
    outUsdt: number;
    outCount: number;
    requiredUsdt?: number;
    pendingUsdt: number;
    coinDelta?: number;
    feeUsdt?: number;
    desk: number | null;
    mkt: number | null;
    tape: TapeRow[];
  };
  rates: { desk: number; mkt: number | null };
  pins: Array<{
    id?: string;
    bank: string;
    last4: string;
    last4s?: string[];
    label: string | null;
    account?: string | null;
  }>;
  accounts?: Array<{
    id?: string;
    bank: string;
    last4: string;
    count: number;
    totalThb: number;
    totalUsdt: number;
    label?: string | null;
    account?: string | null;
  }>;
};

type RoomChoice = { chatId: number; name: string; desk: number | null; current?: boolean };
type DeskScreen = 'HOME' | 'RECEIVE' | 'OPERATIONS' | 'SETTINGS';

function money(n: number, d = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function VaultDesk() {
  const [data, setData] = useState<VaultPayload | null>(null);
  const [screen, setScreen] = useState<DeskScreen>('HOME');
  const [error, setError] = useState<string | null>(null);
  const [deskDraft, setDeskDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [rateNote, setRateNote] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [catalog, setCatalog] = useState<Array<{ id: string; bankName: string; last4: string; label?: string | null }>>([]);
  const [mode, setMode] = useState<'today' | 'pending'>('pending');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [rooms, setRooms] = useState<RoomChoice[]>([]);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [payoutRail, setPayoutRail] = useState<'sol-usdc' | 'manual-trc20'>('manual-trc20');
  const [payoutLabel, setPayoutLabel] = useState('');
  const [payoutFrom, setPayoutFrom] = useState('');
  const [payoutDest, setPayoutDest] = useState('');
  const [payoutNote, setPayoutNote] = useState<string | null>(null);
  const [payoutSaving, setPayoutSaving] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const live = useVaultLive(() => { void loadRef.current(); });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/vault?mode=${mode}${roomId != null ? `&chatId=${roomId}` : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'vault failed');
      const incoming: TapeRow[] = json.vault?.tape ?? [];
      if (!primed.current) {
        incoming.forEach((r) => seen.current.add(r.id));
        primed.current = true;
      } else {
        const neu = incoming.filter((r) => !seen.current.has(r.id)).map((r) => r.id);
        if (neu.length) {
          neu.forEach((id) => seen.current.add(id));
          setFlash(new Set(neu));
          setTimeout(() => setFlash(new Set()), 1400);
        }
      }
      setData(json);
      setError(null);
      const liveDesk = json.vault?.desk ?? json.rates?.desk;
      if (liveDesk) {
        setDeskDraft((cur) => (cur.trim() ? cur : String(liveDesk)));
      }
    } catch (e: any) {
      setError(e?.message ?? 'offline');
    }
  }, [mode, roomId]);
  loadRef.current = load;

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), live ? 30_000 : 8_000);
    return () => clearInterval(t);
  }, [load, live]);

  useEffect(() => {
    fetch('/api/dashboard/rooms', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j.rooms) ? j.rooms as RoomChoice[] : [];
        setRooms(list);
        if (roomId == null && (j.activeChatId || list[0]?.chatId)) {
          setRoomId(Number(j.activeChatId || list[0].chatId));
        }
      })
      .catch(() => setRooms([]));
  }, [roomId]);

  useEffect(() => {
    fetch('/api/admin/bank-accounts', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setCatalog(Array.isArray(j.data) ? j.data : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (roomId == null) return;
    void loadDeskPayout(roomId).then((r) => {
      if (!r.ok) return;
      setPayoutRail(r.wallet?.rail === 'sol-usdc' ? 'sol-usdc' : 'manual-trc20');
      setPayoutLabel(r.wallet?.label ?? '');
      setPayoutFrom(r.wallet?.fromAddress ?? '');
      setPayoutDest(r.wallet?.destAddress ?? '');
    });
  }, [roomId]);

  const pinAccount = async (bankAccountId: string) => {
    if (pinning) return;
    setPinning(true);
    setError(null);
    try {
      const result = await pinDeskAccount(bankAccountId, roomId);
      if (!result.ok) throw new Error(result.error);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'pin failed');
    } finally {
      setPinning(false);
    }
  };

  const keepSlip = async (row: Pick<TapeRow, 'short' | 'thb'>) => {
    setError(null);
    const thb = Number(row.thb || 0);
    if (thb >= 20_000) {
      const ok = typeof window === 'undefined' || window.confirm(`ยอด ${thb.toLocaleString('en-US')} THB สูง — บังคับเข้าคิว?`);
      if (!ok) throw new Error('ยกเลิก KEEP ยอดสูง');
    }
    const result = await keepDeskSlip(row.short, { force: true, confirmHigh: thb >= 20_000 });
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    await load();
  };

  const settleQueue = async () => {
    if (settling) return;
    setSettling(true);
    setError(null);
    try {
      const result = await settleDeskQueue(roomId);
      if (!result.ok) throw new Error(result.error);
      if (result.skipped.length) {
        const parts = result.skipped.map((s) => `${s.short} ${s.reason}`);
        setError(`ข้าม ${parts.join(' · ')}`);
      }
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'settle failed');
    } finally {
      setSettling(false);
    }
  };

  const savePayout = async (e: FormEvent) => {
    e.preventDefault();
    if (payoutSaving) return;
    setPayoutSaving(true);
    setPayoutNote(null);
    try {
      const result = await saveDeskPayout({
        rail: payoutRail,
        label: payoutLabel,
        fromAddress: payoutFrom,
        destAddress: payoutDest,
      }, roomId);
      if (!result.ok) {
        setPayoutNote(result.error);
        return;
      }
      setPayoutNote(result.wallet.rail === 'sol-usdc' ? 'ใช้ราง USDC Solana วันนี้' : 'ใช้ราง TRC20 โอนมือวันนี้');
      setPayoutLabel(result.wallet.label);
      setPayoutFrom(result.wallet.fromAddress);
      setPayoutDest(result.wallet.destAddress);
    } catch (err: any) {
      setPayoutNote(err?.message ?? 'บันทึกกระเป๋าไม่ได้');
    } finally {
      setPayoutSaving(false);
    }
  };

  const resetCycle = async () => {
    if (resetting) return;
    if (typeof window !== 'undefined' && !window.confirm('เริ่มรอบใหม่? คิวเดิมถูกพักไว้ ไม่ลบ ไม่โอน USDT')) return;
    setResetting(true);
    setError(null);
    try {
      const result = await resetDeskCycle(roomId);
      if (!result.ok) throw new Error(result.error);
      setMode('today');
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'reset failed');
    } finally {
      setResetting(false);
    }
  };

  const saveDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    const sellRate = Number(deskDraft);
    if (!Number.isFinite(sellRate) || sellRate <= 0) {
      setRateNote('ใส่เรทขาย เช่น 36.70');
      return;
    }
    setSaving(true);
    setRateNote(null);
    setError(null);
    try {
      const result = await setDeskRate(sellRate);
      if (!result.ok) {
        setRateNote(result.error);
        return;
      }
      setDeskDraft(String(result.sellRate));
      setRateNote(`ใช้เรท ${result.sellRate} แล้ว`);
      await load();
    } catch {
      setRateNote('ตั้งเรทไม่ติด ลองอีกครั้ง');
    } finally {
      setSaving(false);
    }
  };

  const v = data?.vault;
  const tape = (v?.tape ?? []).filter((r) => (mode === 'pending' ? r.pending : true)).map((r) => ({
    ...r,
    expectedUsdt: r.expectedUsdt ?? r.usdt ?? null,
    dueUsdt: r.dueUsdt ?? r.usdt ?? null,
    sentUsdt: r.sentUsdt ?? null,
    dateStamp: r.dateStamp || '\u2014',
    status: r.status ?? (r.pending ? 'WAIT' : 'DONE'),
  }));
  const due = v?.pendingUsdt ?? 0;
  const required = v?.requiredUsdt ?? due;
  const sent = v?.outUsdt ?? 0;
  const coin = v?.coinDelta ?? sent - required;
  const fee = v?.feeUsdt ?? 0;
  const desk = v?.desk ?? data?.rates.desk ?? 0;
  const mkt = v?.mkt ?? data?.rates.mkt ?? null;
  const pin = data?.pins?.[0];
  const accounts = data?.accounts ?? [];
  const pinCards: PinnedAccount[] = (accounts.length
    ? accounts
    : pin
      ? [{ bank: pin.bank, last4: pin.last4, count: 0, totalThb: 0, totalUsdt: 0, label: pin.label, account: pin.account }]
      : []
  ).map((a, i) => {
    const cap = String(a.label || '').match(/วงเงิน\s*[:：]?\s*([\d,]+)/i);
    const limit = cap ? Number(cap[1].replace(/,/g, '')) : null;
    const who = String(a.label || '')
      .split('·')
      .map((s) => s.trim())
      .find((s) => s && !/^วงเงิน/i.test(s) && s !== a.bank) || a.bank;
    return {
      id: a.id ?? `${a.bank}-${a.last4}-${i}`,
      bankAccountId: a.id ?? `${a.bank}-${a.last4}`,
      accountName: who,
      bankName: a.bank,
      last4: a.last4,
      accountNumber: a.account || null,
      pinnedForDate: v?.dateLabel ?? '',
      transactionCount: a.count,
      totalThb: a.totalThb,
      totalUsdt: a.totalUsdt,
      dailyLimitThb: Number.isFinite(limit as number) ? limit : null,
      status: 'active' as const,
    };
  });
  const waitDue = tape
    .filter((r) => r.status === 'WAIT' || r.status === 'QUEUE' || r.status === 'SENT' || r.status === 'LOCK')
    .reduce((s, r) => s + (r.dueUsdt ?? r.expectedUsdt ?? r.usdt ?? 0), 0);
  const settleDue = Math.max(due, Math.round(waitDue * 100) / 100);
  const settleCard = {
    depositThb: v?.inThb ?? 0,
    depositCount: v?.inCount ?? 0,
    roomRate: desk,
    sentUsdt: sent > 0 ? sent : null,
    settled: settleDue <= 0 && sent > 0,
    rail: payoutRail,
    fromLabel: payoutLabel || null,
    fromAddress: payoutFrom || null,
    destAddress: payoutDest || null,
  };
  const settleSt = settlementState(settleCard);
  const settleNeed = requiredUsdt(settleCard);
  const settleDiff = settlementDiff(settleCard);
  const settleBadge = STATUS_CONFIG[settleSt];
  const settleUnit = payoutRail === 'sol-usdc' ? 'USDC' : 'USDT';
  const settleSigned = signedDiffText(settleDiff, settleUnit);
  const canBatch = canConfirmSettlement(settleCard) && settleDue > 0;

  return (
    <div className="desk-board">
      <header className="nav dense-nav">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ce-mark">
            <Image src="/brand/ce-mark-512.png" width={36} height={36} alt="" sizes="36px" priority unoptimized />
          </span>
          <span className="ops-title">CE Vault</span>
          <span className={`pill hidden sm:inline-flex ${live ? 'pill-done' : 'pill-wait'}`}>
            {live ? 'สด' : 'รีเฟรช'}
          </span>
          <nav className="flex gap-1" aria-label="CE VAULT screens">
            {(['HOME', 'RECEIVE', 'OPERATIONS', 'SETTINGS'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={'qd-pill' + (screen === item ? ' is-on' : '')}
                onClick={() => {
                  setScreen(item);
                  if (item === 'OPERATIONS') setMode('pending');
                  if (item === 'HOME') setMode('today');
                }}
              >
                {{ HOME: 'HOME', RECEIVE: 'RECEIVE', OPERATIONS: 'OPERATIONS', SETTINGS: 'SETTINGS' }[item]}
              </button>
            ))}
          </nav>
          {screen === 'SETTINGS' && <button type="button" className={'qd-pill' + (monitor ? ' is-on' : '')} onClick={() => setMonitor((v) => !v)}>Monitor</button>}
          {settleDue > 0 && (
            <span className="font-mono text-sm text-gold">รอโอน {money(settleDue, 2)}</span>
          )}
        </div>
      </header>
      {rooms.length > 0 && (
        <div className="room-rail" aria-label="เลือกห้อง">
          {rooms.map((r) => (
            <button
              key={r.chatId}
              type="button"
              className={'qd-pill' + (roomId === r.chatId ? ' is-on' : '')}
              onClick={() => setRoomId(r.chatId)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      <p className="color-key">
        <span><i className="in" />เขียว = ฝาก</span>
        <span><i className="out" />แดง = โอน</span>
      </p>
      <div className="desk-banner" aria-label="ผลรวมวันนี้">
        <article className="is-in">
          <p>ฝาก</p>
          <strong>{money(v?.inThb ?? 0)}</strong>
        </article>
        <article className="is-out">
          <p>ส่งแล้ว</p>
          <strong>{money(sent, 2)}</strong>
        </article>
        <article className="is-due">
          <p>ค้างเคลียร์</p>
          <strong>{money(settleDue, 2)}</strong>
        </article>
      </div>
      {screen === 'OPERATIONS' && <section className="desk-settle" data-state={settleSt} aria-label="เคลียร์ยอด">
        <header className="desk-settle__head">
          <p>เคลียร์ยอด</p>
          <span className="desk-settle__chip">
            {settleBadge.icon} {settleBadge.chip}
            <em>{settleBadge.th}</em>
          </span>
        </header>
        <dl className="desk-settle__grid">
          <div>
            <dt>ฝากรวม</dt>
            <dd>{money(settleCard.depositThb)} THB</dd>
            <small>{settleCard.depositCount} รายการ</small>
          </div>
          <div>
            <dt>ยอดที่ต้องส่ง</dt>
            <dd>{money(settleNeed, 2)} {settleUnit}</dd>
            <small>{money(settleCard.depositThb)} ÷ {desk ? desk.toFixed(2) : '—'}</small>
          </div>
          <div>
            <dt>ส่งไปแล้ว</dt>
            <dd>{sent > 0 ? `${money(sent, 2)} ${settleUnit}` : 'รอส่ง'}</dd>
          </div>
          <div className="desk-settle__diff">
            <dt>ส่วนต่าง</dt>
            <dd>{settleSigned ?? 'รอคำนวณ'}</dd>
            <small>{settleBadge.message.split(' (')[0]}</small>
          </div>
        </dl>
        <div className="desk-settle__actions">
          {settleSt === 'SETTLED' ? (
            <button type="button" className="desk-settle__done" disabled>โอนสำเร็จ</button>
          ) : (
            <>
              <button
                type="button"
                className="desk-settle__go"
                disabled={!canBatch || settling}
                onClick={() => void settleQueue()}
              >
                {settling ? 'กำลังบันทึก' : 'บันทึกส่งรวม'}
              </button>
              <button
                type="button"
                className="desk-settle__cancel"
                onClick={() => setMode('today')}
              >
                ดูยอดวันนี้
              </button>
            </>
          )}
        </div>
      </section>}
      <div className="agent-rail" />
      {error && <div className="noc-alert" role="alert">{error}</div>}
      {screen === 'RECEIVE' && <section className="desk-settle" aria-label="รับสลิป"><header className="desk-settle__head"><p>RECEIVE</p><span className="desk-settle__chip">Telegram</span></header><p className="px-4 pb-4 text-sm text-[color:var(--muted)]">ส่งสลิปใน Telegram เพื่อเริ่ม OCR → ตรวจบัญชี → ตรวจซ้ำ → ยืนยัน โดยใช้ข้อความเดิมเป็น context เดียว</p></section>}
      {screen === 'HOME' && <StaffPlaybook />}
      <DeskApiPanel open={screen === 'SETTINGS' && monitor} onClose={() => setMonitor(false)} />
      <div className="scan-ring" aria-hidden><span>{live ? 'กำลังตรวจสอบรายการ' : 'กำลังอัปเดตข้อมูล'}</span></div>
      {screen === 'HOME' && <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SummaryToday
          dateLabel={v ? `${v.dateLabel} ${v.clock}` : undefined}
          compact
          daily={{
            transactionCount: v?.inCount ?? 0,
            totalThbReceived: v?.inThb ?? 0,
            totalUsdtSent: sent,
            requiredUsdt: required,
            pendingUsdt: settleDue,
            coinDelta: coin,
            feeUsdt: fee,
            inCount: v?.inCount ?? 0,
            outCount: v?.outCount ?? 0,
            waitCount: tape.filter((r) => r.pending || r.status === 'WAIT' || r.status === 'QUEUE').length,
            errCount: tape.filter((r) => r.status === 'ERR' || r.status === 'ERROR').length,
            holdCount: tape.filter((r) => r.status === 'HOLD').length,
          }}
          rates={{ sellRate: desk, marketRate: mkt ?? 0 }}
          lastSync={data ? new Date() : null}
          syncStatus={error ? 'error' : live ? 'live' : data ? 'syncing' : 'syncing'}
        />
        <div className="desk-pin" id="desk-accounts">
          <PinnedAccounts accounts={pinCards} catalog={catalog} onPin={pinAccount} pinning={pinning} lastSync={data ? new Date() : null} syncStatus={error ? 'error' : live ? 'live' : 'syncing'} />
        </div>
      </div>}
      {error && <p className="sr-only">{error}</p>}
      {screen === 'SETTINGS' && <><form onSubmit={saveDesk} className="desk-rate">
        <label htmlFor="desk-rate">เราขาย{desk ? ` ตอนนี้ ${desk}` : ''}</label>
        <div className="desk-rate__row">
          <input
            id="desk-rate"
            value={deskDraft}
            onChange={(e) => {
              setDeskDraft(e.target.value);
              setRateNote(null);
            }}
            placeholder="36.70"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(rateNote && rateNote.startsWith('ใส่'))}
            className="field"
          />
          <button type="submit" disabled={saving} className="keep px-4 text-xs">
            {saving ? 'กำลังใช้เรท' : 'ใช้เรทนี้'}
          </button>
          <button type="button" disabled={resetting} className="desk-rate__reset" onClick={() => void resetCycle()}>
            {resetting ? 'กำลังพักคิว' : 'เริ่มรอบใหม่'}
          </button>
        </div>
        <p className={'desk-rate__hint' + (rateNote && !rateNote.startsWith('ใช้เรท') ? ' is-bad' : '')} role="status">
          {rateNote}
        </p>
      </form>
      <form onSubmit={savePayout} className="desk-payout">
        <label>กระเป๋าวันนี้ · เปลี่ยนได้ทุกวัน</label>
        <div className="desk-payout__rails" role="group" aria-label="รางโอน">
          <button
            type="button"
            className={'qd-pill' + (payoutRail === 'manual-trc20' ? ' is-on' : '')}
            onClick={() => setPayoutRail('manual-trc20')}
          >
            TRC20 โอนมือ
          </button>
          <button
            type="button"
            className={'qd-pill' + (payoutRail === 'sol-usdc' ? ' is-on' : '')}
            onClick={() => setPayoutRail('sol-usdc')}
          >
            USDC Solana
          </button>
        </div>
        <div className="desk-rate__row">
          <input
            value={payoutLabel}
            onChange={(e) => setPayoutLabel(e.target.value)}
            placeholder="ชื่อเล่นกระเป๋า"
            autoComplete="off"
            className="field"
            aria-label="ชื่อเล่นกระเป๋า"
          />
          <input
            value={payoutFrom}
            onChange={(e) => setPayoutFrom(e.target.value)}
            placeholder={payoutRail === 'sol-usdc' ? 'ที่อยู่ Solana ต้นทาง' : 'ที่อยู่ TRON ต้นทาง'}
            autoComplete="off"
            className="field"
            aria-label="ที่อยู่ต้นทาง"
          />
        </div>
        <div className="desk-rate__row">
          <input
            value={payoutDest}
            onChange={(e) => setPayoutDest(e.target.value)}
            placeholder={payoutRail === 'sol-usdc' ? 'ที่อยู่ลูกค้า Solana' : 'ที่อยู่ลูกค้า TRON'}
            autoComplete="off"
            className="field"
            aria-label="ที่อยู่ลูกค้า"
          />
          <button type="submit" disabled={payoutSaving} className="keep px-4 text-xs">
            {payoutSaving ? 'กำลังบันทึก' : 'ใช้กระเป๋านี้'}
          </button>
        </div>
        <p className={'desk-rate__hint' + (payoutNote && !payoutNote.startsWith('ใช้ราง') ? ' is-bad' : '')} role="status">
          {payoutNote}
        </p>
      </form>
      </> }
      {screen === 'OPERATIONS' && <QueueTape
        rows={tape}
        dateLabel={v?.dateLabel ?? '\u2014'}
        clock={v?.clock ?? '\u2014'}
        waiting={tape.filter((r) => r.status === 'WAIT' || r.status === 'QUEUE' || r.status === 'SENT' || r.status === 'LOCK').reduce((s, r) => s + (r.expectedUsdt ?? r.usdt ?? 0), 0)}
        sent={sent}
        due={settleDue}
        flash={flash}
        onSettle={settleQueue}
        settling={settling}
        onKeep={(row) => keepSlip(row)}
      />}
    </div>
  );
}
