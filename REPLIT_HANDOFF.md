# CE EMPIRE — Replit Quick Start

โปรเจกต์นี้ใช้ **Next.js + Supabase + Telegram Bot** เท่านั้น ห้ามย้ายไป Neon

## ติดตั้ง

1. Import repository `callmeboss721-ops/friendly-fiesta` เข้า Replit
2. เลือก branch `v0/ce-empire-2026-p0`
3. กด Run — Replit ใช้ไฟล์ `.replit` ให้อัตโนมัติ
4. ตั้งค่า Secrets ใน Replit ห้ามใส่ใน source code

## Secrets ที่ต้องใส่

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_BUCKET
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
APP_URL
ADMIN_TELEGRAM_IDS
```

ใช้ `SUPABASE_SECRET_KEY` ก่อน หากไม่มีจึงใช้ `SUPABASE_SERVICE_ROLE_KEY` ได้

## คำสั่งตรวจสอบ

```bash
npm install
npm run typecheck
npm run test
npm run build
```

## Telegram

Webhook production:

```text
https://installation-plum.vercel.app/api/telegram/webhook
```

Flow: Telegram update → ตรวจ secret → Supabase RPC `claim_telegram_update` → กัน update ซ้ำ → session/settings → รับข้อความ/callback/สลิป → upload Supabase Storage → บันทึก transaction/status log → ตอบ Telegram

## Supabase ต้องมี

ตาราง: `admins`, `bank_accounts`, `pinned_bank_accounts`, `receivers`, `transactions`, `transaction_status_logs`, `rates`, `bot_sessions`, `chat_settings`, `telegram_updates`, `system_settings`

RPC: `claim_telegram_update(bigint)`

## ตรวจหลังรัน

```text
/
/api/health
/api/dashboard/vault
/api/dashboard/rooms
/api/admin/bank-accounts
```

ห้ามใช้ localhost หรือ preview URL เป็น Telegram production webhook และห้าม commit secrets.
