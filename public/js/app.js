/**
 * app.js — Redesigned Dashboard controller (ES Module)
 */
import { getToken, logout, initGuard, clearSession } from "./auth.js";

const KNOWN_MAPS = {
  "93712201161812": "[LEGACY] Toilet Tower Defense",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "11654637731": "[LEGACY] Toilet Tower Defense",
  "114204398207377": "Survive Zombie Arena",
  "unknown": "Unknown Place"
};

const MAP_COLUMNS = {
  "Survive Zombie Arena": [
    { key: "Credits", label: "Credits", sortKey: "credits" },
    { key: "VoidShards", label: "VoidShards", sortKey: "voidshards" },
    { key: "Class", label: "Class", sortKey: "class", isText: true }
  ],
  "[LEGACY] Toilet Tower Defense": [
    { key: "UTC", label: "UTC", sortKey: "utc" },
    { key: "UTS", label: "UTS", sortKey: "uts" },
    { key: "Cinema", label: "Cinema", sortKey: "cinema", getter: (u) => cinemaCount(u) }
  ]
};

function getMapName(p) {
  const placeId = String(p.placeId || "unknown");
  if (KNOWN_MAPS[placeId]) {
    return KNOWN_MAPS[placeId];
  }
  const placeName = p.placeName || p.place_name || "";
  if (placeName && isNaN(placeName) && placeName !== "unknown") {
    return placeName;
  }
  return KNOWN_MAPS["unknown"] || "Unknown Place";
}

// Map columns are now discovered dynamically from player inventory units!


// ── DOM References ────────────────────────────────────────────────────────────
const rowsEl = document.getElementById("playerRows");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const onlineCountEl = document.getElementById("onlineCount");
const totalCoinsEl = document.getElementById("totalCoins");
const totalUnitsEl = document.getElementById("totalUnits");
const totalUnitsLabelEl = document.getElementById("totalUnitsLabel");
const copyAllBtn = document.getElementById("copyAllBtn");
const copyToast = document.getElementById("copyToast");
const manualScriptKeyEl = document.getElementById("manualScriptKey");
const accountsCountEl = document.getElementById("accountsCount");
const userUsernameEl = document.getElementById("userUsername");
const userAvatarInitialsEl = document.getElementById("userAvatarInitials");
const refreshBtn = document.getElementById("refreshBtn");
const clearBtn = document.getElementById("clearBtn");
const logoutBtn = document.getElementById("logoutBtn");
const tableCountLabel = document.getElementById("tableCountLabel");
const mapTabsListEl = document.getElementById("mapTabsList");
const footerCoinsWrapper = document.getElementById("footerCoinsWrapper");
const footerUnitsWrapper = document.getElementById("footerUnitsWrapper");
const footerCreditsWrapper = document.getElementById("footerCreditsWrapper");
const footerVoidShardsWrapper = document.getElementById("footerVoidShardsWrapper");
const totalCreditsEl = document.getElementById("totalCredits");
const totalVoidShardsEl = document.getElementById("totalVoidShards");

// ── State Variables ───────────────────────────────────────────────────────────
let players = [];
let serverNow = Date.now();
let authToken = null;
let playersTimer = null;
let meTimer = null;
let currentMapFilter = null; // Stores selected map name, null represents "All Maps"
let linkedAccounts = []; // Stores user's roblox accounts
const activityCache = {};

// Roblox Headshot Cache
const avatarCache = {};

