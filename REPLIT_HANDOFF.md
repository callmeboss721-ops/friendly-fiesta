# CE EMPIRE / CE Vault — Replit Handoff

วันที่จัดทำ: 2026-09-13
Repository: `callmeboss721-ops/friendly-fiesta`
Working branch: `v0/ce-empire-2026-p0`
Latest saved commit: `9852efe` (`Harden Supabase Telegram runtime flow`)
Production URL: https://installation-plum.vercel.app/

## เป้าหมาย
ทำให้ CE EMPIRE / CE Vault ทำงานจริงบนสถาปัตยกรรมเดิม:

- Vercel/Next.js
- Supabase Postgres
- Supabase RPC
- Supabase Storage สำหรับรูปสลิป
- Telegram Bot webhook
- Dashboard / monitor

ห้าม migrate ไป Neon, ห้ามเปลี่ยน business logic settlement และห้ามใช้ localStorage เป็นฐานข้อมูลหลัก

## สถานะปัจจุบัน
ทำแล้วใน branch นี้:

- Supabase admin client รองรับ `SUPABASE_SECRET_KEY` และ legacy `SUPABASE_SERVICE_ROLE_KEY`
- ไม่ hardcode หรือพิมพ์ secret ใน source/log/UI
- เพิ่ม `isSupabaseAdminConfigured()` เพื่อแยกสถานะ config ออกจาก client initialization
- Telegram bucket อ่านจาก `SUPABASE_BUCKET`
- production webhook ถูกกำหนดเป็น:
  `https://installation-plum.vercel.app/api/telegram/webhook`
- `/api/health` ตรวจ Supabase admin configuration และ required tables แบบไม่เปิดเผย credential
- restore source files ที่เคยว่างจาก merge conflict
- typecheck และ diff safety ผ่านก่อน sync ล่าสุด

ยังไม่ถือว่า production ทำงาน 100% เพราะใน session นี้ผู้ใช้เลือกไม่เชื่อม integration และไม่เพิ่ม environment variables จึงยังตรวจ Supabase project จริง, RPC, Storage upload, Telegram API และ deployment runtime ไม่ได้

## Environment Variables ที่ต้องตั้งใน Replit/Vercel
ห้ามส่งค่าจริงในแชตหรือ commit ลง Git ให้ตั้งเป็น secret/environment variable เท่านั้น

### Required
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (ลำดับแรก)
- `SUPABASE_SERVICE_ROLE_KEY` (legacy fallback ถ้าไม่มี `SUPABASE_SECRET_KEY`)
- `SUPABASE_BUCKET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

### Production URL / webhook
- `APP_URL=https://installation-plum.vercel.app`
- ต้องตั้ง webhook ไปที่:
  `https://installation-plum.vercel.app/api/telegram/webhook`
- ห้ามใช้ localhost หรือ preview URL เป็น production webhook

ตรวจชื่อ env ที่ source ใช้จริงทั้งหมดก่อน deploy:
```bash
grep -R "process.env\|envValue\|getSupabase" -n src app scripts --exclude-dir=node_modules
```

## Supabase schema ที่ต้องมี
ตรวจสอบใน Supabase project ที่ production ใช้จริงว่ามีตารางเหล่านี้:

- `admins`
- `bank_accounts`
- `pinned_bank_accounts`
- `receivers`
- `transactions`
- `transaction_status_logs`
- `rates`
- `bot_sessions`
- `chat_settings`
- `telegram_updates`
- `system_settings`

และ RPC:

```sql
claim_telegram_update(p_update_id bigint)
```

ถ้าขาด ให้สร้าง migration แบบปลอดภัยด้วย `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` และ `CREATE OR REPLACE FUNCTION` เท่านั้น ห้าม DROP database/table, reset project หรือทำลายข้อมูล production

## Telegram workflow ที่ต้องทำงานจริง

