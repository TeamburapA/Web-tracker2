require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve(__dirname, "public");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

let supabase;

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment");
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  return supabase;
}

async function verifyJwt(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data: { user }, error } = await getSupabase().auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function getUserByScriptKey(scriptKey) {
  const { data, error } = await getSupabase()
    .from("user_profiles")
    .select("user_id")
    .eq("script_key", String(scriptKey || "").trim())
    .single();

  if (error || !data) return null;
  return data.user_id;
}

async function ensureUserProfile(userId) {
  const db = getSupabase();

  let { data: profile, error } = await db
    .from("user_profiles")
    .select("script_key, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (profile?.script_key) return profile;

  const { data: newProfile, error: upsertError } = await db
    .from("user_profiles")
    .upsert(
      {
        user_id: userId,
        script_key: crypto.randomUUID(),
      },
      { onConflict: "user_id" }
    )
    .select("script_key, created_at")
    .single();

  if (upsertError) throw new Error(upsertError.message);
  return newProfile;
}

async function upsertRobloxAccount(userId, robloxUserId, robloxUsername, displayName) {
  const { error } = await getSupabase()
    .from("user_roblox_accounts")
    .upsert(
      {
        user_id: userId,
        roblox_user_id: String(robloxUserId),
        roblox_username: robloxUsername || "",
        display_name: displayName || "",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,roblox_user_id" }
    );

  if (error) throw new Error(error.message);
}

function normalizeItemName(name) {
  if (name === "TITAN" || name === "Cenima") return "Cinema";
  return String(name || "").trim();
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
  return String(itemId || "");
}

function normalizeUnitsObject(units) {
  const out = {};

  for (const [key, value] of Object.entries(units || {})) {
    const name = normalizeItemName(key);
    const num = Number(value || 0);
    if (name === "Cinema") {
      out.Cinema = Math.max(out.Cinema || 0, num);
    } else {
      out[name] = num;
    }
  }

  return out;
}

function normalizeUnits(payload) {
  const raw = { ...(payload.units || {}) };
  const SKIP = new Set(["key", "script_key", "userId", "id", "name", "displayName", "coins", "status", "placeId", "placeName", "jobId"]);

  for (const key of Object.keys(payload)) {
    if (SKIP.has(key)) continue;
    if (typeof payload[key] === "number" || typeof payload[key] === "string") {
      raw[key] = payload[key];
    }
  }

  const units = {};
  for (const [name, value] of Object.entries(raw)) {
    const itemName = normalizeItemName(name);
    const itemId = normalizeItemId(itemName);
    if (!itemId) continue;
    units[itemName] = Math.max(units[itemName] || 0, Number(value || 0));
  }

  return units;
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

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    displayName: row.display_name,
    coins: Number(row.coins || 0),
    status: row.status,
    placeId: row.place_id,
    placeName: row.place_name,
    jobId: row.job_id,
    units: normalizeUnitsObject(rawUnits),
    firstSeenAt: Number(row.first_seen_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function normalizeUpdate(payload) {
  const id = String(payload.userId || payload.id || payload.name || "").trim();
  if (!id) return null;

  return {
    id,
    userId: payload.userId || payload.id || "",
    name: payload.name || "Unknown",
    displayName: payload.displayName || "",
    coins: Number(payload.coins || 0),
    status: payload.status || "Online",
    placeId: payload.placeId || "unknown",
    placeName: payload.placeName || "",
    jobId: payload.jobId || "",
    units: normalizeUnits(payload),
    updatedAt: Date.now(),
  };
}

async function getPlayersFromInventory(robloxIds) {
  const db = getSupabase();

  const { data: profiles, error: profErr } = await db
    .from("player_profiles")
    .select("player_id, roblox_user_id, username, display_name")
    .in("roblox_user_id", robloxIds);

  if (profErr) throw profErr;
  if (!profiles?.length) return [];

  const playerIds = profiles.map((p) => p.player_id);
  const profileByPlayerId = Object.fromEntries(profiles.map((p) => [p.player_id, p]));

  const { data: states, error: stErr } = await db
    .from("player_place_state")
    .select("player_id, place_id, job_id, status, coins, last_seen_at, updated_at")
    .in("player_id", playerIds)
    .order("updated_at", { ascending: false });

  if (stErr) throw stErr;
  if (!states?.length) return [];

  const { data: inventory, error: invErr } = await db
    .from("player_inventory")
    .select("player_id, place_id, item_id, amount")
    .in("player_id", playerIds);

  if (invErr) throw invErr;

  const itemIds = [...new Set((inventory || []).map((r) => r.item_id))];
  let itemNameById = {};

  if (itemIds.length) {
    const { data: items, error: itemErr } = await db
      .from("game_items")
      .select("item_id, item_name")
      .in("item_id", itemIds);

    if (!itemErr && items) {
      itemNameById = Object.fromEntries(items.map((i) => [i.item_id, i.item_name]));
    }
  }

  const inventoryByKey = {};
  for (const row of inventory || []) {
    const key = `${row.player_id}:${row.place_id}`;
    if (!inventoryByKey[key]) inventoryByKey[key] = {};

    const itemName = itemNameById[row.item_id] || itemNameFromId(row.item_id);
    const canonical = normalizeItemName(itemName);
    const num = Number(row.amount || 0);

    if (canonical === "Cinema") {
      inventoryByKey[key].Cinema = Math.max(inventoryByKey[key].Cinema || 0, num);
    } else {
      inventoryByKey[key][canonical] = num;
    }
  }

  const placeIds = [...new Set(states.map((s) => s.place_id).filter(Boolean))];
  let placeNameById = {};

  if (placeIds.length) {
    const { data: places } = await db
      .from("game_places")
      .select("place_id, place_name")
      .in("place_id", placeIds);

    if (places) {
      placeNameById = Object.fromEntries(places.map((p) => [p.place_id, p.place_name]));
    }
  }

  return states.map((state) => {
    const prof = profileByPlayerId[state.player_id] || {};
    const invKey = `${state.player_id}:${state.place_id}`;
    const units = normalizeUnitsObject(inventoryByKey[invKey] || {});

    return {
      id: state.player_id,
      userId: prof.roblox_user_id || state.player_id,
      name: prof.username || "Unknown",
      displayName: prof.display_name || "",
      coins: Number(state.coins || 0),
      status: state.status || "Online",
      placeId: state.place_id,
      placeName: placeNameById[state.place_id] || state.place_id,
      jobId: state.job_id || "",
      units,
      firstSeenAt: state.last_seen_at ? new Date(state.last_seen_at).getTime() : 0,
      updatedAt: state.updated_at ? new Date(state.updated_at).getTime() : 0,
    };
  });
}

async function getPlayersByUserId(userId) {
  const { data: accounts, error: accErr } = await getSupabase()
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

  const { data, error } = await getSupabase()
    .from("dashboard_player_places")
    .select("*")
    .in("user_id", robloxIds)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(rowToPlayer);
}

async function upsertPlayer(player) {
  const nowIso = new Date(player.updatedAt).toISOString();
  const placeId = String(player.placeId || "unknown");
  const db = getSupabase();

  let result = await db.from("player_profiles").upsert(
    {
      player_id: player.id,
      roblox_user_id: String(player.userId || player.id),
      username: player.name || "Unknown",
      display_name: player.displayName || "",
      updated_at: nowIso,
    },
    { onConflict: "player_id" }
  );
  if (result.error) throw new Error(result.error.message);

  result = await db.from("game_places").upsert(
    {
      place_id: placeId,
      place_name: player.placeName || (placeId === "unknown" ? "Unknown Place" : placeId),
      updated_at: nowIso,
    },
    { onConflict: "place_id" }
  );
  if (result.error) throw new Error(result.error.message);

  result = await db.from("player_place_state").upsert(
    {
      player_id: player.id,
      place_id: placeId,
      job_id: String(player.jobId || ""),
      status: player.status || "Online",
      coins: Number(player.coins || 0),
      last_seen_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "player_id,place_id" }
  );
  if (result.error) throw new Error(result.error.message);

  for (const [itemNameRaw, amountRaw] of Object.entries(player.units || {})) {
    const itemName = normalizeItemName(itemNameRaw);
    const itemId = normalizeItemId(itemName);
    if (!itemId) continue;

    const amount = Number(amountRaw || 0);

    result = await db
      .from("game_items")
      .upsert({ item_id: itemId, item_name: itemName, category: "unit", updated_at: nowIso }, { onConflict: "item_id" });
    if (result.error) throw new Error(result.error.message);

    result = await db
      .from("place_items")
      .upsert({ place_id: placeId, item_id: itemId, enabled: true }, { onConflict: "place_id,item_id" });
    if (result.error) throw new Error(result.error.message);

    result = await db
      .from("player_inventory")
      .upsert(
        { player_id: player.id, place_id: placeId, item_id: itemId, amount, updated_at: nowIso },
        { onConflict: "player_id,place_id,item_id" }
      );
    if (result.error) throw new Error(result.error.message);
  }

  return player;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Script-Key",
  });

  if (status === 204) {
    res.end();
    return;
  }

  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const urlPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${urlPath}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };

    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let done = false;

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024 && !done) {
        done = true;
        reject(new Error("Body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!done) resolve(body);
    });

    req.on("error", reject);
  });
}

