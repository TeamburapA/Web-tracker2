require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// We import from server.js. To prevent starting the server, we mock the port/listen if needed,
// but since server.js exports handler and getPlayersByUserId is a helper, we can also write the query directly.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
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

async function getPlayersByUserId(userId) {
  const { data: accounts, error: accErr } = await supabase
    .from("user_roblox_accounts")
    .select("roblox_user_id")
    .eq("user_id", userId);

  if (accErr) throw new Error(accErr.message);
  if (!accounts?.length) return [];

  const robloxIds = accounts.map((a) => a.roblox_user_id);

  // Here we run the new query logic from server.js
  const { data: playersData, error: plErr } = await supabase
    .from("players")
    .select("user_id, name, display_name, coins, status, place_id, job_id, updated_at")
    .in("user_id", robloxIds);

  if (plErr) throw plErr;
  if (!playersData?.length) return [];

  const playerIds = playersData.map((p) => p.user_id);
  const { data: inventoryData, error: invErr } = await supabase
    .from("player_inventory")
    .select("player_id, place_id, item_id, amount, text_value")
    .in("player_id", playerIds);

  if (invErr) throw invErr;

  const itemIds = [...new Set((inventoryData || []).map((r) => r.item_id))];
  let itemNameById = {};

  if (itemIds.length) {
    const { data: items } = await supabase
      .from("game_items")
      .select("item_id, item_name")
      .in("item_id", itemIds);

    if (items) {
      itemNameById = Object.fromEntries(items.map((i) => [i.item_id, i.item_name]));
    }
  }

  const inventoryByKey = {};
  for (const row of inventoryData || []) {
    const key = `${row.player_id}:${row.place_id}`;
    if (!inventoryByKey[key]) inventoryByKey[key] = {};

    const itemName = itemNameById[row.item_id] || itemNameFromId(row.item_id);
    const canonical = normalizeItemName(itemName);

    if (canonical === "Class") {
      inventoryByKey[key].Class = row.text_value || "None";
    } else if (canonical === "Cinema") {
      const num = Number(row.amount || 0);
      inventoryByKey[key].Cinema = Math.max(inventoryByKey[key].Cinema || 0, num);
    } else {
      inventoryByKey[key][canonical] = Number(row.amount || 0);
    }
  }

  const placeIds = [...new Set(playersData.map((p) => p.place_id).filter(Boolean))];
  let placeNameById = {};

  if (placeIds.length) {
    const { data: places } = await supabase
      .from("game_places")
      .select("place_id, place_name")
      .in("place_id", placeIds);

    if (places) {
      placeNameById = Object.fromEntries(places.map((p) => [p.place_id, p.place_name]));
    }
  }

  return playersData.map((player) => {
    const invKey = `${player.user_id}:${player.place_id}`;
    const units = normalizeUnitsObject(inventoryByKey[invKey] || {});
    
    const rawPlaceName = placeNameById[player.place_id] || player.place_id;
    const placeName = KNOWN_MAPS[player.place_id] || (isNaN(rawPlaceName) ? rawPlaceName : KNOWN_MAPS[rawPlaceName]) || rawPlaceName;

    return {
      id: player.user_id,
      userId: player.user_id,
      name: player.name,
      displayName: player.display_name,
      coins: Number(player.coins || 0),
      status: player.status || "Online",
      placeId: player.place_id,
      placeName: placeName,
      jobId: player.job_id || "",
      units,
      firstSeenAt: player.updated_at ? new Date(player.updated_at).getTime() : 0,
      updatedAt: player.updated_at ? new Date(player.updated_at).getTime() : 0,
    };
  });
}

async function run() {
  try {
    console.log("Calling getPlayersByUserId for test user...");
    const roster = await getPlayersByUserId("746e9655-45f0-4fbe-a669-2e97df372fc5");
    console.log("Returned player roster from query:");
    console.log(JSON.stringify(roster, null, 2));
  } catch (e) {
    console.error("Query failed:", e);
  }
}

run();