1. Telegram ส่ง update ไป `POST /api/telegram/webhook`
2. Route ตรวจ `x-telegram-bot-api-secret-token` เทียบกับ `TELEGRAM_WEBHOOK_SECRET`
3. Parse update และเรียก Supabase RPC `claim_telegram_update(update_id)`
4. ถ้า update ซ้ำ ต้อง acknowledge และไม่ประมวลผลซ้ำ
5. แยกประเภท update:
   - ข้อความ
   - callback query
   - รูปสลิป
6. อ่าน/เขียน session ใน `bot_sessions`
7. อ่าน/เขียน chat settings ใน `chat_settings`
8. อ่าน system settings ใน `system_settings`
9. เมื่อมีรูปสลิป:
   - download file จาก Telegram
   - upload เข้า Supabase Storage bucket จาก `SUPABASE_BUCKET`
   - บันทึก URL/path และ metadata ลง transaction flow
10. OCR / match / settlement ใช้ business logic เดิม
11. เขียน transaction และ status logs
12. แก้ข้อความ Telegram ตามสถานะจริงเท่านั้น ไม่ใช้ fake loading หรือ fake delay
13. ส่งผลลัพธ์พร้อม reference/audit data
14. ตอบ HTTP status ที่เหมาะสมเสมอ เพื่อป้องกัน Telegram retry ที่ไม่จำเป็น

## Dashboard / monitor routes ที่ต้องตรวจ
- `/api/health`
- `/api/dashboard/vault`
- `/api/dashboard/rooms`
- `/api/admin/bank-accounts`
- `/api/telegram/webhook`
- `/api/telegram/set-webhook`

`/api/health` ต้องตอบสถานะโดยไม่เปิดเผย URL/key/token และควรแยกได้ว่า:

- application running
- Supabase admin configured
- database reachable
- required schema available

## UI / effects ที่ต้องรักษา
Dashboard mobile-first ที่ 393×852 เป็นหลัก:

- navy / cyan / gold premium fintech visual system
- bank identity เดียวกันใน pinned accounts, queue, slip detail และ Telegram card
- status rail 7 stages:
  `BANK → PIN → DEPOSIT → OCR → MATCH → SETTLE → AUDIT`
- effect ต้องผูกกับสถานะจริง เช่น flash เมื่อรายการเปลี่ยน, inline progress เมื่อ OCR/match ทำงาน
- ห้าม fullscreen loader, splash screen, fake loading copy หรือหน่วงเวลาเพื่อสร้างภาพลวงตา
- ทุก interactive control อย่างน้อย 44px
- รองรับ `prefers-reduced-motion`
- ห้าม horizontal overflow บน mobile

## Money safety
- ใช้ `decimal.js` หรือ PostgreSQL `NUMERIC`
- สูตรเดิม: `USDT = THB / roomRate`
- rounding: `ROUND_HALF_UP`, 2 decimals
- ห้ามใช้ JavaScript floating point ใน settlement
- ห้ามเปลี่ยน settlement semantics โดยไม่จำเป็น

## Files สำคัญ

### Supabase / runtime
- `src/lib/supabaseAdmin.ts`
- `src/lib/runtimeEnv.ts`
- `src/lib/telegram.ts`
- `src/lib/botSessions.ts`

### Telegram routes
- `app/api/telegram/webhook/route.ts`
- `app/api/telegram/set-webhook/route.ts`

### Dashboard
- `app/api/health/route.ts`
- `app/api/dashboard/vault/route.ts`
- `app/api/dashboard/rooms/route.ts`
- `app/api/admin/bank-accounts/route.ts`
- `app/page.tsx`

### Presentation / effects
- `src/lib/bankBrands.ts`
- `src/components/BankLogo.tsx`
- `src/components/PinnedAccounts.tsx`
- `src/components/ct/TransactionFlow.tsx`
- `src/components/ct/SlipCard.tsx`
- `src/lib/ct/tokens.ts`
- `src/lib/ct/copy.ts`
- `src/lib/ct/cardJson.ts`
- `src/lib/ct/cardImage.ts`

