/**
 * setup-roblox-tables.js
 * แสดง SQL สำหรับสร้างตาราง players และ player_inventory
 * สำหรับ Schema ใหม่ที่รองรับ Dynamic Inventory จาก Roblox Script
 *
 * รัน: node setup-roblox-tables.js
 */

const SQL = `
-- ════════════════════════════════════════════════════════
--  ตาราง players  — ข้อมูลหลักของผู้เล่น
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS players (
  user_id       TEXT        PRIMARY KEY,          -- Roblox UserId (string)
  name          TEXT        NOT NULL DEFAULT 'Unknown',
  display_name  TEXT        NOT NULL DEFAULT '',
  coins         NUMERIC     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'Online',
  place_id      TEXT        NOT NULL DEFAULT 'unknown',
  job_id        TEXT        NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════
--  ตาราง player_inventory  — Dynamic Key-Value ต่อแมพ
-- ════════════════════════════════════════════════════════
--
--  Composite PK: (player_id, place_id, item_id)
--  ช่อง amount     → สำหรับไอเท็มประเภทตัวเลข  (เช่น credits = 150)
--  ช่อง text_value → สำหรับไอเท็มประเภท string (เช่น class = "Warrior")
-- ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS player_inventory (
  player_id    TEXT        NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
  place_id     TEXT        NOT NULL,
  item_id      TEXT        NOT NULL,
  amount       NUMERIC,
  text_value   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (player_id, place_id, item_id)
);

-- Index ช่วยค้นหาเร็วเมื่อ query ตาม place หรือ item
CREATE INDEX IF NOT EXISTS idx_inv_place_id  ON player_inventory(place_id);
CREATE INDEX IF NOT EXISTS idx_inv_item_id   ON player_inventory(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_player_id ON player_inventory(player_id);
`;

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║   Roblox Tracker — Setup SQL (players + inventory)   ║");
console.log("╚══════════════════════════════════════════════════════╝\n");
console.log("📋 กรุณา copy SQL ด้านล่างนี้แล้วรันใน Supabase SQL Editor:\n");
console.log("🔗 https://supabase.com/dashboard/project/xeaibgpxbzdozbdihcbj/sql/new\n");
console.log("─".repeat(60));
console.log(SQL.trim());
console.log("─".repeat(60));
console.log("\n✅ หลังจากรัน SQL แล้ว สามารถใช้ /roblox/update endpoint ได้ทันที");
