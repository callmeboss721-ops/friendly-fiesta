'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SlipCard } from './SlipCard';

type TapeRow = {
  id: string;
  ledger?: string | null;
  short: string;
  thb: number | null;
  expectedUsdt?: number | null;
  sentUsdt?: number | null;
  dueUsdt?: number | null;
  usdt?: number | null;
  time: string;
  pending: boolean;
  status: string;
  bank?: string | null;
  last4?: string | null;
  account?: string | null;
  name?: string | null;
};

type QueueFilter = 'ALL' | 'READY' | 'PENDING' | 'SHORT' | 'SETTLED' | 'REJECTED';

const FILTER_LABEL: Record<QueueFilter, string> = {
  ALL: 'ทั้งหมด',
  READY: 'พร้อม',
  PENDING: 'รอโอน',
  SHORT: 'ส่งขาด',
  SETTLED: 'ปิดแล้ว',
  REJECTED: 'ตรวจทาน',
};

function n(v: number | null | undefined, d = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function isShort(row: TapeRow) {
  return row.sentUsdt != null && (row.dueUsdt ?? 0) > 0;
}

function matches(filter: QueueFilter, status: string, pending: boolean, short = false) {
  if (filter === 'ALL') return true;
  if (filter === 'SETTLED') return status === 'DONE' || status === 'SETTLED';
  if (filter === 'READY') return status === 'IN' || status === 'LOCK';
  if (filter === 'PENDING') return !short && (status === 'WAIT' || status === 'QUEUE' || status === 'SENT' || pending);
  if (filter === 'SHORT') return status === 'SHORT' || short;
  return status === 'HOLD' || status === 'ERR' || status === 'ERROR' || status === 'SCAN';
}

function matchesSearch(row: TapeRow, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return [row.ledger, row.short, row.thb, row.expectedUsdt, row.sentUsdt, row.bank, row.last4, row.name, row.status]
    .some((value) => String(value ?? '').toLowerCase().includes(term));
}

function rowState(status: string, pending: boolean) {
  if (status === 'HOLD') return 'hold';
  if (status === 'ERR' || status === 'ERROR' || status === 'SCAN') return 'err';
  if (status === 'DONE') return 'done';
  if (status === 'IN' || status === 'LOCK') return 'in';
  if (status === 'WAIT' || status === 'SENT' || status === 'QUEUE' || pending) return 'wait';
  return 'in';
}

function badgeOf(status: string, pending: boolean) {
  const state = rowState(status, pending);
  if (state === 'done') return { label: 'เสร็จ', cls: 'st-done' };
  if (state === 'hold') return { label: 'พัก', cls: 'st-hold' };
  if (state === 'err') return { label: 'ผิด', cls: 'st-ocr' };
  if (state === 'wait') return { label: 'คิว', cls: 'st-wait' };
  return { label: 'เข้า', cls: 'st-in' };
}

function acct(row: TapeRow) {
  const no = row.account || row.last4;
  if (!no) return row.short || '—';
  return (row.bank ? `${row.bank} ` : '') + no;
}

function useCountUp(value: number, digits = 2) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || fromRef.current === value) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const start = fromRef.current;
    const diff = value - start;
    const dur = 240;
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + diff * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return n(shown, digits);
}

