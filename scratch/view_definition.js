require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

async function run() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  
  // Query view definition using a basic select from pg_catalog
  // Since we don't have rpc "exec", let's see if we can do it via a custom query if we have service key.
  // Actually, we can query it using direct REST API or postgres tables.
  // Let's query information_schema or pg_views.
  const { data, error } = await db.from("dashboard_player_places").select("*").limit(1);
  console.log("dashboard_player_places schema sample:", data);
  console.log("dashboard_player_places error:", error);
}

run().catch(console.error);
