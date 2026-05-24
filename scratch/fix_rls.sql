-- ════════════════════════════════════════════════════════
--  Supabase SQL Script — Fix RLS Policies for Web Tracker
-- ════════════════════════════════════════════════════════
--
--  รันคำสั่งเหล่านี้ใน Supabase SQL Editor เพื่อแก้ไขสิทธิ์
--  เนื่องจากระบบ Tracker หลังบ้านรันจากสคริปต์ Roblox (Anonymous Client Key)
--
--  ลิงก์ SQL Editor: https://supabase.com/dashboard/project/xeaibgpxbzdozbdihcbj/sql/new
-- ────────────────────────────────────────────────────────

-- 1. ปิดระบบ RLS สำหรับตารางที่ต้องเขียนข้อมูลผ่าน Roblox API (หรือตั้ง Policy ให้เขียนได้)
ALTER TABLE public.game_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_places DISABLE ROW LEVEL SECURITY;

-- 2. เพื่อความแน่ใจ ตรวจสอบโครงสร้าง Foreign Key ของ player_inventory
-- หาก RLS ถูกปิดแล้ว ข้อมูล Inventory ของแมพใหม่ (เช่น Survive Zombie Arena) จะไหลเข้าสู่ระบบทันที!
