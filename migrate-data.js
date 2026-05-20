/**
 * migrate-data.js
 * อ่านข้อมูลจาก data.json แล้วอัปโหลดขึ้น Supabase
 * รันครั้งเดียว: node migrate-data.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function migrate() {
  const dataFile = path.join(__dirname, "data.json");

  if (!fs.existsSync(dataFile)) {
    console.error("❌ data.json not found");
    process.exit(1);
  }

  const store = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const players = Object.values(store.players || {});

  if (players.length === 0) {
    console.log("⚠️  ไม่มีข้อมูลใน data.json");
    return;
  }

  console.log(`📦 พบข้อมูล ${players.length} player(s) ใน data.json`);

  const rows = players.map((p) => ({
    id: String(p.id),
    user_id: String(p.userId || p.id),
    name: p.name || "Unknown",
    display_name: p.displayName || "",
    coins: Number(p.coins || 0),
    status: p.status || "Online",
    place_id: String(p.placeId || ""),
    job_id: String(p.jobId || ""),
    utc: Number((p.units || {}).UTC || 0),
    uts: Number((p.units || {}).UTS || 0),
    titan: Number((p.units || {}).TITAN || 0),
    cenima: Number((p.units || {}).Cenima || 0),
    first_seen_at: Number(p.firstSeenAt || Date.now()),
    updated_at: Number(p.updatedAt || Date.now()),
  }));

  const { data, error } = await supabase
    .from("players")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }

  console.log(`✅ Migration สำเร็จ! อัปโหลด ${rows.length} player(s) ขึ้น Supabase แล้ว`);
  rows.forEach((r) => console.log(`   - ${r.name} (${r.id})`));
}

migrate().catch((err) => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});
