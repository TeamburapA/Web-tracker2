require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const http = require("http");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PORT = 3000;

function sendPostRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ statusCode: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  try {
    // 1. Get a valid user profile with script_key
    console.log("1. Finding a valid user_profiles row...");
    const { data: profiles, error: profErr } = await supabase.from("user_profiles").select("user_id, script_key").limit(1);
    if (profErr || !profiles || !profiles.length) {
      console.error("No user profile found to test with! Create a user first.", profErr);
      return;
    }
    const testProfile = profiles[0];
    console.log(`Using user_id: ${testProfile.user_id}, script_key: ${testProfile.script_key}`);

    // 2. Mock payload for Survive Zombie Arena
    const payload = {
      script_key: testProfile.script_key,
      user_id: "999888777",
      name: "ZombieSlayer99",
      display_name: "The Zombie Killer",
      coins: 450,
      status: "Fighting Zombies",
      place_id: "114204398207377", // Survive Zombie Arena Place ID
      job_id: "test-job-uuid-123",
      inventory: [
        { item_id: "Credits", amount: 750 },
        { item_id: "VoidShards", amount: 15 },
        { item_id: "SelectedClass", text_value: "Marksman" }
      ]
    };

    console.log("2. Sending Survive Zombie Arena payload to /roblox/update...");
    const response = await sendPostRequest("/roblox/update", payload);
    console.log("Response status:", response.statusCode);
    console.log("Response body:", response.body);

    if (response.statusCode !== 200 || !response.body.ok) {
      console.error("Sync request failed!");
      return;
    }

    console.log("\n3. Querying DB to verify records...");
    
    // Check players
    const { data: player } = await supabase.from("players").select("*").eq("user_id", "999888777").single();
    console.log("players record:", player);

    // Check player_inventory
    const { data: inventory } = await supabase.from("player_inventory").select("*").eq("player_id", "999888777");
    console.log("player_inventory records:", inventory);

    // Check player_profiles
    const { data: playerProfile } = await supabase.from("player_profiles").select("*").eq("player_id", "999888777").single();
    console.log("player_profiles record:", playerProfile);

    // Check player_place_state
    const { data: placeState } = await supabase.from("player_place_state").select("*").eq("player_id", "999888777").single();
    console.log("player_place_state record:", placeState);

    // Check user_roblox_accounts (link table)
    const { data: linkedAccount } = await supabase.from("user_roblox_accounts")
      .select("*")
      .eq("user_id", testProfile.user_id)
      .eq("roblox_user_id", "999888777")
      .single();
    console.log("user_roblox_accounts link record:", linkedAccount);

    console.log("\n✅ Integration test finished successfully!");
  } catch (e) {
    console.error("Test failed with error:", e);
  }
}

run();
