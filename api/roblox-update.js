/**
 * api/roblox-update.js
 * Vercel Serverless Function — POST /roblox/update
 *
 * รับข้อมูลจาก Roblox Script แล้ว Upsert ลง Supabase
 *  - ตาราง `players`          → ข้อมูลทั่วไปของผู้เล่น
 *  - ตาราง `player_inventory` → ไอเท็มแบบ Dynamic Key-Value
 *
 * ตัวอย่าง JSON ที่ส่งมาจาก Roblox:
 * {
 *   "script_key": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
 *   "user_id":      "123456789",
 *   "name":         "PlayerUsername",
 *   "display_name": "Player Display",
 *   "coins":        500,
 *   "status":       "Online",
 *   "place_id":     "114204398207377",
 *   "job_id":       "abc123-server-id",
 *   "inventory": [
 *     { "item_id": "sword",    "amount": 3 },
 *     { "item_id": "credits",  "amount": 150 },
 *     { "item_id": "class",    "text_value": "Warrior" },
 *     { "item_id": "vip_pass", "text_value": "gold" }
 *   ]
 * }
 */

require("dotenv").config();
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

// ────────────────────────────────────────────
// Supabase Client (Singleton)
// ────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let _supabase = null;
function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment"
    );
  }
  if (!_supabase) {
    _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabase;
}

// ────────────────────────────────────────────
// Maps & Places Cache
// ────────────────────────────────────────────
const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "11654637731": "[LEGACY] Toilet Tower Defense",
  "114204398207377": "Survive Zombie Arena",
  "98927955463992": "Survive Zombie Arena",
  "unknown": "Unknown Place"
};

const placeNameCache = { ...KNOWN_MAPS };

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

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

/**
 * ตรวจสอบ script_key กับตาราง user_profiles
 * คืนค่า user_id ถ้าถูกต้อง หรือ null ถ้าไม่พบ
 */
async function getUserByScriptKey(scriptKey) {
  const { data, error } = await getSupabase()
    .from("user_profiles")
    .select("user_id")
    .eq("script_key", String(scriptKey || "").trim())
    .single();

  if (error || !data) return null;
  return data.user_id;
}

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

/**
 * แปลง inventory array จาก Roblox ให้เป็น array ที่พร้อม upsert
 */
function normalizeInventory(inventoryRaw, playerId, placeId, nowIso) {
  if (!Array.isArray(inventoryRaw)) return [];

  const itemMap = {};

  for (const item of inventoryRaw) {
    const rawId = String(item.item_id || "").trim();
    if (!rawId) continue;

    // Normalize item_id → lowercase_underscore
    const itemName = normalizeItemName(rawId);
    const itemId = normalizeItemId(itemName);

    if (!itemId) continue;

    const hasAmount = item.amount !== undefined && item.amount !== null;
    const hasText   = item.text_value !== undefined && item.text_value !== null;

    let amount     = 0;
    let text_value = null;

    if (hasText && !hasAmount) {
      // ไอเท็มประเภท string (เช่น class, vip_rank)
      text_value = String(item.text_value);
    } else if (hasAmount && !hasText) {
      // ไอเท็มประเภทตัวเลข (เช่น coins, credits, sword)
      amount = Number(item.amount) || 0;
    } else if (hasAmount && hasText) {
      // ส่งมาทั้งคู่ → เก็บทั้งคู่
      amount     = Number(item.amount) || 0;
      text_value = String(item.text_value);
    } else {
      // ไม่มีค่าอะไรเลย → ข้าม
      continue;
    }

    if (!itemMap[itemId]) {
      itemMap[itemId] = {
        player_id:  playerId,
        place_id:   placeId,
        item_id:    itemId,
        item_name:  itemName,
        amount,
        text_value,
        updated_at: nowIso,
      };
    } else {
      // รวมข้อมูลที่มี itemId ซ้ำกัน (เช่น TITAN และ Cenima ที่ map ไปหา cinema เหมือนกัน)
      itemMap[itemId].amount = Math.max(itemMap[itemId].amount || 0, amount);
      if (text_value !== null) {
        itemMap[itemId].text_value = text_value;
      }
    }
  }

  return Object.values(itemMap);
}

// ────────────────────────────────────────────
// Core Upsert Logic
// ────────────────────────────────────────────

