'use client';

import { useEffect, useState } from 'react';
import ApiMonitor, { type ApiEndpoint } from '@/components/ApiMonitor';
import { saveTyphoonKey } from '@/lib/desk/actions';

const SEED: ApiEndpoint[] = [
  { id: 'health', name: 'สถานะระบบ', url: '/api/health', method: 'GET', category: 'core', icon: '♥', description: 'ตรวจ Supabase, Telegram webhook และ environment ที่จำเป็น' },
  { id: 'vault', name: 'Vault queue', url: '/api/dashboard/vault?mode=pending', method: 'GET', category: 'dashboard', icon: '▣', description: 'ตรวจ queue และข้อมูลโต๊ะที่ต้องใช้ session ผู้ดูแล' },
  { id: 'rooms', name: 'ห้อง Telegram', url: '/api/dashboard/rooms', method: 'GET', category: 'dashboard', icon: '◉', description: 'ตรวจ room settings และห้องที่กำลังใช้งาน' },
  { id: 'bank-accounts', name: 'บัญชีธนาคาร', url: '/api/admin/bank-accounts', method: 'GET', category: 'core', icon: '◫', description: 'ตรวจ Supabase admin client และบัญชีที่ใช้รับเงิน' },
];

export default function DeskApiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [typhoonReady, setTyphoonReady] = useState(false);
  const [typhoonKey, setTyphoonKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  // The monitor intentionally uses this fixed read-only baseline. It prevents a
  // stale saved endpoint (such as a webhook POST) from triggering side effects.
  useEffect(() => {
    if (!open) return;
    fetch('/api/admin/settings', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => setTyphoonReady(Boolean(body?.data?.typhoonReady)))
      .catch(() => setTyphoonReady(false));
  }, [open]);


  async function saveTyphoon() {
    const value = typhoonKey.trim();
    if (!value) return;
    setSaving(true);
    setNote('');
    try {
      const result = await saveTyphoonKey(value);
      if (!result.ok) throw new Error(result.error);
      setTyphoonReady(true);
      setTyphoonKey('');
      setNote('เปิดอ่านสลิปแล้ว');
    } catch {
      setNote('คีย์ไม่ผ่าน ตรวจแล้ววางใหม่');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <section className="desk-api-panel" aria-label="ตรวจสอบรายการ">
      <div className="desk-api-panel__bar">
        <strong>ตรวจสอบรายการ</strong>
        <button type="button" className="qd-pill" onClick={onClose}>ปิด</button>
      </div>
      <form
        className="desk-api-panel__keys"
        onSubmit={(e) => {
          e.preventDefault();
          void saveTyphoon();
        }}
      >
        <label>
          คีย์ Typhoon สำหรับอ่านสลิป
          <span className={typhoonReady ? 'ok' : 'wait'}>{typhoonReady ? 'พร้อมอ่าน' : 'ยังไม่มีคีย์'}</span>
        </label>
        <div className="desk-api-panel__row">
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={typhoonKey}
            onChange={(e) => setTyphoonKey(e.target.value)}
            aria-label="คีย์ Typhoon"
          />
          <button type="submit" className="qd-pill" disabled={saving || !typhoonKey.trim()}>
            {saving ? 'กำลังเปิด OCR' : 'เปิดอ่านสลิป'}
          </button>
        </div>
        {note ? <p>{note}</p> : null}
      </form>
      <p className="desk-api-panel__hint">ตรวจข้อมูลจริงจาก production ทุก 30 วินาที — Webhook ตรวจผ่านสถานะระบบ เพื่อไม่ส่ง request เปล่าไปยัง Telegram</p>
      <ApiMonitor endpoints={SEED} autoRefreshMs={30_000} storageKey="ct.apiMonitor.v3" />
    </section>
  );
}