export function QueueTape({
  rows, dateLabel, clock, waiting, sent, due, flash, onSettle, settling, onKeep,
}: {
  rows: TapeRow[];
  dateLabel: string;
  clock: string;
  waiting: number;
  sent: number;
  due: number;
  flash: Set<string>;
  coinDelta?: number;
  onSettle?: () => Promise<void> | void;
  settling?: boolean;
  onKeep?: (row: TapeRow) => Promise<void> | void;
}) {
  const holdCount = rows.filter((r) => r.status === 'HOLD').length;
  const [filter, setFilter] = useState<QueueFilter>('PENDING');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<TapeRow | null>(null);
  const dueText = useCountUp(due, 2);
  const shown = useMemo(() => rows.filter((r) => matches(filter, r.status, r.pending, isShort(r)) && matchesSearch(r, search)), [rows, filter, search]);
  const pending = useMemo(() => rows.filter((r) => r.pending || r.status === 'WAIT' || r.status === 'QUEUE'), [rows]);
  const batch = {
    count: pending.filter((r) => r.status !== 'HOLD' && r.status !== 'ERR' && r.status !== 'ERROR').length,
    thb: pending.filter((r) => r.status !== 'HOLD' && r.status !== 'ERR' && r.status !== 'ERROR').reduce((s, r) => s + (r.thb ?? 0), 0),
    usdt: pending.filter((r) => r.status !== 'HOLD' && r.status !== 'ERR' && r.status !== 'ERROR').reduce((s, r) => s + (r.dueUsdt ?? r.expectedUsdt ?? r.usdt ?? 0), 0),
    target: 10000,
  };

  return (
    <section className="queue-desk">
      <div className="qd-head">
        <p className="qd-mark">CT · สมุดรายการ</p>
        <p className="qd-clock">{dateLabel} {clock}</p>
      </div>
      <div className="qd-pills" role="tablist">
        {(['PENDING', 'READY', 'SHORT', 'SETTLED', 'REJECTED', 'ALL'] as QueueFilter[]).map((f) => (
          <button key={f} type="button" className={'qd-pill' + (filter === f ? ' is-on' : '')} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}{f === 'REJECTED' && holdCount ? ` ${holdCount}` : ''}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="queue-search">ค้นหารายการ</label>
      <input
        id="queue-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ค้นหา REF, ยอด, ชื่อ, ธนาคาร, สถานะ"
        className="field w-full"
        autoComplete="off"
      />
      <article className="qd-balance">
        <p className="qd-k">รอโอน USDT</p>
        <p className="qd-amt">{dueText}</p>
        <p className="qd-sub">{`คิว ${batch.count} · รับ ${n(batch.thb)} บาท · ส่งแล้ว ${n(sent, 2)}${holdCount ? ` · พัก ${holdCount}` : ''}`}</p>
      </article>
      <div className="qd-cols">
        <span>เวลา</span><span>บัญชี</span><span>บาท</span><span>รอโอน</span><span>สถานะ</span>
      </div>
      <div className="qd-list">
        {shown.length === 0 ? <p className="qd-empty">{search ? 'ไม่พบรายการที่ตรงกับคำค้น' : filter === 'PENDING' ? 'ไม่มีรายการรอโอน' : 'ไม่มีรายการในมุมนี้'}</p> : shown.map((row, i) => {
          const badge = badgeOf(row.status, row.pending);
          const dueU = row.dueUsdt ?? row.expectedUsdt ?? row.usdt;
          const state = rowState(row.status, row.pending);
          return (
            <div key={row.id} role="button" tabIndex={0} onClick={() => setOpen(row)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(row); }} className={'qd-row' + (flash.has(row.id) ? ' is-flash' : '')} data-status={state} style={{ ['--row-state' as string]: state, ['--i' as string]: Math.min(i, 12) }}>
              <span className="qd-time">{row.time || '—'}</span>
              <span className="qd-acct">{acct(row)}</span>
              <span className="qd-thb">{row.thb == null ? '—' : n(row.thb)}</span>
              <span className="qd-usdt">{n(dueU, 2)}</span>
              <span className="st">{badge.label}</span>
            </div>
          );
        })}
      </div>
      {open ? (
        <SlipCard
          slip={open}
          onClose={() => setOpen(null)}
          queue={batch}
          onKeep={onKeep ? async () => {
            await onKeep(open);
            setOpen((cur) => cur && cur.id === open.id
              ? { ...cur, status: 'WAIT', pending: true }
              : cur);
          } : undefined}
        />
      ) : null}
      <div className="qd-dock">
        <button type="button" className="qd-send" disabled={due <= 0 || settling || !onSettle} onClick={() => void onSettle?.()}>{settling ? 'กำลังบันทึก' : 'บันทึกส่งรวม'}</button>
      </div>
    </section>
  );
}
