require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data, error } = await supabase.from("keys_pool").select("*").limit(1);
    console.log("keys_pool error:", error);
    console.log("keys_pool data:", data);
  } catch (e) {
    console.error(e);
  }
}

run();
