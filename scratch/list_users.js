require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) {
      console.error("Error listing users:", error);
    } else {
      console.log("Registered Users:");
      users.forEach(u => {
        console.log(`- ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}`);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

run();
