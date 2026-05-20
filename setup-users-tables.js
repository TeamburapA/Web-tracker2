/**
 * setup-users-tables.js
 * สร้าง tables สำหรับระบบ user + script_key
 * รันครั้งเดียว: node setup-users-tables.js
 */
require("dotenv").config();
const https = require("https");

const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];

const sql = `
-- user_profiles: เก็บ script_key ของแต่ละ web user
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  script_key TEXT        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_roblox_accounts: Roblox accounts ที่ link กับ web user แต่ละคน
CREATE TABLE IF NOT EXISTS public.user_roblox_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roblox_user_id  TEXT        NOT NULL,
  roblox_username TEXT        NOT NULL DEFAULT '',
  display_name    TEXT        NOT NULL DEFAULT '',
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, roblox_user_id)
);

-- Trigger: auto-สร้าง profile เมื่อมี user สมัครใหม่
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, script_key)
  VALUES (NEW.id, replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: สร้าง profile ให้ users ที่มีอยู่แล้วก่อนติดตั้ง trigger
INSERT INTO public.user_profiles (user_id, script_key)
SELECT id, replace(gen_random_uuid()::text, '-', '')
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
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
  console.log(`🔧 สร้างตาราง user_profiles + user_roblox_accounts (project: ${projectRef})...`);

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
    console.log("📋 Tables ที่สร้าง:");
    console.log("   - user_profiles (user_id, script_key)");
    console.log("   - user_roblox_accounts (user_id, roblox_user_id, ...)");
    console.log("   - trigger: on_auth_user_created");
  } else {
    console.log(`⚠️  Status: ${res.status}`);
    console.log(res.raw);
    if (res.status === 401 || res.status === 403) {
      console.log("\n💡 ต้องใช้ SERVICE_ROLE_KEY ครับ:");
      console.log("   Supabase Dashboard → Project Settings → API → service_role");
    }
  }
}

main().catch(console.error);
