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
const copyAllBtn = document.getElementById("copyAllBtn");
const copyToast = document.getElementById("copyToast");
const scriptKeyEl = document.getElementById("scriptKeyValue");
const scriptKeyCopyBtn = document.getElementById("scriptKeyCopyBtn");
const accountsListEl = document.getElementById("accountsList");
const accountsCountEl = document.getElementById("accountsCount");
const linkedAccountsCountBadge = document.getElementById("linkedAccountsCountBadge");
const userEmailEl = document.getElementById("userEmail");
const userAvatarInitialsEl = document.getElementById("userAvatarInitials");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const tableCountLabel = document.getElementById("tableCountLabel");
const mapTabsListEl = document.getElementById("mapTabsList");

// ── State Variables ───────────────────────────────────────────────────────────
let players = [];
let serverNow = Date.now();
let authToken = null;
let currentKey = null;
let playersTimer = null;
let meTimer = null;
let currentMapFilter = null; // Stores selected map name, null represents "All Maps"

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
    baseOptions.push({ value: "coins", label: "เหรียญ (Coins - สูงสุด)" });
  }
  baseOptions.push({ value: "updated", label: "อัปเดตล่าสุด (Last Update)" });

  const colOptions = cols
    .filter(c => c.sortKey)
    .map(c => ({ value: c.sortKey, label: `${c.label} (สูงสุด)` }));

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
  const cols = getActiveColumns();
  const showCoins = currentMapFilter !== "Survive Zombie Arena";
  const colSpan = (showCoins ? 5 : 4) + cols.length; // Account + Coins (optional) + cols + Status + Update + Action

  // Update sort dropdown for current map view
  updateSortOptions();

  // Update table headers dynamically
  const thead = document.querySelector(".roster-table thead tr");
  if (thead) {
    const colHeaders = cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
    thead.innerHTML = `
      <th>บัญชีผู้ใช้ (Account)</th>
      ${showCoins ? '<th>Coins (เหรียญ)</th>' : ''}
      ${colHeaders}
      <th>สถานะ (Status)</th>
      <th>อัปเดตล่าสุด (Last Update)</th>
      <th>จัดการ (Action)</th>
    `;
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

  // Update Counters
  if (onlineCountEl) onlineCountEl.textContent = formatNumber(online);
  if (totalCoinsEl) {
    totalCoinsEl.textContent = formatNumber(totalCoins);
    if (totalCoinsEl.parentElement) {
      totalCoinsEl.parentElement.style.display = showCoins ? "block" : "none";
    }
  }
  if (totalUnitsEl) totalUnitsEl.textContent = formatNumber(totalUnits);
  if (tableCountLabel) {
    tableCountLabel.textContent = filtered.length
      ? `แสดงบัญชีที่คัดกรองอยู่ ${formatNumber(filtered.length)} จากทั้งหมด ${formatNumber(players.length)} บัญชี`
      : "Roster standby — ยังไม่มีบัญชีรันระบบสคริปต์";
  }

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="${colSpan}" class="empty-table-state">ยังไม่มีข้อมูลบัญชีในแผนที่นี้ — กรุณารัน Script ใน Roblox ก่อนนะ</td></tr>`;
    return;
  }

  // Generate table rows HTML
  rowsEl.innerHTML = filtered.map((p) => {
    const u = p.units || {};
    const isPOnline = isOnline(p);
    const statusCls = isPOnline ? "online" : "offline";
    const statusText = isPOnline ? escapeHtml(p.status || "Active") : "Offline";
    const avatarUrl = avatarCache[p.userId] || "";

    // Build column cells dynamically
    const colCells = cols.map(c => {
      if (c.isText) {
        const val = u[c.key] || "—";
        return `<td><span class="metric-text ${c.key.toLowerCase()}-metric">${escapeHtml(String(val))}</span></td>`;
      }
      const val = c.getter ? c.getter(u) : Number(u[c.key] || 0);
      return `<td><span class="metric-number ${c.key.toLowerCase()}-metric">${formatNumber(val)}</span></td>`;
    }).join("");

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
        ${showCoins ? `<td><span class="metric-number coin-metric">${formatNumber(p.coins)}</span></td>` : ""}
        ${colCells}
        <td>
          <span class="status-pill ${statusCls}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
        </td>
        <td><span class="time-update ${!isPOnline ? 'offline' : ''}">${timeAgo(p.updatedAt || 0)}</span></td>
        <td>
          <button class="btn-copy-roster-id" data-copy="${escapeHtml(String(p.userId || p.id || ""))}"></button>
        </td>
      </tr>`;
  }).join("");

  // Fix button text contents securely (to keep it neat)
  rowsEl.querySelectorAll(".btn-copy-roster-id").forEach(btn => {
    btn.textContent = "Copy ID";
  });

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
}

