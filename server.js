require("dotenv").config();

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "11654637731": "[LEGACY] Toilet Tower Defense",
  "114204398207377": "Survive Zombie Arena",
  "98927955463992": "Survive Zombie Arena",
  "unknown": "Unknown Place"
};

const placeNameCache = { ...KNOWN_MAPS };


function fetchPlaceNameFromRoblox(placeId) {
  return new Promise((resolve) => {
    if (!placeId || placeId === "unknown" || isNaN(placeId)) {
      return resolve(null);
    }
    const url = `https://economy.roblox.com/v2/assets/${placeId}/details`;
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.Name) {
            resolve(parsed.Name);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    }).on("error", () => {
      resolve(null);
    });
  });
}

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
  const s = String(name || "").trim();
  // Preserve casing for known SZA items
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
      // Class is a string value, not numeric
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
    if (itemName === "Class") {
      // Class is a string value (e.g. "Warrior", "Mage")
      units[itemName] = String(value || "None");
    } else {
      units[itemName] = Math.max(units[itemName] || 0, Number(value || 0));
    }
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

// ── ค้นหาและแก้ไขฟังก์ชันนี้ในไฟล์ server.js ──
async function getPlayersFromInventory(robloxIds) {
  if (!robloxIds || robloxIds.length === 0) return [];

  const db = getSupabase();

  // 1. ดึงข้อมูลโปรไฟล์ผู้เล่นหลัก
  const { data: profiles, error: profErr } = await db
    .from("player_profiles")
    .select("player_id, username, display_name")
    .in("player_id", robloxIds);

  if (profErr) throw profErr;
  if (!profiles || profiles.length === 0) return [];

  // ทำ Map สำหรับค้นหาโปรไฟล์อย่างรวดเร็ว
  const profileMap = {};
  profiles.forEach(p => {
    profileMap[p.player_id] = p;
  });

  // 2. ดึงข้อมูลสถานะตามแต่ละแมพที่ผู้เล่นเคยรัน (player_place_state)
  const { data: states, error: stateErr } = await db
    .from("player_place_state")
    .select("player_id, place_id, job_id, status, coins, updated_at")
    .in("player_id", robloxIds);

  if (stateErr) throw stateErr;

  // 3. ดึงข้อมูลไอเท็มทั้งหมดในคลัง (player_inventory)
  const { data: invItems, error: invErr } = await db
    .from("player_inventory")
    .select("*")
    .in("player_id", robloxIds);

  if (invErr) throw invErr;

  // 4. ดึงชื่อแมพจากตาราง game_places
  const placeIds = [...new Set((states || []).map(s => s.place_id).filter(Boolean))];
  let placeNameById = {};
  if (placeIds.length) {
    const { data: places } = await db
      .from("game_places")
      .select("place_id, place_name")
      .in("place_id", placeIds);
    if (places) {
      placeNameById = Object.fromEntries(places.map(p => [p.place_id, p.place_name]));
    }
  }

  // ตัวช่วยหาชื่อแมพแบบ Canonical
  function resolveMapName(placeId) {
    const rawPlaceName = placeNameById[placeId] || placeId;
    return KNOWN_MAPS[placeId] || (isNaN(rawPlaceName) ? rawPlaceName : KNOWN_MAPS[rawPlaceName]) || rawPlaceName;
  }

  // 5. ประกอบร่างข้อมูลแบบ 1 ID ต่อ 1 แถว พร้อมมัดรวม mapStates
  return robloxIds.map(robloxId => {
    const pProfile = profileMap[robloxId];
    if (!pProfile) return null;

    const pStates = (states || []).filter(s => s.player_id === robloxId);
    if (pStates.length === 0) return null;

    // หาด่านล่าสุดที่ผู้เล่น active เพื่อใช้เป็นข้อมูลหลัก (root)
    pStates.sort((a, b) => {
      const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return timeB - timeA;
    });

    const latestState = pStates[0];
    const mapName = resolveMapName(latestState.place_id);

    // สร้าง mapStates เก็บประวัติแยกแต่ละแมพ
    const mapStates = {};

    pStates.forEach(s => {
      const mName = resolveMapName(s.place_id);
      
      // ถ้าไม่มีคีย์แมพนี้ หรือสถานะนี้ใหม่กว่าที่มีอยู่ ให้เพิ่มข้อมูล
      if (!mapStates[mName] || new Date(s.updated_at).getTime() > mapStates[mName].updatedAt) {
        // ดึงไอเท็มทั้งหมดในแมพหลักเดียวกัน (รองรับการแชร์ Lobby กับ Game)
        const mapPlaceIds = new Set(pStates.filter(ps => resolveMapName(ps.place_id) === mName).map(ps => ps.place_id));
        const pItems = (invItems || []).filter(item => item.player_id === robloxId && mapPlaceIds.has(item.place_id));

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

        mapStates[mName] = {
          coins: Number(s.coins || 0),
          status: s.status,
          updatedAt: new Date(s.updated_at).getTime(),
          units: normalizeUnitsObject(units)
        };
      }
    });

    return {
      id: robloxId,
      userId: robloxId,
      name: pProfile.username,
      displayName: pProfile.display_name,
      coins: Number(latestState.coins || 0),
      status: latestState.status,
      placeId: latestState.place_id,
      placeName: mapName,
      jobId: latestState.job_id || "",
      updatedAt: new Date(latestState.updated_at).getTime(),
      mapStates: mapStates
    };
  }).filter(Boolean);
}