// ── Auth Token Helpers ─────────────────────────────────────────────────────────
async function ensureToken() {
  if (!authToken) authToken = await getToken();

  if (!authToken) {
    window.location.replace("/login.html");
    return null;
  }

  return authToken;
}

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// ── Roblox Avatar Fetcher (Capped & Batch-processed) ───────────────────────────
async function fetchAvatars(userIds) {
  // Filter out invalid, duplicate, or already-cached IDs
  const toFetch = [...new Set(userIds)]
    .map(id => String(id).trim())
    .filter(id => id && !avatarCache[id] && !isNaN(parseInt(id, 10)) && parseInt(id, 10) > 0);

  if (toFetch.length === 0) return;

  // Mark items as loading to prevent duplicate requests
  toFetch.forEach(id => {
    avatarCache[id] = "loading";
  });

  try {
    const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${toFetch.join(",")}&size=48x48&format=Png&isCircular=true`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.data) {
        data.data.forEach(item => {
          if (item.state === "Completed" && item.imageUrl) {
            avatarCache[item.targetId] = item.imageUrl;
          } else {
            avatarCache[item.targetId] = null; // Fallback
          }
        });
      }
    }
  } catch (err) {
    console.warn("Failed to fetch Roblox avatar headshots:", err);
  } finally {
    // Clear loading placeholders for any failed requests
    toFetch.forEach(id => {
      if (avatarCache[id] === "loading") {
        avatarCache[id] = null;
      }
    });
  }
}

// ── Lua Script Generator (From server's message.txt) ─────────────────────────
async function buildLuaScript(scriptKey) {
  const res = await fetch("/message.txt", { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`โหลดไฟล์ message.txt ไม่สำเร็จ: ${res.status}`);
  }

  let script = await res.text();

  script = script.replaceAll(
    'Key = "เอา_script_key_จากหน้าเว็บมาใส่ตรงนี้"',
    `Key = "${scriptKey}"`
  );

  script = script.replaceAll(
    '["X-Dashboard-Key"] = cfg.Key or ""',
    '["X-Script-Key"] = cfg.Key or ""'
  );

  if (!script.includes("script_key = cfg.Key")) {
    script = script.replace(
      "key = cfg.Key,",
      "key = cfg.Key,\n        script_key = cfg.Key,"
    );
  }

  // Ensure Roblox script points to the current website's origin + /roblox/update
  script = script.replace(
    /Url\s*=\s*["']([^"']+)["']/g,
    `Url = "${window.location.origin}/roblox/update"`
  );

  return script;
}

// ── Utility Formatting Functions ──────────────────────────────────────────────
function formatNumber(v) {
  return Number(v || 0).toLocaleString("en-US");
}

async function stopPollingAndLogin() {
  if (playersTimer) clearInterval(playersTimer);
  if (meTimer) clearInterval(meTimer);

  playersTimer = null;
  meTimer = null;
  authToken = null;

  await clearSession();
  window.location.replace("/login.html");
}

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((serverNow - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;

  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;

  return `${Math.floor(m / 60)}h ago`;
}

function isOnline(p) {
  return serverNow - Number(p.updatedAt || 0) < 30000;
}

function getPlayerStatus(p) {
  const isPOnline = isOnline(p);
  if (!isPOnline) return "offline";

  const scriptStatus = String(p.status || "").toLowerCase();
  if (scriptStatus.includes("farm")) {
    return "farming";
  }

  // Key is based on userId and the placeId (to track per-map status)
  const key = `${p.userId}_${p.placeId || "unknown"}`;
  const currentCoins = Number(p.coins || 0);
  const currentUnitsStr = JSON.stringify(p.units || {});

  if (!activityCache[key]) {
    activityCache[key] = {
      lastCoins: currentCoins,
      lastUnits: currentUnitsStr,
      lastChangeTime: p.updatedAt || Date.now()
    };
  } else {
    const cached = activityCache[key];
    if (cached.lastCoins !== currentCoins || cached.lastUnits !== currentUnitsStr) {
      cached.lastCoins = currentCoins;
      cached.lastUnits = currentUnitsStr;
      cached.lastChangeTime = Date.now();
    }
  }

  const timeSinceLastChange = Date.now() - activityCache[key].lastChangeTime;
  if (timeSinceLastChange < 120000) {
    return "farming";
  }

  return "online";
}

function cinemaCount(u = {}) {
  return Number(
    u.Cinema ?? u.Cenima ?? u.cinema ?? u.cenima ?? u.TITAN ?? u.titan ?? 0
  );
}

// ── Dynamic total: sum ALL numeric values in units object ────────────────────
function sumAllUnits(u = {}) {
  let total = 0;
  for (const val of Object.values(u)) {
    if (typeof val === "number") total += val;
    else if (typeof val === "string" && !isNaN(Number(val))) total += Number(val);
  }
  return total;
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── Sorting Logic ─────────────────────────────────────────────────────────────
function sortedPlayers(list) {
  const sort = sortSelect?.value || "updated";

  return [...list].sort((a, b) => {
    if (sort === "coins") return (b.coins || 0) - (a.coins || 0);
    if (sort === "updated") return (b.updatedAt || 0) - (a.updatedAt || 0);

    // Dynamic sorting for dynamically discovered item columns
    const cols = getActiveColumns();
    const matchedCol = cols.find(c => c.sortKey === sort);
    if (matchedCol) {
      const valA = matchedCol.getter ? matchedCol.getter(a.units) : (a.units || {})[matchedCol.key];
      const valB = matchedCol.getter ? matchedCol.getter(b.units) : (b.units || {})[matchedCol.key];

      if (matchedCol.isText) {
        const strA = String(valA || "").toLowerCase();
        const strB = String(valB || "").toLowerCase();
        return strA.localeCompare(strB);
      } else {
        return Number(valB || 0) - Number(valA || 0);
      }
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

// ── Toast Notifications ───────────────────────────────────────────────────────
let toastTimer;

function showToast(msg, type = "info") {
  if (!copyToast) return;

  copyToast.textContent = msg;
  copyToast.className = `copy-toast toast-${type}`;
  copyToast.style.display = "flex";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    copyToast.style.display = "none";
  }, 2000);
}

async function copyToClipboard(text) {
  if (!text) {
    showToast("ไม่มีข้อความให้คัดลอก", "warn");
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกสำเร็จ ✓", "ok");
    return true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);

    showToast(ok ? "คัดลอกสำเร็จ ✓" : "คัดลอกไม่สำเร็จ", ok ? "ok" : "error");
    return ok;
  }
}

// ── Render Map Tabs (Sidebar) ────────────────────────────────────────────────
function renderMapTabs() {
  if (!mapTabsListEl) return;

  // Group players by map (placeName fallback to placeId)
  const mapCounts = {};

  // Initialize known maps with 0 to ensure they always display and are clickable
  Object.values(KNOWN_MAPS).forEach(mapName => {
    if (mapName && mapName !== "Unknown Place") {
      mapCounts[mapName] = 0;
    }
  });

  players.forEach(p => {
    const mapName = getMapName(p);
    mapCounts[mapName] = (mapCounts[mapName] || 0) + 1;
  });

  const allMapsCountEl = document.getElementById("allMapsCount");
  if (allMapsCountEl) allMapsCountEl.textContent = players.length;

  // Update "All Maps" active style
  const allBtn = mapTabsListEl.querySelector('[data-map="all"]');
  if (allBtn) {
    if (!currentMapFilter) {
      allBtn.classList.add("active");
    } else {
      allBtn.classList.remove("active");
    }
  }

  // Clear dynamic maps tabs
  const dynamicBtns = mapTabsListEl.querySelectorAll('.map-tab-btn:not([data-map="all"])');
  dynamicBtns.forEach(btn => btn.remove());

  // Render maps tabs
  const html = Object.entries(mapCounts).map(([mapName, count]) => {
    const activeClass = currentMapFilter === mapName ? 'active' : '';
    return `
      <button class="map-tab-btn ${activeClass}" data-map="${escapeHtml(mapName)}">
        <span>${escapeHtml(mapName)}</span>
        <span class="map-tab-count">${count}</span>
      </button>
    `;
  }).join("");

  mapTabsListEl.insertAdjacentHTML('beforeend', html);
}

// ── Helper: Get active columns statically defined or merged for All Maps ────────
function getActiveColumns() {
  if (currentMapFilter && MAP_COLUMNS[currentMapFilter]) {
    return MAP_COLUMNS[currentMapFilter];
  }
  // ถ้าเป็น "All Maps" ให้รวมคอลัมน์ของทุกแมพ
  const cols = [];
  Object.values(MAP_COLUMNS).forEach(mapCols => {
    mapCols.forEach(c => {
      if (!cols.some(ac => ac.key === c.key)) {
        cols.push(c);
      }
    });
  });
  return cols;
}

// ── Helper: Update sort dropdown based on active columns ─────────────────────
function updateSortOptions() {
  if (!sortSelect) return;
  const cols = getActiveColumns();
  const currentValue = sortSelect.value;

  // Keep coins and updated, then add column-specific sorts
  const baseOptions = [];
  if (currentMapFilter !== "Survive Zombie Arena") {
    baseOptions.push({ value: "coins", label: "Coins - highest" });
  }
  baseOptions.push({ value: "updated", label: "Last Update" });

  const colOptions = cols
    .filter(c => c.sortKey)
    .map(c => ({ value: c.sortKey, label: `${c.label} highest` }));

  const allOptions = [...baseOptions, ...colOptions];

  sortSelect.innerHTML = allOptions.map(opt =>
    `<option value="${opt.value}">${escapeHtml(opt.label)}</option>`
  ).join("");

  // Try to restore previous selection
  if (allOptions.some(o => o.value === currentValue)) {
    sortSelect.value = currentValue;
  } else {
    sortSelect.value = currentMapFilter === "Survive Zombie Arena" ? "updated" : "coins";
  }
}

// ── Render Main Roster Table ──────────────────────────────────────────────────
function render() {
  const query = searchInput?.value.trim().toLowerCase() || "";

  // Update sort dropdown for current map view
  updateSortOptions();

  if (!currentMapFilter || currentMapFilter === "all") {
    rowsEl.innerHTML = `<tr><td colspan="5" class="empty-table-state" style="text-align: center; padding: 60px;">กรุณาเลือกแมพทางด้านซ้ายเพื่อดูข้อมูลบัญชี...</td></tr>`;
    document.querySelectorAll(".col-toilet").forEach(el => el.style.display = "none");
    document.querySelectorAll(".col-zombie").forEach(el => el.style.display = "none");
    document.querySelectorAll(".col-coins").forEach(el => el.style.display = "");
    if (totalCoinsEl && totalCoinsEl.parentElement) {
      totalCoinsEl.parentElement.style.display = "block";
    }
    return;
  }

  // Filter players by Search query AND selected Sidebar Map Filter
  const filteredMapped = sortedPlayers(players).map((p) => {
    // If there is a map filter, map the player properties to that map's state if it exists
    if (currentMapFilter) {
      const mState = p.mapStates && p.mapStates[currentMapFilter];
      if (!mState) {
        // Player has never played this map, mark matchesMap as false to hide them
        return { ...p, matchesMap: false };
      }
      return {
        ...p,
        matchesMap: true,
        coins: mState.coins,
        status: mState.status,
        updatedAt: mState.updatedAt,
        units: mState.units
      };
    }
    // For All Maps, all players match, and we use root properties
    return { ...p, matchesMap: true };
  });

  const filtered = filteredMapped.filter((p) => {
    const matchesSearch = `${p.userId} ${p.name} ${p.displayName}`.toLowerCase().includes(query);
    return matchesSearch && p.matchesMap;
  });

  const online = filtered.filter(isOnline).length;
  const totalCoins = filtered.reduce((s, p) => s + Number(p.coins || 0), 0);
  const totalUnits = filtered.reduce((s, p) => s + sumAllUnits(p.units), 0);
  
  const totalCredits = filtered.reduce((s, p) => {
    const u = p.units || {};
    return s + Number(u.Credits ?? u.credits ?? 0);
  }, 0);
  
  const totalVoidShards = filtered.reduce((s, p) => {
    const u = p.units || {};
    return s + Number(u.VoidShards ?? u.voidshards ?? u.void_shards ?? 0);
  }, 0);

  // Update Counters
  if (onlineCountEl) onlineCountEl.textContent = formatNumber(online);
  if (totalCoinsEl) {
    totalCoinsEl.textContent = formatNumber(totalCoins);
  }
  if (totalUnitsEl) totalUnitsEl.textContent = formatNumber(totalUnits);
  if (totalCreditsEl) totalCreditsEl.textContent = formatNumber(totalCredits);
  if (totalVoidShardsEl) totalVoidShardsEl.textContent = formatNumber(totalVoidShards);

  if (tableCountLabel) {
    tableCountLabel.textContent = filtered.length
      ? `แสดงบัญชีที่คัดกรองอยู่ ${formatNumber(filtered.length)} จากทั้งหมด ${formatNumber(players.length)} บัญชี`
      : "Roster standby — ยังไม่มีบัญชีรันระบบสคริปต์";
  }

  // Determine visibility states
  let showCoins = true;
  let showToilet = false;
  let showZombie = false;

  if (currentMapFilter === "[LEGACY] Toilet Tower Defense") {
    showToilet = true;
    showZombie = false;
    showCoins = true;
  } else if (currentMapFilter === "Survive Zombie Arena") {
    showToilet = false;
    showZombie = true;
    showCoins = false;
  } else {
    // Map All
    showToilet = false;
    showZombie = false;
    showCoins = true;
  }

  const colSpan = 5 + (showToilet ? 3 : 0) + (showZombie ? 3 : 0) - (showCoins ? 0 : 1);

  // Toggle display properties of columns (both th in thead and new td in tbody)
  document.querySelectorAll(".col-toilet").forEach(el => el.style.display = showToilet ? "" : "none");
  document.querySelectorAll(".col-zombie").forEach(el => el.style.display = showZombie ? "" : "none");
  document.querySelectorAll(".col-coins").forEach(el => el.style.display = showCoins ? "" : "none");

  // Show hide footer wrappers
  if (currentMapFilter === "Survive Zombie Arena") {
    if (footerCoinsWrapper) footerCoinsWrapper.style.display = "none";
    if (footerUnitsWrapper) footerUnitsWrapper.style.display = "none";
    if (footerCreditsWrapper) footerCreditsWrapper.style.display = "block";
    if (footerVoidShardsWrapper) footerVoidShardsWrapper.style.display = "block";
  } else {
    if (footerCoinsWrapper) footerCoinsWrapper.style.display = showCoins ? "block" : "none";
    if (footerUnitsWrapper) footerUnitsWrapper.style.display = "block";
    if (footerCreditsWrapper) footerCreditsWrapper.style.display = "none";
    if (footerVoidShardsWrapper) footerVoidShardsWrapper.style.display = "none";
    
    if (totalUnitsLabelEl) {
      totalUnitsLabelEl.textContent = "Total units";
    }
  }

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="${colSpan}" class="empty-table-state">ยังไม่มีข้อมูลบัญชีในแผนที่นี้ — กรุณารัน Script ใน Roblox ก่อนนะ</td></tr>`;
    return;
  }

  // Generate table rows HTML
  rowsEl.innerHTML = filtered.map((p) => {
    const u = p.units || {};
    const isPOnline = isOnline(p);
    const statusVal = getPlayerStatus(p);
    const statusCls = statusVal; // "farming", "online", or "offline"
    let statusText = "Offline";
    if (statusVal === "farming") {
      statusText = "Farming";
    } else if (statusVal === "online") {
      statusText = escapeHtml(p.status || "Online");
    }
    const avatarUrl = avatarCache[p.userId] || "";

    // Metrics for Toilet Tower Defense
    const utc = Number(u.UTC ?? u.utc ?? 0);
    const uts = Number(u.UTS ?? u.uts ?? 0);
    const cinema = cinemaCount(u);

    // Metrics for Survive Zombie Arena
    const credits = Number(u.Credits ?? u.credits ?? 0);
    const voidShards = Number(u.VoidShards ?? u.voidshards ?? u.void_shards ?? 0);
    const szaClass = u.Class ?? u.class ?? u.SelectedClass ?? "—";

    return `
      <tr>
        <td>
          <div class="td-player-profile">
            <div class="player-avatar" data-avatar-id="${escapeHtml(p.userId)}">
              ${avatarUrl && avatarUrl !== "loading" 
                ? `<img src="${avatarUrl}" alt="${escapeHtml(p.name)}" />` 
                : `<span class="badge-avatar-fallback">${escapeHtml((p.displayName || p.name || "?").substring(0, 1).toUpperCase())}</span>`}
            </div>
            <div class="player-info-meta">
              <span class="player-name-main">${escapeHtml(p.displayName || p.name || "Unknown")}</span>
              <span class="player-id-sub">@${escapeHtml(p.name)} | ID: ${escapeHtml(String(p.userId || p.id || "-"))}${p.placeName ? ' | ' + escapeHtml(p.placeName) : ''}</span>
            </div>
          </div>
        </td>
        <td class="col-coins"><span class="metric-number coin-metric">${formatNumber(p.coins)}</span></td>
        
        <!-- Survive Zombie Arena -->
        <td class="col-zombie"><span class="metric-number credits-metric">${formatNumber(credits)}</span></td>
        <td class="col-zombie"><span class="metric-number voidshards-metric">${formatNumber(voidShards)}</span></td>
        <td class="col-zombie"><span class="metric-text class-metric">${escapeHtml(szaClass)}</span></td>

        <!-- Toilet Tower Defense -->
        <td class="col-toilet"><span class="metric-number utc-metric">${formatNumber(utc)}</span></td>
        <td class="col-toilet"><span class="metric-number uts-metric">${formatNumber(uts)}</span></td>
        <td class="col-toilet"><span class="metric-number cinema-metric">${formatNumber(cinema)}</span></td>

        <td>
          <span class="status-pill ${statusCls}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
        </td>
        <td><span class="time-update ${!isPOnline ? 'offline' : ''}">${timeAgo(p.updatedAt || 0)}</span></td>
        <td>
          <button class="btn-delete-roster-id" data-delete-id="${escapeHtml(String(p.userId || p.id || ""))}" data-delete-name="${escapeHtml(p.displayName || p.name || "")}" title="ลบไอดีออกจากระบบ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            <span>DELETE</span>
          </button>
        </td>
      </tr>`;
  }).join("");

  // Batch-fetch avatars in the background
  const playerIds = filtered.map(p => p.userId).filter(Boolean);
  fetchAvatars(playerIds).then(() => {
    // Populate avatars dynamically on load
    filtered.forEach(p => {
      const cachedSrc = avatarCache[p.userId];
      if (cachedSrc && cachedSrc !== "loading") {
        const avatarDivs = rowsEl.querySelectorAll(`[data-avatar-id="${p.userId}"]`);
        avatarDivs.forEach(div => {
          if (!div.querySelector("img")) {
            div.innerHTML = `<img src="${cachedSrc}" alt="${escapeHtml(p.name)}" />`;
          }
        });
      }
    });
  });

  // Toggle display properties of columns (both th in thead and new td in tbody)
  document.querySelectorAll(".col-toilet").forEach(el => el.style.display = showToilet ? "" : "none");
  document.querySelectorAll(".col-zombie").forEach(el => el.style.display = showZombie ? "" : "none");
  document.querySelectorAll(".col-coins").forEach(el => el.style.display = showCoins ? "" : "none");

  // Show hide footer wrappers
  if (currentMapFilter === "Survive Zombie Arena") {
    if (footerCoinsWrapper) footerCoinsWrapper.style.display = "none";
    if (footerUnitsWrapper) footerUnitsWrapper.style.display = "none";
    if (footerCreditsWrapper) footerCreditsWrapper.style.display = "block";
    if (footerVoidShardsWrapper) footerVoidShardsWrapper.style.display = "block";
  } else {
    if (footerCoinsWrapper) footerCoinsWrapper.style.display = showCoins ? "block" : "none";
    if (footerUnitsWrapper) footerUnitsWrapper.style.display = "block";
    if (footerCreditsWrapper) footerCreditsWrapper.style.display = "none";
    if (footerVoidShardsWrapper) footerVoidShardsWrapper.style.display = "none";
  }
}