## Local verification checklist
รันจาก project root:

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm test
```

ถ้ามี scripts เหล่านี้ ให้รันเพิ่ม:

```bash
npm run validate:banks
npm run validate:env
npm run tokens:build -- --check
```

ตรวจ production หลังตั้ง env:

```bash
curl -i https://installation-plum.vercel.app/api/health
curl -i https://installation-plum.vercel.app/api/dashboard/vault
curl -i https://installation-plum.vercel.app/api/dashboard/rooms
curl -i https://installation-plum.vercel.app/api/admin/bank-accounts
```

อย่าทดสอบ webhook ด้วย update จริงจนกว่าจะตั้ง secret และตรวจ duplicate claim แล้ว ใช้ Telegram `setWebhook` ด้วย production URL เท่านั้น

## สิ่งที่ต้องทำต่อใน Replit

1. Import repository และ checkout branch `v0/ce-empire-2026-p0`
2. ตั้ง env secrets ตามรายการด้านบน ห้ามใส่ค่าใน source
3. ตรวจ source ทุกจุดที่อ่าน Supabase/Telegram env
4. ตรวจ schema จริงจาก Supabase และสร้าง safe migration เฉพาะสิ่งที่ขาด
5. ตรวจ RPC `claim_telegram_update` และทดสอบ duplicate update สองครั้ง
6. ทดสอบ Storage upload ด้วยไฟล์สลิป test ที่ไม่ใช่ข้อมูลจริง
7. ตรวจ webhook secret rejection/acceptance
8. ทดสอบ bot ครบ message, callback, photo, session, settings, transaction
9. ทดสอบ Dashboard และ monitor บน mobile 393×852
10. แก้ typecheck/lint/build/test จนผ่านทั้งหมด
11. deploy production
12. ตรวจ `/api/health` และ routes จริงหลัง deploy
13. ตรวจ Telegram webhook status และส่ง test update จริง

## ข้อควรระวัง

- ค่าที่ผู้ใช้เคยเปิดเผยในแชตให้ถือว่า compromised และควร rotate ใหม่
- ห้ามใส่ service-role key, bot token หรือ webhook secret ใน commit/log/screenshot
- ห้ามรายงานว่า production ใช้งานได้ 100% จนกว่าจะตรวจด้วย credentials จริงและทดสอบ webhook/Storage จริง
- อย่าเพิ่ม Neon หรือ `DATABASE_URL` เป็น dependency หลัก
- อย่าลบ migration เดิมหรือข้อมูล production

## Git handoff

Branch ล่าสุด:
`v0/ce-empire-2026-p0`

Commit ล่าสุด:
`9852efe Harden Supabase Telegram runtime flow`

ไฟล์นี้เป็น handoff เท่านั้น ไม่ได้บรรจุ secret ใด ๆ
ของที่ต้องส่งต่อไป Replit คือ repository + environment variables ที่ตั้งผ่าน secret manager เท่านั้น

## คำสั่งเริ่มต้นใน Replit

```bash
npm install
npm run typecheck
npm run build
npm test
```

จากนั้นทำตามหัวข้อ “สิ่งที่ต้องทำต่อใน Replit” ตามลำดับ

ไม่ควรเริ่มด้วยการ migrate database หรือเปลี่ยน architecture ก่อนตรวจ env, schema, RPC และ webhook production URL
เหมาะสมที่สุดคือซ่อม integration/runtime ให้ผ่านก่อน แล้วจึงค่อยปรับ UI/effects เพิ่มเติม

---

สถานะสรุป: code ถูกเตรียม handoff แล้ว แต่ production integration ยังต้องตั้งค่าและทดสอบใน environment ใหม่ด้วย secrets ที่ถูกต้อง
