require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data, error } = await supabase.rpc("exec", { query: "select definition from pg_views where viewname = 'dashboard_player_places';" });
    console.log("View definition error:", error);
    console.log("View definition:", data);
    
    // Let's also query table columns for players and game_places
    const { data: tableCols, error: errCols } = await supabase.rpc("exec", { query: `
      select table_name, column_name, data_type 
      from information_schema.columns 
      where table_name in ('players', 'game_places', 'player_place_state');
    `});
    console.log("Columns:", tableCols);
  } catch (e) {
    console.error(e);
  }
}

run();
