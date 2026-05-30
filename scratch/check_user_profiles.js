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
    console.log("Querying user_profiles...");
    const { data: userProfiles, error: err1 } = await supabase.from("user_profiles").select("*").limit(5);
    console.log("user_profiles error:", err1);
    console.log("user_profiles data:", userProfiles);
  } catch (e) {
    console.error("Error running script:", e);
  }
}

run();
