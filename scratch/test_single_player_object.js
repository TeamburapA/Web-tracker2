require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "11654637731": "[LEGACY] Toilet Tower Defense",
  "114204398207377": "Survive Zombie Arena",
  "98927955463992": "Survive Zombie Arena",
  "unknown": "Unknown Place"
};

function normalizeItemName(name) {
  if (name === "TITAN" || name === "Cenima") return "Cinema";
  const s = String(name || "").trim();
  if (s === "Credits" || s === "credits") return "Credits";
  if (s === "VoidShards" || s === "voidshards" || s === "void_shards") return "VoidShards";
  if (s === "Class" || s === "class" || s === "SelectedClass") return "Class";
  return s;
}

function itemNameFromId(itemId) {
  const id = String(itemId || "").toLowerCase();
  if (id === "utc") return "UTC";
  if (id === "uts") return "UTS";
  if (id === "cinema" || id === "cenima" || id === "titan") return "Cinema";
  if (id === "credits") return "Credits";
  if (id === "voidshards" || id === "void_shards") return "VoidShards";
  if (id === "class" || id === "selectedclass") return "Class";
  return String(itemId || "");
}

function normalizeUnitsObject(units) {
  const out = {};
  for (const [key, value] of Object.entries(units || {})) {
    const name = normalizeItemName(key);
    if (name === "Class") {
      out.Class = String(value || "None");
    } else {
      const num = Number(value || 0);
      if (name === "Cinema") {
        out.Cinema = Math.max(out.Cinema || 0, num);
      } else {
        out[name] = num;
      }
    }
  }
  return out;
}

async function getSinglePlayersFromInventory(robloxIds) {
  if (!robloxIds || robloxIds.length === 0) return [];

  // 1. Fetch player profiles
  const { data: profiles, error: profErr } = await supabase
    .from("player_profiles")
    .select("player_id, username, display_name")
    .in("player_id", robloxIds);

  if (profErr) throw profErr;
  if (!profiles || profiles.length === 0) return [];

  const profileMap = {};
  profiles.forEach(p => {
    profileMap[p.player_id] = p;
  });

  // 2. Fetch all place states
  const { data: states, error: stateErr } = await supabase
    .from("player_place_state")
    .select("player_id, place_id, job_id, status, coins, updated_at")
    .in("player_id", robloxIds);

  if (stateErr) throw stateErr;

  // 3. Fetch all inventory items
  const { data: invItems, error: invErr } = await supabase
    .from("player_inventory")
    .select("*")
    .in("player_id", robloxIds);

  if (invErr) throw invErr;

  // 4. Fetch place names
  const placeIds = [...new Set(states.map(s => s.place_id).filter(Boolean))];
  let placeNameById = {};
  if (placeIds.length) {
    const { data: places } = await supabase
      .from("game_places")
      .select("place_id, place_name")
      .in("place_id", placeIds);
    if (places) {
      placeNameById = Object.fromEntries(places.map(p => [p.place_id, p.place_name]));
    }
  }

  // Helper to resolve map name
  function resolveMapName(placeId) {
    const rawPlaceName = placeNameById[placeId] || placeId;
    return KNOWN_MAPS[placeId] || (isNaN(rawPlaceName) ? rawPlaceName : KNOWN_MAPS[rawPlaceName]) || rawPlaceName;
  }

  // 5. Construct one player object per roblox ID
  return robloxIds.map(robloxId => {
    const pProfile = profileMap[robloxId];
    if (!pProfile) return null;

    // Filter states for this player and sort by updated_at descending to find the latest active state
    const pStates = (states || []).filter(s => s.player_id === robloxId);
    if (pStates.length === 0) return null;

    pStates.sort((a, b) => {
      const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return timeB - timeA;
    });

    const latestState = pStates[0];

    // Merge all inventory items across all place IDs for this player
    const pItems = (invItems || []).filter(item => item.player_id === robloxId);
    
    // Sort items by update time ascending so latest overwrites
    pItems.sort((a, b) => {
      const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return timeA - timeB;
    });

    const units = {};
    pItems.forEach(item => {
      const displayName = itemNameFromId(item.item_id);
      if (item.text_value !== null && item.text_value !== undefined && item.text_value !== "") {
        units[displayName] = item.text_value;
      } else {
        units[displayName] = Number(item.amount || 0);
      }
    });

    const mapName = resolveMapName(latestState.place_id);

    return {
      id: robloxId, // Unique ID is now simply the Roblox UserID!
      userId: robloxId,
      name: pProfile.username,
      displayName: pProfile.display_name,
      coins: Number(latestState.coins || 0),
      status: latestState.status,
      placeId: latestState.place_id,
      placeName: mapName,
      jobId: latestState.job_id || "",
      units: normalizeUnitsObject(units),
      firstSeenAt: latestState.updated_at ? new Date(latestState.updated_at).getTime() : 0,
      updatedAt: latestState.updated_at ? new Date(latestState.updated_at).getTime() : 0,
    };
  }).filter(Boolean);
}

async function run() {
  const result = await getSinglePlayersFromInventory(['10971894488']);
  console.log("Resulting single player object:\n", JSON.stringify(result, null, 2));
}

run().catch(console.error);
