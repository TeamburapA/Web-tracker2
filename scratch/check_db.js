require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE config");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    console.log("Querying first 5 players...");
    const { data: players, error: err1 } = await supabase.from("players").select("*").limit(5);
    console.log("players error:", err1);
    console.log("players data:", players);

    console.log("Querying first 5 game_places...");
    const { data: places, error: err2 } = await supabase.from("game_places").select("*").limit(5);
    console.log("game_places error:", err2);
    console.log("game_places data:", places);

    console.log("Querying first 5 dashboard_player_places...");
    const { data: viewData, error: err3 } = await supabase.from("dashboard_player_places").select("*").limit(5);
    console.log("dashboard_player_places error:", err3);
    console.log("dashboard_player_places data:", viewData);
  } catch (e) {
    console.error("Error running script:", e);
  }
}

run();