// ── Render Roblox Account Badges ──────────────────────────────────────────────
function renderAccounts(accounts) {
  if (!accountsListEl) return;

  if (!accounts.length) {
    accountsListEl.innerHTML = `<span class="accounts-empty-state">ยังไม่มี Roblox account เชื่อมโยง — รัน script ก่อนนะ</span>`;
    if (linkedAccountsCountBadge) linkedAccountsCountBadge.textContent = "0";
    return;
  }

  if (linkedAccountsCountBadge) linkedAccountsCountBadge.textContent = accounts.length;

  accountsListEl.innerHTML = accounts.map((a) => {
    const label = escapeHtml(a.display_name || a.roblox_username || a.roblox_user_id);
    const sub = escapeHtml(a.roblox_username || "");
    const lastSeen = a.last_seen_at ? new Date(a.last_seen_at).toLocaleString("th-TH") : "-";
    const avatarUrl = avatarCache[a.roblox_user_id] || "";

    return `
      <div class="roblox-badge" title="Last seen: ${lastSeen}">
        <div class="badge-avatar" data-badge-avatar-id="${escapeHtml(a.roblox_user_id)}">
          ${avatarUrl && avatarUrl !== "loading" 
            ? `<img src="${avatarUrl}" alt="${label}" />` 
            : `<span class="badge-avatar-fallback">${escapeHtml(label.substring(0, 1).toUpperCase())}</span>`}
        </div>
        <div class="badge-info">
          <span class="badge-display-name">${label}</span>
          ${sub && sub !== label ? `<span class="badge-username">@${sub}</span>` : ""}
        </div>
        <button
          class="btn-unlink-roblox"
          data-roblox-id="${escapeHtml(a.roblox_user_id)}"
          data-roblox-name="${escapeHtml(a.roblox_username || a.roblox_user_id)}"
          title="ยกเลิกการเชื่อมต่อบัญชีนี้"
          aria-label="ยกเลิก ${label}"
        >×</button>
      </div>`;
  }).join("");

  // Batch fetch Roblox avatars for linked badges
  const ids = accounts.map(a => a.roblox_user_id);
  fetchAvatars(ids).then(() => {
    accounts.forEach(a => {
      const cachedSrc = avatarCache[a.roblox_user_id];
      if (cachedSrc && cachedSrc !== "loading") {
        const avatarDivs = accountsListEl.querySelectorAll(`[data-badge-avatar-id="${a.roblox_user_id}"]`);
        avatarDivs.forEach(div => {
          if (!div.querySelector("img")) {
            div.innerHTML = `<img src="${cachedSrc}" alt="${escapeHtml(a.display_name || a.roblox_username)}" />`;
          }
        });
      }
    });
  });
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
      if (scriptKeyEl) scriptKeyEl.textContent = "ดาวน์โหลดคีย์ล้มเหลว";
      return;
    }

    const { user } = await res.json();

    // Update Email
    if (userEmailEl) userEmailEl.textContent = user.email || "";
    
    // Update initials icon
    if (userAvatarInitialsEl && user.email) {
      userAvatarInitialsEl.textContent = user.email.substring(0, 1).toUpperCase();
    }

    // Update Script Key
    if (scriptKeyEl) {
      scriptKeyEl.textContent = user.script_key || "ยังไม่มี Script Key";
    }

    currentKey = user.script_key || null;

    // Render linked accounts list
    const accounts = user.roblox_accounts || [];
    if (accountsCountEl) accountsCountEl.textContent = accounts.length;
    renderAccounts(accounts);
  } catch (err) {
    console.warn("loadMe error:", err);
    if (scriptKeyEl) scriptKeyEl.textContent = "ดาวน์โหลดคีย์ล้มเหลว";
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
scriptKeyCopyBtn?.addEventListener("click", () => {
  const key = scriptKeyEl?.textContent?.trim();

  if (!key || key.includes("กำลัง") || key.includes("ไม่มี") || key.includes("ล้มเหลว")) {
    showToast("ยังไม่มีคีย์ให้คัดลอกในขณะนี้", "warn");
    return;
  }

  copyToClipboard(key);
});

copyAllBtn?.addEventListener("click", async () => {
  if (!currentKey) {
    showToast("กรุณารอโหลด หรือเชื่อมโยงบัญชีเพื่อรับคีย์ก่อน", "warn");
    return;
  }

  try {
    showToast("กำลังคอมไพล์สคริปต์...", "info");

    const script = await buildLuaScript(currentKey);

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

// Accounts Badges Unlinking
accountsListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-unlink-roblox");
  if (!btn) return;

  const robloxId = btn.getAttribute("data-roblox-id");
  const robloxName = btn.getAttribute("data-roblox-name");

  if (robloxId) deleteAccount(robloxId, robloxName || robloxId);
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

// Logout Button
logoutBtn?.addEventListener("click", async () => {
  await logout();
});

// Row Copy Buttons delegation
rowsEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (btn) copyToClipboard(btn.getAttribute("data-copy") ?? "");
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
