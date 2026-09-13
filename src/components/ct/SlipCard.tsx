'use client';

import { useState } from 'react';
import BankLogo from '@/components/BankLogo';
import { resolveBank } from '@/lib/bankBrands';

type Slip = {
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
  name?: string | null;
};

function n(v: number | null | undefined, d = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const STEPS = ['BANK', 'PIN', 'DEPOSIT', 'OCR', 'MATCH', 'SETTLE', 'AUDIT'] as const;

function onSteps(status: string, pending: boolean): number {
  if (status === 'DONE') return 7;
  if (status === 'HOLD') return 5;
  if (status === 'ERR' || status === 'ERROR' || status === 'SCAN') return 4;
  if (status === 'WAIT' || status === 'SENT' || status === 'QUEUE' || pending) return 6;
  if (status === 'IN' || status === 'LOCK') return 5;
  if (status === 'MATCH') return 5;
  return 3;
}

function statusLabel(status: string) {
  if (status === 'DONE') return 'เสร็จ';
  if (status === 'HOLD') return 'พัก';
  if (status === 'ERR' || status === 'ERROR') return 'ผิด';
  if (status === 'WAIT' || status === 'QUEUE' || status === 'SENT') return 'คิว';
  return 'รับ';
}

function refOf(slip: Slip) {
  const raw = String(slip.ledger || slip.id || '');
  if (raw.startsWith('#CE') || raw.startsWith('CE-')) return raw.startsWith('#') ? raw : '#' + raw;
  return slip.short ? '#CE-' + slip.short : '';
}

export function SlipCard({ slip, onClose, queue, onKeep }: {
  slip: Slip;
  onClose: () => void;
  queue?: { count: number; thb: number; usdt: number; target: number };
  onKeep?: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [keepErr, setKeepErr] = useState<string | null>(null);
  const expected = slip.expectedUsdt ?? slip.usdt ?? null;
  const sent = slip.sentUsdt ?? (slip.status === 'DONE' ? expected : null);
  const due = slip.dueUsdt ?? (
    expected == null ? null : Math.max(0, Number((expected - (sent ?? 0)).toFixed(2)))
  );
  const settled = slip.status === 'DONE';
  const queued = !settled && slip.status !== 'ERR' && slip.status !== 'ERROR' && slip.status !== 'HOLD';
  const active = onSteps(slip.status, slip.pending);
  const ref = refOf(slip);
  const target = queue?.target ?? 10000;
  const used = queue?.thb ?? 0;
  const left = Math.max(0, target - used);
  const dueAll = queue?.usdt ?? 0;
  const bank = resolveBank(slip.bank);
  const payee = [bank.code, slip.last4 || null].filter(Boolean).join(' ');

  async function copyRef() {
    if (!ref) return;
    await navigator.clipboard.writeText(ref);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const note = slip.status === 'HOLD'
    ? 'พักรอบนี้แล้ว — กดดึงเข้าคิวถ้าจะโอน (ยังไม่นับในยอดรอโอน)'
    : slip.status === 'ERR' || slip.status === 'ERROR'
      ? 'บัญชีรับยังไม่ตรงที่ปัก — ปักบัญชีแล้วกดดึงเข้าคิว'
      : queued
        ? `อยู่ในคิว · รอโอนรวม ${n(dueAll || due, 2)} USDT`
        : 'รายการนี้ปิดแล้ว';

  return (
    <article className="slip term" aria-labelledby={`slip-${slip.id}`}>
      <div className="slip-head">
        <BankLogo bankName={slip.bank} size="lg" />
        <span className="slip-title-wrap">
          <span id={`slip-${slip.id}`} className="slip-tag">{bank.code} · {statusLabel(slip.status)}</span>
          <span className="slip-bank-name">{bank.nameTh}</span>
        </span>
        <button type="button" className="slip-x" onClick={onClose} aria-label="ปิดรายละเอียดรายการ">ปิด</button>
      </div>
      <ol className="slip-rail" aria-label="สถานะรายการ 7 ขั้นตอน">
        {STEPS.map((s, i) => (
          <li key={s} className={i < active ? 'on' : ''} aria-current={i === active - 1 ? 'step' : undefined}>
            <span aria-hidden="true">{i < active ? '●' : '○'}</span>{s}
          </li>
        ))}
      </ol>
      <div className="slip-rule" />
      <div className="slip-row"><span>เวลา (TIME)</span><span>{slip.time || '—'}</span></div>
      <div className="slip-row"><span>เลขอ้างอิง (REF)</span><button type="button" className={'slip-copy' + (copied ? ' is-on' : '')} onClick={copyRef}>{copied ? 'คัดอยู่' : ref || '—'}</button></div>
      <div className="slip-row"><span>บัญชีรับ (PAYEE)</span><span>{payee || '—'}</span></div>
      <div className="slip-row"><span>ชื่อ (NAME)</span><span>{slip.name || '—'}</span></div>
      <div className="slip-rule" />
      <div className="slip-row"><span>รับเข้า (IN)</span><span className="in">{n(slip.thb)} THB</span></div>
      <div className="slip-row"><span>รอโอน (PAYOUT)</span><span className="due">{n(due ?? expected, 2)} USDT</span></div>
      <div className="slip-row"><span>โอนสำเร็จ (SENT)</span><span>{n(sent, 2)} USDT</span></div>
      <div className="slip-rule" />
      <div className="slip-row"><span>คิวรวม (QUEUE)</span><span>{queue?.count ?? 1} รายการ</span></div>
      <div className="slip-row"><span>รับรวม (TOTAL IN)</span><span className="in">{n(queue?.thb)} THB</span></div>
      <div className="slip-row"><span>รอโอนรวม (DUE)</span><span className="due">{n(dueAll, 2)} USDT</span></div>
      <div className="slip-row"><span>เป้าหมายกอง (TARGET)</span><span>{n(target)} THB</span></div>
      <div className="slip-row"><span>เหลืออีก (LEFT)</span><span>{n(left)} THB</span></div>
      <div className="slip-rule" />
      <p className="slip-note">{note}</p>
      {onKeep && slip.status !== 'DONE' ? (
        <>
          {keepErr ? <p className="slip-note" style={{ color: 'var(--danger,#ff453a)' }}>{keepErr}</p> : null}
          <button
            type="button"
            className="keep mt-3 w-full px-3 py-2 text-xs"
            disabled={keeping}
            onClick={async () => {
              setKeeping(true);
              setKeepErr(null);
              try {
                await onKeep();
              } catch (e: any) {
                setKeepErr(e?.message || 'ดึงเข้าคิวไม่สำเร็จ');
              } finally {
                setKeeping(false);
              }
            }}
          >
            {keeping ? 'กำลังดึง' : 'ดึงเข้าคิว'}
          </button>
        </>
      ) : queued ? <p className="slip-note">โอน USDT แล้วค่อยกด บันทึกส่งรวม</p> : null}
    </article>
  );
}
