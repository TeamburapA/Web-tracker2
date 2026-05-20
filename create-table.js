/**
 * create-table.js  — สร้างตาราง players ผ่าน Supabase Management API
 * ต้องใช้ SERVICE_ROLE_KEY (ไม่ใช่ anon key)
 *
 * วิธีหา Service Role Key:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 */
require("dotenv").config();
const https = require("https");

// ใช้ service role key ถ้ามี ไม่งั้นใช้ anon (จะ fail ถ้า RLS บล็อก DDL)
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];

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

function httpPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, raw: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const body = JSON.stringify({ query: sql });

  console.log(`🔧 รัน SQL ผ่าน Management API (project: ${projectRef})...`);

  const res = await httpPost(
    {
      hostname: "api.supabase.com",
      path: `/v1/projects/${projectRef}/database/query`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  if (res.status === 200 || res.status === 201) {
    console.log("✅ สร้างตารางสำเร็จ!");
    console.log(res.raw);
  } else {
    console.log(`⚠️  Status: ${res.status}`);
    console.log(res.raw);

    if (res.status === 401 || res.status === 403) {
      console.log("\n💡 ต้องใช้ Service Role Key ครับ ลองวิธีนี้:");
      console.log("1. ไปที่ Supabase Dashboard → Project Settings → API");
      console.log("2. Copy ค่า 'service_role' key (อย่าแชร์ให้ใคร)");
      console.log("3. เพิ่มใน .env: SUPABASE_SERVICE_KEY=<key ที่ copy มา>");
      console.log("4. รัน: node create-table.js อีกครั้ง");
    }
  }
}

main().catch(console.error);
