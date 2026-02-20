# Pixel_Motion_Shop — Phase 1 (PromptPay manual verify)

สิ่งที่ได้:
- สมัคร/ล็อกอิน
- ผู้ขายลงสินค้า (อัปโหลดไฟล์ + รูปปก)
- ลูกค้ากดซื้อ → สร้างออเดอร์ → จ่าย PromptPay → อัปสลิป
- แอดมินกดยืนยัน → สถานะ paid → ลูกค้าดาวน์โหลดได้ทันที
- ไฟล์ถูกล็อกด้วย Supabase RLS (คนที่ไม่จ่ายจะ download ไม่ได้)

## A) ตั้งค่า Supabase (ทำบนมือถือได้)
1) สร้าง Project ใหม่ใน Supabase
2) ไปที่ **Project Settings → API**
   - คัดลอก **Project URL**
   - คัดลอก **anon public key**
3) ไปที่ **SQL Editor** แล้วรันไฟล์ `supabase_schema.sql`
4) ไปที่ **Storage** สร้าง buckets:
   - `product-files` = Private
   - `product-covers` = Public (แนะนำ)
   - `payment-slips` = Private

## B) ใส่ค่าใน `config.js`
แก้ 3 ช่องนี้:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PROMPTPAY_ID`

## C) ตั้ง Admin ครั้งแรก
1) เปิดเว็บ → สมัคร/ล็อกอิน (จะสร้าง row ใน `profiles`)
2) ที่ Supabase → Table Editor → `profiles`
3) แก้ role ของบัญชีคุณเป็น `admin`
4) เข้า `admin.html` เพื่ออนุมัติสลิป

## D) Deploy ขึ้น Cloudflare Pages
อัปโหลดโฟลเดอร์นี้ขึ้น Pages (Direct Upload) แล้วเปิด URL ที่ได้

หน้าเว็บ:
- `index.html` = Shop
- `seller.html` = Sell
- `orders.html` = My Orders
- `admin.html` = Admin