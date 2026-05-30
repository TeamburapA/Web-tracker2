require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const sql = fs.readFileSync(path.join(__dirname, "../setup-keys-pool-db.sql"), "utf8");

async function run() {
  try {
    console.log("Calling rpc('exec', { query: ... }) using service role key...");
    const { data: res1, error: err1 } = await supabase.rpc("exec", { query: sql });
    console.log("rpc('exec') result:", res1);
    console.log("rpc('exec') error:", err1);
    
    if (err1) {
      console.log("Calling rpc('run_sql', { sql: ... })...");
      const { data: res2, error: err2 } = await supabase.rpc("run_sql", { sql: sql });
      console.log("rpc('run_sql') result:", res2);
      console.log("rpc('run_sql') error:", err2);
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