// ── Unlink / Delete Roblox Account ────────────────────────────────────────────
async function deleteAccount(robloxUserId, displayName) {
  if (!confirm(`ยืนยันการยกเลิกเชื่อมโยงบัญชี "${displayName}"?\nข้อมูลการออนไลน์ของบัญชีนี้จะถูกนำออกจากบอร์ดจนกว่าจะรันสคริปต์อีกครั้ง`)) return;

  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(robloxUserId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const data = await res.json();

    if (data.ok) {
      showToast(`ลบเชื่อมต่อ ${displayName} สำเร็จ`, "ok");
      await loadMe();
      await loadPlayers();
    } else {
      showToast(`ลบไม่สำเร็จ: ${data.error}`, "error");
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาดในการลบ", "error");
    console.error("deleteAccount error:", err);
  }
}

// ── Load User Account Info (/api/me) ──────────────────────────────────────────
async function loadMe() {
  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 401) {
      stopPollingAndLogin();
      return;
    }

    if (!res.ok) {
      if (manualScriptKeyEl) manualScriptKeyEl.value = "ดาวน์โหลดคีย์ล้มเหลว";
      return;
    }

    const { user } = await res.json();

    // Populate user script key
    if (manualScriptKeyEl && user.script_key) {
      manualScriptKeyEl.value = user.script_key;
    }

    // Update Username
    const username = user.username || (user.email ? user.email.split("@")[0] : "");
    if (userUsernameEl) userUsernameEl.textContent = username;
    
    // Update initials icon
    if (userAvatarInitialsEl && username) {
      userAvatarInitialsEl.textContent = username.substring(0, 1).toUpperCase();
    }

    // Render linked accounts list
    linkedAccounts = user.roblox_accounts || [];
    if (accountsCountEl) accountsCountEl.textContent = linkedAccounts.length;
  } catch (err) {
    console.warn("loadMe error:", err);
    if (manualScriptKeyEl) manualScriptKeyEl.value = "ดาวน์โหลดคีย์ล้มเหลว";
  }
}

