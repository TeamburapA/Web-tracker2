require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

// Re-implement the exact logic from server.js
const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "114204398207377": "Survive Zombie Arena",
  "98927955463992": "Survive Zombie Arena",
  "unknown": "Unknown Place"
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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

function rowToPlayer(row) {
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
    units: normalizeUnitsObject(rawUnits),
    firstSeenAt: Number(row.first_seen_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function getPlayersFromInventory(robloxIds) {
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

  const allItemIds = [...new Set((inventoryData || []).map(r => r.item_id).filter(Boolean))];
  let itemNameMap = {};
  if (allItemIds.length) {
    const { data: gameItems } = await supabase
      .from("game_items")
      .select("item_id, item_name")
      .in("item_id", allItemIds);
    if (gameItems) {
      itemNameMap = Object.fromEntries(gameItems.map(gi => [gi.item_id, gi.item_name]));
    }
  }

  const inventoryByKey = {};
  (inventoryData || []).forEach((row) => {
    const key = `${row.player_id}:${row.place_id}`;
    if (!inventoryByKey[key]) inventoryByKey[key] = {};

    const displayName = itemNameMap[row.item_id] || itemNameFromId(row.item_id);

    if (row.text_value !== null && row.text_value !== undefined) {
      inventoryByKey[key][displayName] = row.text_value;
    } else {
      inventoryByKey[key][displayName] = Number(row.amount || 0);
    }
  });

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
    const units = inventoryByKey[invKey] || {};
    
    const rawPlaceName = placeNameById[player.place_id] || player.place_id;
    const placeName = KNOWN_MAPS[player.place_id] || rawPlaceName;

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
      units: units,
      firstSeenAt: player.updated_at ? new Date(player.updated_at).getTime() : 0,
      updatedAt: player.updated_at ? new Date(player.updated_at).getTime() : 0,
    };
  });
}

async function getPlayersByUserId(userId) {
  const { data: accounts, error: accErr } = await supabase
    .from("user_roblox_accounts")
    .select("roblox_user_id")
    .eq("user_id", userId);

  if (accErr) throw new Error(accErr.message);
  if (!accounts?.length) return [];

  const robloxIds = accounts.map((a) => a.roblox_user_id);

  try {
    const fromInventory = await getPlayersFromInventory(robloxIds);
    if (fromInventory.length) return fromInventory;
  } catch (err) {
    console.warn("getPlayersFromInventory failed, falling back to view:", err.message);
  }

  const { data, error } = await supabase
    .from("dashboard_player_places")
    .select("*")
    .in("user_id", robloxIds)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(rowToPlayer);
}

async function test() {
  const { data: profiles } = await supabase.from("user_profiles").select("user_id");
  for (const prof of profiles || []) {
    const roster = await getPlayersByUserId(prof.user_id);
    console.log(`\nUser: ${prof.user_id}`);
    console.log("Roster returned by getPlayersByUserId:", JSON.stringify(roster, null, 2));
  }
}

test().catch(console.error);
