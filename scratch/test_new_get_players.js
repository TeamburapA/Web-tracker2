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

function normalizeItemId(name) {
  return normalizeItemName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

async function getPlayersFromInventory(robloxIds) {
  if (!robloxIds || robloxIds.length === 0) return [];

  // 1. Query player profiles
  const { data: profiles, error: profErr } = await supabase
    .from("player_profiles")
    .select("player_id, username, display_name")
    .in("player_id", robloxIds);

  if (profErr) throw profErr;
  if (!profiles || profiles.length === 0) return [];

  // Create a profile map for fast lookup
  const profileMap = {};
  profiles.forEach(p => {
    profileMap[p.player_id] = p;
  });

  // 2. Query player place states (all maps ever played)
  const { data: states, error: stateErr } = await supabase
    .from("player_place_state")
    .select("player_id, place_id, job_id, status, coins, updated_at")
    .in("player_id", robloxIds);

  if (stateErr) throw stateErr;
  if (!states || states.length === 0) return [];

  // 3. Query all inventory items across these maps
  const { data: invItems, error: invErr } = await supabase
    .from("player_inventory")
    .select("*")
    .in("player_id", robloxIds);

  if (invErr) throw invErr;

  // 4. Query place names from game_places
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

  // 5. Map each state to a player object
  return states.map(s => {
    const pProfile = profileMap[s.player_id] || { username: "Unknown", display_name: "" };
    const units = {};

    // Filter items matching the player and this specific map/place
    const pItems = (invItems || []).filter(item => {
      if (item.player_id !== s.player_id) return false;
      const playerMap = KNOWN_MAPS[s.place_id] || s.place_id;
      const itemMap = KNOWN_MAPS[item.place_id] || item.place_id;
      return playerMap === itemMap;
    });

    // Sort items by update time so latest value overwrites
    pItems.sort((a, b) => {
      const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return timeA - timeB;
    });

    pItems.forEach(item => {
      const displayName = itemNameFromId(item.item_id);
      if (item.text_value !== null && item.text_value !== undefined && item.text_value !== "") {
        units[displayName] = item.text_value;
      } else {
        units[displayName] = Number(item.amount || 0);
      }
    });

    const rawPlaceName = placeNameById[s.place_id] || s.place_id;
    const placeName = KNOWN_MAPS[s.place_id] || (isNaN(rawPlaceName) ? rawPlaceName : KNOWN_MAPS[rawPlaceName]) || rawPlaceName;

    return {
      id: `${s.player_id}:${s.place_id}`, // Make it unique per player and map
      userId: s.player_id,
      name: pProfile.username,
      displayName: pProfile.display_name,
      coins: Number(s.coins || 0),
      status: s.status,
      placeId: s.place_id,
      placeName: placeName,
      jobId: s.job_id || "",
      units: normalizeUnitsObject(units),
      firstSeenAt: s.updated_at ? new Date(s.updated_at).getTime() : 0,
      updatedAt: s.updated_at ? new Date(s.updated_at).getTime() : 0,
    };
  });
}

async function run() {
  const result = await getPlayersFromInventory(['10971894488']);
  console.log("Resulting mapped players:\n", JSON.stringify(result, null, 2));
}

run().catch(console.error);
