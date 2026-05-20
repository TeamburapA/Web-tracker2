/**
 * app.js — Dashboard frontend (ES Module)
 */
import { getToken, logout } from "./auth.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────
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
const userEmailEl = document.getElementById("userEmail");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");

let players = [];
let serverNow = Date.now();
let authToken = null;
let currentKey = null;

// ── Auth token ────────────────────────────────────────────────────────────────
async function ensureToken() {
  if (!authToken) authToken = await getToken();

  if (!authToken) {
    window.location.href = "/login.html";
    return null;
  }

  return authToken;
}
// ── Lua script template from public/message.txt ───────────────────────────────
async function buildLuaScript(scriptKey) {
  const res = await fetch("/message.txt", { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`โหลด message.txt ไม่สำเร็จ: ${res.status}`);
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

// ── Formatting ────────────────────────────────────────────────────────────────
function formatNumber(v) {
  return Number(v || 0).toLocaleString("en-US");
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

function escapeHtml(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── Sort ──────────────────────────────────────────────────────────────────────
function sortedPlayers(list) {
  const sort = sortSelect?.value || "updated";

  return [...list].sort((a, b) => {
    if (sort === "coins") return (b.coins || 0) - (a.coins || 0);
    if (sort === "utc") return (b.units?.UTC || 0) - (a.units?.UTC || 0);
    if (sort === "uts") return (b.units?.UTS || 0) - (a.units?.UTS || 0);
    if (sort === "cinema") {
      return (b.units?.Cinema || b.units?.Cenima || 0) - (a.units?.Cinema || a.units?.Cenima || 0);
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;

function showToast(msg, type = "info") {
  if (!copyToast) return;

  copyToast.textContent = msg;
  copyToast.className = `copy-toast toast-${type}`;
  copyToast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    copyToast.hidden = true;
  }, 2000);
}

async function copyToClipboard(text) {
  if (!text) {
    showToast("ไม่มีข้อความให้คัดลอก", "warn");
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกแล้ว ✓", "ok");
    return true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);

    showToast(ok ? "คัดลอกแล้ว ✓" : "คัดลอกไม่สำเร็จ", ok ? "ok" : "error");
    return ok;
  }
}

// ── Render dashboard table ────────────────────────────────────────────────────
function render() {
  const query = searchInput?.value.trim().toLowerCase() || "";

  const filtered = sortedPlayers(players).filter((p) => {
    return `${p.userId} ${p.name} ${p.displayName}`.toLowerCase().includes(query);
  });

  const online = players.filter(isOnline).length;
  const totalCoins = players.reduce((s, p) => s + Number(p.coins || 0), 0);
  const totalUnits = players.reduce((s, p) => {
    const u = p.units || {};
    return s + Number(u.UTC || 0) + Number(u.UTS || 0) + Number(u.TITAN || 0) + Number(u.Cinema || u.Cenima || 0);
  }, 0);

  if (onlineCountEl) onlineCountEl.textContent = formatNumber(online);
  if (totalCoinsEl) totalCoinsEl.textContent = formatNumber(totalCoins);
  if (totalUnitsEl) totalUnitsEl.textContent = formatNumber(totalUnits);

  if (!filtered.length) {
    rowsEl.innerHTML = `<tr><td colspan="9" class="empty">ยังไม่มีข้อมูล — รัน script ใน Roblox ก่อนนะ</td></tr>`;
    return;
  }

  rowsEl.innerHTML = filtered.map((p) => {
    const u = p.units || {};
    const cinemaVal = u.Cinema || u.Cenima || 0;
    const offCls = isOnline(p) ? "" : " offline";

    return `
      <tr>
        <td class="account">
          <strong>${escapeHtml(p.name || "Unknown")}</strong>
          <span>ID: ${escapeHtml(String(p.userId || p.id || "-"))}</span>
        </td>
        <td class="num">${formatNumber(p.coins)}</td>
        <td class="num utc">${formatNumber(u.UTC)}</td>
        <td class="num uts">${formatNumber(u.UTS)}</td>
        <td class="num titan">${formatNumber(u.TITAN)}</td>
        <td class="num cenima">${formatNumber(cinemaVal)}</td>
        <td><span class="pill${offCls}"><span class="dot"></span>${escapeHtml(p.status || "Online")}</span></td>
        <td class="${offCls.trim()}">${timeAgo(p.updatedAt || 0)}</td>
        <td><button class="btn-copy btn-copy-row" data-copy="${escapeHtml(String(p.userId || p.id || ""))}">Copy</button></td>
      </tr>`;
  }).join("");
}

// ── Render Roblox account badges ──────────────────────────────────────────────
function renderAccounts(accounts) {
  if (!accountsListEl) return;

  if (!accounts.length) {
    accountsListEl.innerHTML = `<span class="account-empty">ยังไม่มี Roblox account — รัน script ก่อน</span>`;
    return;
  }

  accountsListEl.innerHTML = accounts.map((a) => {
    const label = escapeHtml(a.display_name || a.roblox_username || a.roblox_user_id);
    const sub = escapeHtml(a.roblox_username || "");
    const lastSeen = a.last_seen_at ? new Date(a.last_seen_at).toLocaleString("th-TH") : "-";

    return `
      <span class="account-badge" title="Last seen: ${lastSeen}">
        🎮 <span class="badge-name">${label}</span>
        ${sub && sub !== label ? `<span class="badge-sub">@${sub}</span>` : ""}
        <button
          class="btn-unlink"
          data-roblox-id="${escapeHtml(a.roblox_user_id)}"
          data-roblox-name="${escapeHtml(a.roblox_username || a.roblox_user_id)}"
          title="ยกเลิก account นี้"
          aria-label="ยกเลิก ${label}"
        >×</button>
      </span>`;
  }).join("");
}

// ── Delete / unlink Roblox account ───────────────────────────────────────────
async function deleteAccount(robloxUserId, displayName) {
  if (!confirm(`ยืนยันการยกเลิก "${displayName}"?\nบัญชีนี้จะถูกลบออกจาก dashboard`)) return;

  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(robloxUserId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const data = await res.json();

    if (data.ok) {
      showToast(`ลบ ${displayName} แล้ว`, "ok");
      await loadMe();
      await loadPlayers();
    } else {
      showToast(`ลบไม่สำเร็จ: ${data.error}`, "error");
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาด", "error");
    console.error("deleteAccount error:", err);
  }
}

// ── Load /api/me ──────────────────────────────────────────────────────────────
async function loadMe() {
  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch("/api/me", { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return;

    const { user } = await res.json();

    if (userEmailEl) userEmailEl.textContent = user.email || "";

    if (scriptKeyEl && user.script_key) {
      scriptKeyEl.textContent = user.script_key;
      currentKey = user.script_key;
    }

    const accounts = user.roblox_accounts || [];

    if (accountsCountEl) accountsCountEl.textContent = accounts.length;
    renderAccounts(accounts);
  } catch (err) {
    console.warn("loadMe error:", err);
  }
}

// ── Load /api/players ─────────────────────────────────────────────────────────
async function loadPlayers() {
  const token = await ensureToken();
  if (!token) return;

  if (refreshBtn) {
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
  }

  try {
    const res = await fetch("/api/players", { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) return;

    const data = await res.json();
    players = data.players || [];
    serverNow = data.now || Date.now();

    render();
  } catch {
    rowsEl.innerHTML = `<tr><td colspan="9" class="empty">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</td></tr>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
  }
}

// ── Script key copy ───────────────────────────────────────────────────────────
copyAllBtn?.addEventListener("click", async () => {
  if (!currentKey) {
    showToast("ยังไม่มี Script Key กรุณารอโหลดหรือล็อกอินใหม่", "warn");
    return;
  }

  try {
    showToast("กำลังสร้าง Script...", "info");

    const script = await buildLuaScript(currentKey);

    if (!script || script.trim().length < 20) {
      showToast("message.txt ว่างหรือโหลดไม่ได้", "error");
      return;
    }

    await copyToClipboard(script);
  } catch (err) {
    console.error("copy script error:", err);
    showToast("Copy Script ไม่สำเร็จ ดู Console", "error");
  }
});

// ── Unlink buttons ────────────────────────────────────────────────────────────
accountsListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-unlink");
  if (!btn) return;

  const robloxId = btn.getAttribute("data-roblox-id");
  const robloxName = btn.getAttribute("data-roblox-name");

  if (robloxId) deleteAccount(robloxId, robloxName || robloxId);
});

// ── Refresh button ────────────────────────────────────────────────────────────
refreshBtn?.addEventListener("click", async () => {
  await loadPlayers();
  showToast("อัปเดตแล้ว ✓", "ok");
});

// ── Logout button ─────────────────────────────────────────────────────────────
logoutBtn?.addEventListener("click", async () => {
  await logout();
});

// ── Row copy buttons ──────────────────────────────────────────────────────────
rowsEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (btn) copyToClipboard(btn.getAttribute("data-copy") ?? "");
});

// ── Search / sort ─────────────────────────────────────────────────────────────
searchInput?.addEventListener("input", render);
sortSelect?.addEventListener("change", render);

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await ensureToken();
  await loadMe();
  await loadPlayers();

  setInterval(loadPlayers, 5000);
  setInterval(loadMe, 30000);
})();