// ── Load Roster Players (/api/players) ────────────────────────────────────────
async function loadPlayers() {
  const token = await ensureToken();
  if (!token) return;

  if (refreshBtn) {
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
  }

  try {
    const res = await fetch("/api/players", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 401) {
      stopPollingAndLogin();
      return;
    }

    if (!res.ok) {
      rowsEl.innerHTML = `<tr><td colspan="8" class="empty-table-state">เกิดข้อผิดพลาดในการโหลดข้อมูลบอร์ด</td></tr>`;
      return;
    }

    const data = await res.json();
    players = data.players || [];
    serverNow = data.now || Date.now();

    renderMapTabs();
    render();
  } catch (err) {
    console.error("loadPlayers error:", err);
    rowsEl.innerHTML = `<tr><td colspan="8" class="empty-table-state">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</td></tr>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
  }
}

// ── Bind Event Listeners ──────────────────────────────────────────────────────
copyAllBtn?.addEventListener("click", async () => {
  const keyVal = manualScriptKeyEl?.value.trim() || "";
  if (!keyVal || keyVal === "ดาวน์โหลดคีย์ล้มเหลว" || keyVal.startsWith("Loading")) {
    showToast("ยังไม่มีรหัสคีย์ประจำตัว", "warn");
    return;
  }
  try {
    showToast("กำลังคอมไพล์สคริปต์...", "info");

    const script = await buildLuaScript(keyVal);

    if (!script || script.trim().length < 20) {
      showToast("ไฟล์สคริปต์ message.txt ว่างหรือบกพร่อง", "error");
      return;
    }

    await copyToClipboard(script);
  } catch (err) {
    console.error("copy script error:", err);
    showToast("ไม่สามารถสร้างสคริปต์ได้ ดู Console log", "error");
  }
});



// Map Tab Sidebar Click Delegation
mapTabsListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest(".map-tab-btn");
  if (!btn) return;

  const mapVal = btn.getAttribute("data-map");
  if (mapVal === "all") {
    currentMapFilter = null;
  } else {
    currentMapFilter = mapVal;
  }

  renderMapTabs();
  render();
});

// Dashboard Refresh button
refreshBtn?.addEventListener("click", async () => {
  await loadPlayers();
  showToast("รีเฟรชข้อมูลบอร์ดสำเร็จ ✓", "ok");
});

// Dashboard Clear button
clearBtn?.addEventListener("click", async () => {
  // Determine which accounts are currently shown (filtered by map)
  let accountsToClear = linkedAccounts;
  if (currentMapFilter) {
    accountsToClear = linkedAccounts.filter(a => {
      const p = players.find(p => String(p.userId) === String(a.roblox_user_id));
      return p && p.mapStates && p.mapStates[currentMapFilter];
    });
  }

  if (!accountsToClear.length) {
    showToast("ไม่มีบัญชีให้ล้างข้อมูลในแมพนี้", "warn");
    return;
  }

  const mapName = currentMapFilter || "ทั้งหมด (All Maps)";
  const confirmMsg = `ต้องการยกเลิกการเชื่อมโยงบัญชีทั้งหมด (${accountsToClear.length} บัญชี) ในแมพ "${mapName}" ใช่หรือไม่?\nการดำเนินการนี้จะลบรายชื่อผู้เล่นที่แสดงอยู่ออกทั้งหมด`;
  if (!confirm(confirmMsg)) return;

  clearBtn.disabled = true;
  const originalText = clearBtn.innerHTML;
  clearBtn.innerHTML = "<span>กำลังล้างข้อมูล...</span>";

  try {
    const token = await ensureToken();
    if (!token) return;

    // Send DELETE requests in parallel
    const deletePromises = accountsToClear.map(a => 
      fetch(`/api/accounts/${encodeURIComponent(a.roblox_user_id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      }).then(res => res.json())
    );

    const results = await Promise.all(deletePromises);
    const successCount = results.filter(r => r.ok).length;

    showToast(`ล้างข้อมูลสำเร็จ ${successCount} จาก ${accountsToClear.length} บัญชี`, "ok");

    // Clear state locally and render immediately for instant feedback
    linkedAccounts = linkedAccounts.filter(a => !accountsToClear.some(ac => ac.roblox_user_id === a.roblox_user_id));
    players = players.filter(p => !accountsToClear.some(ac => String(ac.roblox_user_id) === String(p.userId)));

    renderMapTabs();
    render();

    // Reload from server to keep database and UI perfectly in sync
    await loadMe();
    await loadPlayers();
  } catch (err) {
    console.error("Clear accounts error:", err);
    showToast("เกิดข้อผิดพลาดในการล้างข้อมูล", "error");
  } finally {
    clearBtn.disabled = false;
    clearBtn.innerHTML = originalText;
  }
});

// Logout Button
logoutBtn?.addEventListener("click", async () => {
  await logout();
});

// Row Deletion Buttons delegation
rowsEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-delete-id]");
  if (!btn) return;

  const robloxId = btn.getAttribute("data-delete-id");
  const displayName = btn.getAttribute("data-delete-name");

  if (robloxId) deleteAccount(robloxId, displayName || robloxId);
});

// Live Search & Sorting listeners
searchInput?.addEventListener("input", render);
sortSelect?.addEventListener("change", render);

// ── Application Initializer ──────────────────────────────────────────────────
(async () => {
  const ok = await initGuard();
  if (!ok) return;

  await ensureToken();
  await loadMe();
  await loadPlayers();

  // Establish Auto Polling intervals
  playersTimer = setInterval(loadPlayers, 5000);
  meTimer = setInterval(loadMe, 30000);
})();
