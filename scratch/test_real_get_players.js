require("dotenv").config();
const handler = require("../server");

async function run() {
  const userId = "c18ea653-ff5c-4be6-ac3b-d54e47ef6000"; // Let's check if we can query this user profile or we can find user ids first.
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  
  const testUserId = "214cccac-5fb1-4e4f-9b82-d9f9e7251c1c";
  console.log(`Testing with user_id: ${testUserId}`);
  
  const result = await handler.getPlayersByUserId(testUserId);
  console.log("API Players list:\n", JSON.stringify(result, null, 2));
}

run().catch(console.error);
