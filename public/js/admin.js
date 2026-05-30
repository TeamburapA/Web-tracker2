/**
 * admin.js — Admin Dashboard Controller (ES Module)
 */
import { getToken, logout, initGuard, clearSession } from "./auth.js";

// ── DOM References ────────────────────────────────────────────────────────────
const userRowsEl = document.getElementById("userRows");
const userSearchInput = document.getElementById("userSearchInput");
const usersCountLabel = document.getElementById("usersCountLabel");
const userUsernameEl = document.getElementById("userUsername");
const userAvatarInitialsEl = document.getElementById("userAvatarInitials");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const copyToast = document.getElementById("copyToast");

// ── State Variables ───────────────────────────────────────────────────────────
let users = [];
let authToken = null;
let toastTimer;

// ── Auth Token Helpers ─────────────────────────────────────────────────────────
async function ensureToken() {
  if (!authToken) authToken = await getToken();

  if (!authToken) {
    window.location.replace("/login.html");
    return null;
  }

  return authToken;
}

// ── Toast Notifications ───────────────────────────────────────────────────────
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

// ── Load Admin Profile Info & Verify Role ─────────────────────────────────────
async function verifyAdminAndLoadMe() {
  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 401) {
      await clearSession();
      window.location.replace("/login.html");
      return;
    }

    if (!res.ok) {
      window.location.replace("/");
      return;
    }

    const { user } = await res.json();
    const isUserAdmin = user.email === "admin@tracker.local" || user.email.startsWith("admin@");

    if (!isUserAdmin) {
      alert("คุณไม่มีสิทธิ์เข้าถึงหน้าผู้จัดการระบบ");
      window.location.replace("/");
      return;
    }

    // Update Username
    const username = user.username || (user.email ? user.email.split("@")[0] : "Admin");
    if (userUsernameEl) userUsernameEl.textContent = username;
    if (userAvatarInitialsEl) {
      userAvatarInitialsEl.textContent = username.substring(0, 1).toUpperCase();
    }
  } catch (err) {
    console.error("verifyAdminAndLoadMe error:", err);
    window.location.replace("/");
  }
}

// ── Load Users List (/api/admin/users) ────────────────────────────────────────
async function loadUsers() {
  const token = await ensureToken();
  if (!token) return;

  if (refreshBtn) {
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
  }

  try {
    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 401) {
      await clearSession();
      window.location.replace("/login.html");
      return;
    }

    if (!res.ok) {
      const errorData = await res.json();
      usersCountLabel.textContent = `ข้อผิดพลาด: ${errorData.error || "ไม่สามารถโหลดข้อมูลผู้ใช้"}`;
      return;
    }

    const data = await res.json();
    users = data.users || [];
    renderUsers();
  } catch (err) {
    console.error("loadUsers error:", err);
    usersCountLabel.textContent = "เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว";
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
  }
}

// ── Render Users Table ────────────────────────────────────────────────────────
function renderUsers() {
  const query = userSearchInput?.value.trim().toLowerCase() || "";
  
  const filtered = users.filter(u => {
    return `${u.username} ${u.email} ${u.id} ${u.script_key}`.toLowerCase().includes(query);
  });

  if (usersCountLabel) {
    usersCountLabel.textContent = `พบผู้ใช้งาน ${filtered.length} บัญชี จากทั้งหมด ${users.length} บัญชี`;
  }

  if (filtered.length === 0) {
    userRowsEl.innerHTML = `<tr><td colspan="4" class="empty-table-state">ไม่พบผู้ใช้งานที่ตรงตามคำค้นหา</td></tr>`;
    return;
  }

  userRowsEl.innerHTML = filtered.map(u => {
    return `
      <tr>
        <td>
          <div class="td-player-profile">
            <div class="user-avatar-circle" style="width:30px; height:30px; font-size:12px; background: rgba(255, 193, 7, 0.05); border: 1px solid var(--line);">
              ${(u.username || "?").substring(0, 1).toUpperCase()}
            </div>
            <div class="player-info-meta">
              <span class="player-name-main">${escapeHtml(u.username)}</span>
              <span class="player-id-sub">${escapeHtml(u.email)}</span>
            </div>
          </div>
        </td>
        <td><code class="player-id-sub" style="font-size:11px;">${escapeHtml(u.id)}</code></td>
        <td><code class="metric-number cinema-metric" style="font-size:11px; word-break: break-all;">${escapeHtml(u.script_key || "—")}</code></td>
        <td>
          <button class="btn-action-key btn-reset-pw" data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}" title="แก้ไขรหัสผ่านผู้ใช้นี้">
            🔑 เปลี่ยนรหัส
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// ── HTML Escape Helper ────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── Event Listeners ───────────────────────────────────────────────────────────

// Reset Password Action
userRowsEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-reset-pw");
  if (!btn) return;

  const userId = btn.getAttribute("data-user-id");
  const username = btn.getAttribute("data-username");

  if (!userId || !username) return;

  if (typeof Swal === "undefined") {
    const newPass = prompt(`ระบุรหัสผ่านใหม่สำหรับลูกค้า "${username}":`);
    if (newPass) {
      await changeUserPassword(userId, username, newPass);
    }
    return;
  }

  Swal.fire({
    title: `เปลี่ยนรหัสผ่าน: ${username}`,
    text: "กรุณากรอกรหัสผ่านใหม่ (ความยาวอย่างน้อย 6 ตัวอักษร)",
    input: "password",
    inputAttributes: {
      autocapitalize: "off",
      autocomplete: "new-password"
    },
    background: "#12141a",
    color: "#f8f9fa",
    confirmButtonColor: "#ffc107",
    cancelButtonColor: "#343a40",
    showCancelButton: true,
    confirmButtonText: "อัปเดต",
    cancelButtonText: "ยกเลิก",
    preConfirm: (newPassword) => {
      if (!newPassword || newPassword.length < 6) {
        Swal.showValidationMessage("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
        return false;
      }
      return newPassword;
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      await changeUserPassword(userId, username, result.value);
    }
  });
});

async function changeUserPassword(userId, username, newPassword) {
  const token = await ensureToken();
  if (!token) return;

  try {
    const res = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ user_id: userId, new_password: newPassword })
    });

    const data = await res.json();

    if (res.ok) {
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: "success",
          title: "สำเร็จ!",
          text: `เปลี่ยนรหัสผ่านสำหรับ "${username}" สำเร็จแล้ว`,
          background: "#12141a",
          color: "#f8f9fa",
          confirmButtonColor: "#ffc107"
        });
      } else {
        alert(`เปลี่ยนรหัสผ่านสำหรับ "${username}" สำเร็จแล้ว`);
      }
    } else {
      throw new Error(data.error || "เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน");
    }
  } catch (err) {
    console.error(err);
    if (typeof Swal !== "undefined") {
      Swal.fire({
        icon: "error",
        title: "ล้มเหลว",
        text: err.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ",
        background: "#12141a",
        color: "#f8f9fa",
        confirmButtonColor: "#ff5252"
      });
    } else {
      alert(err.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    }
  }
}

// Live Filters
userSearchInput?.addEventListener("input", renderUsers);

// Refresh Button
refreshBtn?.addEventListener("click", async () => {
  await loadUsers();
  showToast("รีเฟรชข้อมูลสำเร็จ ✓", "ok");
});

// Logout Button
logoutBtn?.addEventListener("click", async () => {
  await logout();
});

// ── Application Initializer ──────────────────────────────────────────────────
(async () => {
  const ok = await initGuard();
  if (!ok) return;

  await verifyAdminAndLoadMe();
  await loadUsers();
})();
