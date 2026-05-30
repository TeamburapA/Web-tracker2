/**
 * setup-keys-pool.js
 * สร้างตาราง keys_pool และฟังก์ชันเติมสิทธิ์ใน Supabase
 * รันครั้งเดียว: node setup-keys-pool.js
 */
require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];

const sql = fs.readFileSync(path.join(__dirname, "setup-keys-pool-db.sql"), "utf8");

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
  console.log(`🔧 กำลังสร้างตาราง keys_pool + ปรับแต่ง db (project: ${projectRef})...`);

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
    console.log("✅ สร้างตารางและฟังก์ชันสำเร็จ!");
    console.log("📋 สิ่งที่ทำสำเร็จ:");
    console.log("   - ตาราง keys_pool (คลังคีย์)");
    console.log("   - ฟิลด์ expired_at ใน user_profiles");
    console.log("   - ฟังก์ชัน RPC redeem_script_key");
  } else {
    console.log(`⚠️  Status: ${res.status}`);
    console.log(res.raw);
    console.log("\n💡 หากสิทธิ์ล้มเหลว กรุณาทำตามวิธีนี้:");
    console.log("   คัดลอกคำสั่ง SQL ใน setup-keys-pool-db.sql ไปรันโดยตรงใน Supabase Dashboard → SQL Editor");
  }
}

main().catch(console.error);
