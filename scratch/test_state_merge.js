require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const robloxIds = ['10971894488'];
  
  console.log("1. Querying player_profiles...");
  const { data: profiles, error: profErr } = await supabase
    .from("player_profiles")
    .select("player_id, username, display_name")
    .in("player_id", robloxIds);
  console.log("Profiles:", profiles, "Error:", profErr);

  console.log("2. Querying player_place_state...");
  const { data: states, error: stateErr } = await supabase
    .from("player_place_state")
    .select("player_id, place_id, job_id, status, coins, updated_at")
    .in("player_id", robloxIds);
  console.log("States:", states, "Error:", stateErr);
}

run().catch(console.error);
