require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Checking all inventory for player 10971894488...");
  const { data: inv, error: err1 } = await supabase
    .from("player_inventory")
    .select("*")
    .eq("player_id", "10971894488");

  console.log("Inventory entries:", inv);
  if (err1) console.error("Error:", err1);

  console.log("Checking players table entry for 10971894488...");
  const { data: player, error: err2 } = await supabase
    .from("players")
    .select("*")
    .eq("user_id", "10971894488");

  console.log("Players entry:", player);
  if (err2) console.error("Error:", err2);
}

run().catch(console.error);
