require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

async function checkAll() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  
  // Get all user roblox accounts linkings
  const { data: accounts } = await db.from("user_roblox_accounts").select("*");
  console.log("Roblox accounts:", accounts);

  // For each user profile, check what players get returned
  const { data: profiles } = await db.from("user_profiles").select("*");
  for (const prof of profiles || []) {
    console.log(`\n--- Checking user ${prof.user_id} ---`);
    const { data: links } = await db.from("user_roblox_accounts").select("roblox_user_id").eq("user_id", prof.user_id);
    const robloxIds = (links || []).map(l => l.roblox_user_id);
    console.log("Linked Roblox IDs:", robloxIds);
    if (robloxIds.length > 0) {
      // Test getPlayersFromInventory
      try {
        const playersData = await db.from("players").select("*").in("user_id", robloxIds);
        console.log(`Players found in 'players' table (${playersData.data?.length || 0}):`, playersData.data);
        
        // Let's run getPlayersFromInventory-like logic
        const playerIds = (playersData.data || []).map(p => p.user_id);
        const { data: invData } = await db.from("player_inventory").select("*").in("player_id", playerIds);
        console.log(`Inventory records (${invData?.length || 0}):`, invData);
        
        const { data: places } = await db.from("game_places").select("*").in("place_id", (playersData.data || []).map(p => p.place_id));
        console.log(`Places info:`, places);
      } catch (err) {
        console.error("Error checking inventory path:", err);
      }
    }
  }
}

checkAll().catch(console.error);
