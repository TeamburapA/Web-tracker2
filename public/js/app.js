/**
 * app.js — Redesigned Dashboard controller (ES Module)
 */
import { getToken, logout, initGuard, clearSession } from "./auth.js";

const KNOWN_MAPS = {
  "93712201161812": "LEGACY | Lobby",
  "13775256536": "[LEGACY] Toilet Tower Defense",
  "unknown": "Unknown Place"
};


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
    if (sort === "utc") return (b.units?.UTC || 0) - (a.units?.UTC || 0);
    if (sort === "uts") return (b.units?.UTS || 0) - (a.units?.UTS || 0);
    if (sort === "cinema") {
      return cinemaCount(b.units) - cinemaCount(a.units);
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
  players.forEach(p => {
    const rawMapName = p.placeName || p.placeId || "Unknown Map";
    const mapName = KNOWN_MAPS[rawMapName] || KNOWN_MAPS[p.placeId] || rawMapName;
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

// ── Render Main Roster Table ──────────────────────────────────────────────────
function render() {
  const query = searchInput?.value.trim().toLowerCase() || "";

  // Filter players by Search query AND selected Sidebar Map Filter
  const filtered = sortedPlayers(players).filter((p) => {
    const matchesSearch = `${p.userId} ${p.name} ${p.displayName}`.toLowerCase().includes(query);
    const rawMapName = p.placeName || p.placeId || "Unknown Map";
    const mapName = KNOWN_MAPS[rawMapName] || KNOWN_MAPS[p.placeId] || rawMapName;
    const matchesMap = !currentMapFilter || mapName === currentMapFilter;
    return matchesSearch && matchesMap;
  });

  const online = players.filter(isOnline).length;
  const totalCoins = players.reduce((s, p) => s + Number(p.coins || 0), 0);
  const totalUnits = players.reduce((s, p) => {
    const u = p.units || {};
    return s + Number(u.UTC || 0) + Number(u.UTS || 0) + cinemaCount(u);
  }, 0);

  // Update Counters
  if (onlineCountEl) onlineCountEl.textContent = formatNumber(online);
  if (totalCoinsEl) totalCoinsEl.textContent = formatNumber(totalCoins);
  if (totalUnitsEl) totalUnitsEl.textContent = formatNumber(totalUnits);
  if (tableCountLabel) {
    tableCountLabel.textContent = filtered.length
      ? `แสดงบัญชีที่คัดกรองอยู่ ${formatNumber(filtered.length)} จากทั้งหมด ${formatNumber(players.length)} บัญชี`
      : "Roster standby — ยังไม่มีบัญชีรันระบบสคริปต์";
  }

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="8" class="empty-table-state">ยังไม่มีข้อมูลบัญชีในแผนที่นี้ — กรุณารัน Script ใน Roblox ก่อนนะ</td></tr>`;
    return;
  }

  // Generate table rows HTML
  rowsEl.innerHTML = filtered.map((p) => {
    const u = p.units || {};
    const isPOnline = isOnline(p);
    const statusCls = isPOnline ? "online" : "offline";
    const statusText = escapeHtml(p.status || (isPOnline ? "Active" : "Offline"));
    const cinemaValue = cinemaCount(u);
    const avatarUrl = avatarCache[p.userId] || "";

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
              <span class="player-id-sub">@${escapeHtml(p.name)} | ID: ${escapeHtml(String(p.userId || p.id || "-"))}</span>
            </div>
          </div>
        </td>
        <td><span class="metric-number coin-metric">${formatNumber(p.coins)}</span></td>
        <td><span class="metric-number utc-metric">${formatNumber(u.UTC)}</span></td>
        <td><span class="metric-number uts-metric">${formatNumber(u.UTS)}</span></td>
        <td><span class="metric-number cinema-metric">${formatNumber(cinemaValue)}</span></td>
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
