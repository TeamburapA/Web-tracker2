require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

async function run() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  
  // Since we cannot select from auth.users directly via standard select (due to RLS/schema limitations on client),
  // let's try calling pg_catalog or check if we can query user profiles or user emails.
  // Wait, let's look at the user profiles or we can query auth.users using a raw sql query if we have a way,
  // or we can use admin auth API!
  const { data: { users }, error } = await db.auth.admin.listUsers();
  console.log("Users:", users?.map(u => ({ id: u.id, email: u.email })));
  console.log("Error:", error);
}

run().catch(console.error);