/**
 * Upsert ข้อมูลผู้เล่นและ inventory ลง Supabase พร้อมเชื่อมโยงตารางแวดล้อม
 */
async function upsertPlayerData(payload) {
  const db = getSupabase();
  const nowIso = new Date().toISOString();

  // ── 1. Validate & Extract fields ──────────────────────
  const userId      = String(payload.user_id || payload.userId || "").trim();
  const name        = String(payload.name || "Unknown").trim();
  const displayName = String(payload.display_name || payload.displayName || "").trim();
  const status      = String(payload.status || "Online").trim();
  const placeId     = String(payload.place_id || payload.placeId || "unknown").trim();
  const jobId       = String(payload.job_id || payload.jobId || "").trim();

  if (!userId) {
    throw new Error("Missing required field: user_id or userId");
  }

  // ดึงข้อมูลเหรียญเดิมในแมพนี้ เพื่อป้องกันไม่ให้ทับซ้อนเป็น 0 ตอนโหลดด่าน
  let coins = 0;
  const hasCoins = payload.coins !== undefined && payload.coins !== null;
  if (hasCoins) {
    coins = Number(payload.coins || 0);
  } else {
    try {
      const { data: existingState } = await db
        .from("player_place_state")
        .select("coins")
        .eq("player_id", userId)
        .eq("place_id", placeId)
        .maybeSingle();
      if (existingState) {
        coins = Number(existingState.coins || 0);
      }
    } catch (e) {
      console.warn("Failed to query existing coins:", e.message);
    }
  }

  // ── 2. Upsert player_profiles เพื่อรักษา schema relationships (Defensive RLS catch)
  try {
    await db.from("player_profiles").upsert(
      {
        player_id: userId,
        roblox_user_id: userId,
        username: name,
        display_name: displayName,
        updated_at: nowIso,
      },
      { onConflict: "player_id" }
    ).throwOnError();
  } catch (err) {
    console.warn("Optional player_profiles upsert failed (likely RLS):", err.message);
  }

  // ── 3. Resolve place name dynamically
  let placeName = KNOWN_MAPS[placeId] || payload.place_name || payload.placeName;
  if (!placeName || placeName === placeId || !isNaN(placeName)) {
    if (placeNameCache[placeId]) {
      placeName = placeNameCache[placeId];
    } else {
      try {
        const { data: existingPlace } = await db
          .from("game_places")
          .select("place_name")
          .eq("place_id", placeId)
          .maybeSingle();

        if (existingPlace && existingPlace.place_name && isNaN(existingPlace.place_name) && existingPlace.place_name !== placeId) {
          placeName = existingPlace.place_name;
          placeNameCache[placeId] = placeName;
        } else {
          const fetchedName = await fetchPlaceNameFromRoblox(placeId);
          if (fetchedName) {
            placeName = fetchedName;
            placeNameCache[placeId] = fetchedName;
          } else {
            placeName = placeId === "unknown" ? "Unknown Place" : placeId;
          }
        }
      } catch (err) {
        placeName = placeId === "unknown" ? "Unknown Place" : placeId;
      }
    }
  }

  // Save place name to game_places (Defensive RLS catch)
  try {
    await db.from("game_places").upsert(
      {
        place_id: placeId,
        place_name: placeName,
        updated_at: nowIso,
      },
      { onConflict: "place_id" }
    ).throwOnError();
  } catch (err) {
    console.warn("Optional game_places upsert failed (likely RLS):", err.message);
  }

  // ── 4. Upsert player_place_state (Defensive RLS catch)
  try {
    await db.from("player_place_state").upsert(
      {
        player_id: userId,
        place_id: placeId,
        job_id: jobId,
        status: status,
        coins: coins,
        last_seen_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "player_id,place_id" }
    ).throwOnError();
  } catch (err) {
    console.warn("Optional player_place_state upsert failed (likely RLS):", err.message);
  }

  // ── 5. Upsert ตาราง players ───────────────────────────
  let playerError = null;
  const playerPayloadBase = {
    id:           userId, // Support old schema primary key (id)
    user_id:      userId, // Support new schema primary key (user_id)
    name,
    display_name: displayName,
    coins,
    status,
    place_id:     placeId,
    job_id:       jobId,
  };

  // Try saving with ISO timestamp first (new schema)
  const res1 = await db.from("players").upsert({
    ...playerPayloadBase,
    updated_at: nowIso
  });

  if (res1.error) {
    // If it failed due to type mismatch or null constraint (old schema), retry with old schema columns
    const isOldSchemaError = res1.error.message.includes("bigint") || 
                             res1.error.message.includes("integer") || 
                             res1.error.message.includes("first_seen_at") || 
                             res1.error.message.includes("not-null");
    if (isOldSchemaError) {
      // Query to preserve first_seen_at if player already exists
      let firstSeen = Date.now();
      try {
        const { data: existing } = await db
          .from("players")
          .select("first_seen_at")
          .eq("id", userId)
          .maybeSingle();
        if (existing && existing.first_seen_at) {
          firstSeen = Number(existing.first_seen_at);
        }
      } catch (err) {
        // Fallback to Date.now()
      }

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

  if (playerError) {
    throw new Error(`players upsert failed: ${playerError.message}`);
  }

  // ── 6. Upsert ตาราง player_inventory (Dynamic) ────────
  const rawInventory = payload.inventory || payload.items || [];
  const inventoryRows = normalizeInventory(
    rawInventory,
    userId,
    placeId,
    nowIso
  );

  if (inventoryRows.length > 0) {
    // 6.1. Upsert game_items and place_items (Defensive RLS catch)
    for (const row of inventoryRows) {
      const isStringItem = (row.item_id === "class" || row.item_id === "selectedclass");
      
      try {
        await db.from("game_items").upsert(
          {
            item_id: row.item_id,
            item_name: row.item_name,
            category: isStringItem ? "attribute" : "unit",
            updated_at: nowIso,
          },
          { onConflict: "item_id" }
        ).throwOnError();

        await db.from("place_items").upsert(
          {
            place_id: placeId,
            item_id: row.item_id,
            enabled: true,
          },
          { onConflict: "place_id,item_id" }
        ).throwOnError();
      } catch (err) {
        console.warn(`Optional game_items/place_items upsert failed for ${row.item_id}:`, err.message);
      }
    }

    // 6.2. Clean item_name before saving to player_inventory schema
    const inventoryDbRows = inventoryRows.map(row => ({
      player_id: row.player_id,
      place_id: row.place_id,
      item_id: row.item_id,
      amount: row.amount,
      text_value: row.text_value,
      updated_at: row.updated_at
    }));

    try {
      await db
        .from("player_inventory")
        .upsert(inventoryDbRows, {
          onConflict: "player_id,place_id,item_id",
        })
        .throwOnError();
    } catch (invError) {
      console.warn("Optional player_inventory upsert failed (likely RLS):", invError.message);
    }
  }

  return {
    user_id:         userId,
    name,
    display_name:    displayName,
    coins,
    status,
    place_id:        placeId,
    place_name:      placeName,
    job_id:          jobId,
    inventory_saved: inventoryRows.length,
  };
}

// ────────────────────────────────────────────
// HTTP Utilities
// ────────────────────────────────────────────

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Script-Key",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) {
        reject(new Error("Request body too large (max 512 KB)"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ────────────────────────────────────────────
// Vercel Serverless Handler (also usable as Node.js middleware)
// ────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Script-Key",
    });
    res.end();
    return;
  }

  // Only accept POST
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed. Use POST." });
    return;
  }

  try {
    // ── Parse body ──────────────────────────────────────
    const rawBody = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    // ── Auth: script_key ────────────────────────────────
    const scriptKey =
      payload.script_key ||
      req.headers["x-script-key"] ||
      payload.key;

    if (!scriptKey) {
      sendJson(res, 401, { ok: false, error: "Missing script_key" });
      return;
    }

    const webUserId = await getUserByScriptKey(scriptKey);
    if (!webUserId) {
      sendJson(res, 401, { ok: false, error: "Invalid script_key" });
      return;
    }

    // ── Upsert ──────────────────────────────────────────
    const result = await upsertPlayerData(payload);

    // ── Account Linking ─────────────────────────────────
    try {
      await upsertRobloxAccount(
        webUserId,
        result.user_id,
        result.name,
        result.display_name
      );
    } catch (linkErr) {
      console.warn("Failed to automatically link Roblox account to web user:", linkErr.message);
    }

    sendJson(res, 200, {
      ok: true,
      saved: result,
    });
  } catch (err) {
    console.error("[roblox-update] Error:", err);
    sendJson(res, 500, {
      ok: false,
      error: err.message || "Internal server error",
    });
  }
};
