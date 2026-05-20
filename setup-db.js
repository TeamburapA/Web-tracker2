/**
 * setup-db.js
 * สร้างตาราง players ใน Supabase ผ่าน REST API
 * รันครั้งเดียว: node setup-db.js
 */

require("dotenv").config();
const https = require("https");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ดึง hostname จาก URL
const hostname = new URL(SUPABASE_URL).hostname;

const sql = `
create table if not exists players (
  id            text primary key,
  user_id       text not null,
  name          text not null default 'Unknown',
  display_name  text not null default '',
  coins         integer not null default 0,
  status        text not null default 'Online',
  place_id      text not null default '',
  job_id        text not null default '',
  utc           integer not null default 0,
  uts           integer not null default 0,
  titan         integer not null default 0,
  cenima        integer not null default 0,
  first_seen_at bigint not null,
  updated_at    bigint not null
);
`;

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log("🔧 สร้างตาราง players ใน Supabase...");

  const body = JSON.stringify({ query: sql });

  const result = await request(
    {
      hostname,
      path: "/rest/v1/rpc/exec",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  if (result.status === 200 || result.status === 204) {
    console.log("✅ สร้างตารางสำเร็จ!");
  } else {
    // Supabase anon key ไม่มีสิทธิ์ DDL — แสดง SQL ให้ user รันเอง
    console.log(`\n⚠️  ไม่สามารถสร้างตารางอัตโนมัติได้ (status: ${result.status})`);
    console.log("\n📋 กรุณาไป Supabase Dashboard → SQL Editor แล้วรัน SQL นี้:\n");
    console.log("─".repeat(60));
    console.log(sql.trim());
    console.log("─".repeat(60));
    console.log("\n🔗 ลิงก์ SQL Editor: https://supabase.com/dashboard/project/xeaibgpxbzdozbdihcbj/sql/new");
  }
}

main().catch(console.error);