async function handler(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;

  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && pathname === "/api/config") {
      sendJson(res, 200, {
        supabaseUrl: SUPABASE_URL || "",
        supabaseAnonKey: SUPABASE_ANON_KEY,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const user = await verifyJwt(req);
      if (!user) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const db = getSupabase();
      const profile = await ensureUserProfile(user.id);

      const { data: robloxAccounts } = await db
        .from("user_roblox_accounts")
        .select("roblox_user_id, roblox_username, display_name, last_seen_at, created_at")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: false });

      sendJson(res, 200, {
        user: {
          id: user.id,
          email: user.email,
          script_key: profile?.script_key || null,
          roblox_accounts: robloxAccounts || [],
        },
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/players") {
      const user = await verifyJwt(req);
      if (!user) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const players = await getPlayersByUserId(user.id);
      sendJson(res, 200, { now: Date.now(), players });
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/accounts/")) {
      const user = await verifyJwt(req);
      if (!user) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const robloxUserId = decodeURIComponent(pathname.replace("/api/accounts/", ""));
      if (!robloxUserId) {
        sendJson(res, 400, { ok: false, error: "Missing roblox_user_id" });
        return;
      }

      const { error } = await getSupabase()
        .from("user_roblox_accounts")
        .delete()
        .eq("user_id", user.id)
        .eq("roblox_user_id", robloxUserId);

      if (error) throw new Error(error.message);

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/update") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");

      const scriptKey = payload.script_key || req.headers["x-script-key"] || payload.key;
      if (!scriptKey) {
        sendJson(res, 401, { ok: false, error: "Missing script_key" });
        return;
      }

      const webUserId = await getUserByScriptKey(scriptKey);
      if (!webUserId) {
        sendJson(res, 401, { ok: false, error: "Invalid script_key" });
        return;
      }

      const update = normalizeUpdate(payload);
      if (!update) {
        sendJson(res, 400, { ok: false, error: "Missing userId or name" });
        return;
      }

      const player = await upsertPlayer(update);
      await upsertRobloxAccount(webUserId, String(update.userId || update.id), update.name, update.displayName);

      sendJson(res, 200, { ok: true, player });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    console.error(`${req.method} ${pathname} error:`, error);
    sendJson(res, 500, { ok: false, error: error.message || "Internal server error" });
  }
}

module.exports = handler;

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
    console.log(`Supabase: ${SUPABASE_URL || "not set"}`);
  });
}