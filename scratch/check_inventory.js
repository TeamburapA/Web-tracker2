require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data: cols, error: errCols } = await supabase.rpc("exec", { query: `
      select table_name, column_name, data_type 
      from information_schema.columns 
      where table_name = 'player_inventory';
    `});
    console.log("player_inventory columns error:", errCols);
    console.log("player_inventory columns:", cols);

    const { data: rows, error: errRows } = await supabase.from("player_inventory").select("*").limit(5);
    console.log("player_inventory rows error:", errRows);
    console.log("player_inventory rows:", rows);
  } catch (e) {
    console.error(e);
  }
}

run();