async function getPlayersByUserId(userId) {
  const { data: accounts, error: accErr } = await getSupabase()
    .from("user_roblox_accounts")
    .select("roblox_user_id")
    .eq("user_id", userId);

  if (accErr) throw new Error(accErr.message);
  if (!accounts?.length) return [];

  const robloxIds = accounts.map((a) => a.roblox_user_id);

  let fromInventory = [];
  try {
    fromInventory = await getPlayersFromInventory(robloxIds);
  } catch (err) {
    console.warn("getPlayersFromInventory failed:", err.message);
  }

  // ค้นหา roblox_user_id ที่ยังไม่มีข้อมูลในตาราง players ใหม่ (เพื่อดึงจาก view เก่ามาผสม)
  const foundIds = new Set(fromInventory.map(p => String(p.userId)));
  const missingIds = robloxIds.filter(id => !foundIds.has(String(id)));

  let fromView = [];
  if (missingIds.length > 0) {
    const { data, error } = await getSupabase()
      .from("dashboard_player_places")
      .select("*")
      .in("user_id", missingIds);

    if (error) {
      console.warn("Querying dashboard_player_places view failed:", error.message);
    } else if (data) {
      fromView = data.map(rowToPlayer);
    }
  }

  // รวมข้อมูลทั้งหมดเข้าด้วยกัน
  const combined = [...fromInventory, ...fromView];
  
  const merged = {};
  
  // โหลดจาก Inventory ก่อน (ซึ่งมีโครงสร้าง mapStates อยู่แล้ว)
  fromInventory.forEach(p => {
    merged[p.userId] = p;
  });

  // โหลดจาก View แล้วผสมเข้าด้วยกัน
  fromView.forEach(p => {
    const key = String(p.userId);
    if (!merged[key]) {
      merged[key] = {
        id: p.userId,
        userId: p.userId,
        name: p.name,
        displayName: p.displayName,
        coins: p.coins,
        status: p.status,
        placeId: p.placeId,
        placeName: p.placeName,
        jobId: p.jobId || "",
        updatedAt: p.updatedAt,
        mapStates: {}
      };
    }

    const mapName = p.placeName || p.placeId;
    if (!merged[key].mapStates[mapName] || p.updatedAt > merged[key].mapStates[mapName].updatedAt) {
      merged[key].mapStates[mapName] = {
        coins: p.coins,
        status: p.status,
        updatedAt: p.updatedAt,
        units: p.units || {}
      };
    }

    // ถ้าพบว่า view row นี้เป็นข้อมูลที่อัปเดตล่าสุดของคนนี้ ให้เซ็ตเป็นข้อมูลหลัก (root)
    if (p.updatedAt > (merged[key].updatedAt || 0)) {
      merged[key].coins = p.coins;
      merged[key].status = p.status;
      merged[key].placeId = p.placeId;
      merged[key].placeName = p.placeName;
      merged[key].jobId = p.jobId || "";
      merged[key].updatedAt = p.updatedAt;
    }
  });

  const finalPlayers = Object.values(merged);
  finalPlayers.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return finalPlayers;
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

  let placeName = KNOWN_MAPS[placeId] || player.placeName;
  if (!placeName || placeName === placeId || !isNaN(placeName)) {
    if (placeNameCache[placeId]) {
      placeName = placeNameCache[placeId];
    } else {
      // Query database first to see if we already have a real name saved
      const { data: existingPlace } = await db
        .from("game_places")
        .select("place_name")
        .eq("place_id", placeId)
        .maybeSingle();

      if (existingPlace && existingPlace.place_name && isNaN(existingPlace.place_name) && existingPlace.place_name !== placeId) {
        placeName = existingPlace.place_name;
        placeNameCache[placeId] = placeName;
      } else {
        // Fetch from Roblox
        const fetchedName = await fetchPlaceNameFromRoblox(placeId);
        if (fetchedName) {
          placeName = fetchedName;
          placeNameCache[placeId] = fetchedName;
        } else {
          placeName = placeId === "unknown" ? "Unknown Place" : placeId;
        }
      }
    }
  }

  result = await db.from("game_places").upsert(
    {
      place_id: placeId,
      place_name: placeName,
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

  // ── Upsert ตาราง players เพื่อความสอดคล้องกับ /roblox/update
  let playerError = null;
  const playerPayloadBase = {
    id: player.id,
    user_id: player.id,
    name: player.name || "Unknown",
    display_name: player.displayName || "",
    coins: Number(player.coins || 0),
    status: player.status || "Online",
    place_id: placeId,
    job_id: String(player.jobId || ""),
  };

  const res1 = await db.from("players").upsert({
    ...playerPayloadBase,
    updated_at: nowIso
  });

  if (res1.error) {
    const isOldSchemaError = res1.error.message.includes("bigint") ||
      res1.error.message.includes("integer") ||
      res1.error.message.includes("first_seen_at") ||
      res1.error.message.includes("not-null");
    if (isOldSchemaError) {
      let firstSeen = Date.now();
      try {
        const { data: existing } = await db
          .from("players")
          .select("first_seen_at")
          .eq("id", player.id)
          .maybeSingle();
        if (existing && existing.first_seen_at) {
          firstSeen = Number(existing.first_seen_at);
        }
      } catch (err) { }

      const res2 = await db.from("players").upsert({
        ...playerPayloadBase,
        first_seen_at: firstSeen,
        updated_at: Date.now()
      });
      playerError = res2.error;
    } else {
      playerError = res1.error;
    }
  }
  if (playerError) throw new Error(`players upsert failed: ${playerError.message}`);

  for (const [itemNameRaw, amountRaw] of Object.entries(player.units || {})) {
    const itemName = normalizeItemName(itemNameRaw);
    const itemId = normalizeItemId(itemName);
    if (!itemId) continue;

    // Handle string-type items (e.g., Class = "Warrior")
    const isStringItem = (itemName === "Class");
    const amount = isStringItem ? 0 : Number(amountRaw || 0);
    const stringValue = isStringItem ? String(amountRaw || "None") : null;

    result = await db
      .from("game_items")
      .upsert({ item_id: itemId, item_name: itemName, category: isStringItem ? "attribute" : "unit", updated_at: nowIso }, { onConflict: "item_id" });
    if (result.error) throw new Error(result.error.message);

    result = await db
      .from("place_items")
      .upsert({ place_id: placeId, item_id: itemId, enabled: true }, { onConflict: "place_id,item_id" });
    if (result.error) throw new Error(result.error.message);

    result = await db
      .from("player_inventory")
      .upsert(
        { player_id: player.id, place_id: placeId, item_id: itemId, amount, ...(stringValue != null ? { text_value: stringValue } : {}), updated_at: nowIso },
        { onConflict: "player_id,place_id,item_id" }
      );
    // If text_value column doesn't exist yet, retry without it
    if (result.error && result.error.message.includes("text_value")) {
      result = await db
        .from("player_inventory")
        .upsert(
          { player_id: player.id, place_id: placeId, item_id: itemId, amount, updated_at: nowIso },
          { onConflict: "player_id,place_id,item_id" }
        );
    }
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

    // ── NEW: /roblox/update — Dynamic Inventory Schema ──────────────
    if (req.method === "POST" && pathname === "/roblox/update") {
      const robloxHandler = require("./api/roblox-update");
      return robloxHandler(req, res);
    }

    serveStatic(req, res);
  } catch (error) {
    console.error(`${req.method} ${pathname} error:`, error);
    sendJson(res, 500, { ok: false, error: error.message || "Internal server error" });
  }
}

handler.getPlayersByUserId = getPlayersByUserId;
module.exports = handler;

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
    console.log(`Supabase: ${SUPABASE_URL || "not set"}`);
  });
}