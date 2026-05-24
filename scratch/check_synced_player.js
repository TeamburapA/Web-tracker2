require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data: player } = await supabase.from("players").select("*").eq("user_id", "999888777").maybeSingle();
    console.log("players record:", player);

    const { data: linkedAccount } = await supabase.from("user_roblox_accounts").select("*").eq("roblox_user_id", "999888777").maybeSingle();
    console.log("user_roblox_accounts link record:", linkedAccount);
  } catch (e) {
    console.error(e);
  }
}

run();
