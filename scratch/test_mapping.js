require("dotenv").config();
const handler = require("../server.js");

// We need a valid JWT token to fetch players. Since we don't have one easily here,
// we can also test the rowToPlayer function or mock the database response.
// Let's test the rowToPlayer function by modifying rowToPlayer to be exported or by calling getPlayersByUserId.
// Wait, can we test rowToPlayer directly? It's not exported. But we can test it by mocking verifyJwt and getSupabase.

// Let's create a script that calls the db and then passes the row to the rowToPlayer equivalent mapping to test it.
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "unknown": "Unknown Place"
};

function testMapping(row) {
  const rawUnits = {
    ...(row.units || {}),
    ...(row.utc != null ? { UTC: row.utc } : {}),
    ...(row.uts != null ? { UTS: row.uts } : {}),
    ...(row.cenima != null ? { Cenima: row.cenima } : {}),
    ...(row.cinema != null ? { Cinema: row.cinema } : {}),
    ...(row.titan != null ? { TITAN: row.titan } : {}),
  };

  const rawPlaceName = row.place_name || row.place_id;
  const placeName = KNOWN_MAPS[row.place_id] || (isNaN(rawPlaceName) ? rawPlaceName : KNOWN_MAPS[rawPlaceName]) || rawPlaceName;

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    displayName: row.display_name,
    coins: Number(row.coins || 0),
    status: row.status,
    placeId: row.place_id,
    placeName: placeName,
    jobId: row.job_id,
    units: rawUnits,
  };
}

async function run() {
  const { data } = await supabase.from("dashboard_player_places").select("*").limit(5);
  console.log("Original view rows:");
  console.log(data);
  
  console.log("\nMapped rows (what API returns):");
  if (data) {
    data.forEach(row => {
      const mapped = testMapping(row);
      console.log(`User: ${mapped.name}, Place ID: ${mapped.placeId}, Place Name: ${mapped.placeName}`);
    });
  }
}

run();
