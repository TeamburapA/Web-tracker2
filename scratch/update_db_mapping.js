require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Updating database records for Legacy Lobby...");
  
  // 1. Update game_places table
  const { data: updateGamePlace, error: err1 } = await supabase
    .from("game_places")
    .update({ place_name: "[LEGACY] Toilet Tower Defense" })
    .eq("place_id", "93712201161812")
    .select();
    
  console.log("game_places update result:", updateGamePlace);
  if (err1) console.error("Error updating game_places:", err1);

  // 2. Update players table (if any records had place_id 93712201161812)
  // Note: the player table doesn't have a place_name field directly, place_name is resolved via views or joins, 
  // but let's check if there are other places. Let's list players on that place.
  const { data: playersOnLobby, error: err2 } = await supabase
    .from("players")
    .select("user_id, name, place_id")
    .eq("place_id", "93712201161812");

  console.log("Players currently tracked on Place 93712201161812:", playersOnLobby);
  if (err2) console.error("Error querying players:", err2);
  
  console.log("Done.");
}

run().catch(console.error);
