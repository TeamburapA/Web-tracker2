/**
 * auth.js — Supabase Auth (browser module)
 * จัดการ: login, register, session guard, logout
 * export: getToken() สำหรับให้ app.js ใช้แนบ JWT
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ── Supabase client (lazy init) ───────────────────────────────────────────────
let supabase = null;

async function getSupabase() {
  if (supabase) return supabase;
  const res = await fetch("/api/config");
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  return supabase;
}

// ── Exported helpers ──────────────────────────────────────────────────────────

/** ดึง access token ของ session ปัจจุบัน (ใช้กับ Authorization: Bearer) */
export async function getToken() {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || null;
}

/** Logout แล้ว redirect ไป login */
export async function logout() {
  const sb = await getSupabase();
  await sb.auth.signOut();
  location.replace("/login.html");
}

// ── Page detection ────────────────────────────────────────────────────────────
const page = {
  isLogin: () => location.pathname.endsWith("login.html"),
  isRegister: () => location.pathname.endsWith("register.html"),
  isDashboard: () => location.pathname === "/" || location.pathname.endsWith("index.html"),
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById("authError");
  const ok = document.getElementById("authSuccess");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (ok) ok.hidden = true;
}

function showSuccess(msg) {
  const el = document.getElementById("authSuccess");
  const err = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (err) err.hidden = true;
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const text = btn.querySelector(".btn-text");
  const spinner = btn.querySelector(".btn-spinner");
  if (text) text.hidden = loading;
  if (spinner) spinner.hidden = !loading;
}

function markInvalid(el) {
  el?.classList.add("invalid");
  el?.addEventListener("input", () => el.classList.remove("invalid"), { once: true });
}

function bindToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (!btn || !inp) return;
  btn.addEventListener("click", () => {
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    btn.textContent = show ? "🙈" : "👁";
  });
}

// ── Session guard ─────────────────────────────────────────────────────────────
async function initGuard() {
  const sb = await getSupabase();
  const { data: { session } } = await sb.auth.getSession();

  if (page.isDashboard() && !session) {
    location.replace("/login.html");
    return false;
  }
  if ((page.isLogin() || page.isRegister()) && session) {
    location.replace("/");
    return false;
  }
  return true;
}

// ── Login page ────────────────────────────────────────────────────────────────
async function initLoginPage() {
  bindToggle("togglePw", "loginPassword");

  const form = document.getElementById("loginForm");
  const btn = document.getElementById("loginBtn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
      if (!email) markInvalid(document.getElementById("loginEmail"));
      if (!password) markInvalid(document.getElementById("loginPassword"));
      showError("กรุณากรอกอีเมลและรหัสผ่าน");
      return;
    }

    setLoading(btn, true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        showError(error.message?.includes("Invalid login credentials")
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : error.message);
        markInvalid(document.getElementById("loginPassword"));
        setLoading(btn, false);
        return;
      }
      location.replace("/");
    } catch {
      showError("เกิดข้อผิดพลาด กรุณาลองใหม่");
      setLoading(btn, false);
    }
  });
}

// ── Register page ─────────────────────────────────────────────────────────────
async function initRegisterPage() {
  bindToggle("togglePwReg", "regPassword");
  bindToggle("togglePwCfm", "regConfirm");

  const form = document.getElementById("registerForm");
  const btn = document.getElementById("registerBtn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const confirm = document.getElementById("regConfirm").value;

    let hasError = false;
    if (!email) { markInvalid(document.getElementById("regEmail")); hasError = true; }
    if (!password) { markInvalid(document.getElementById("regPassword")); hasError = true; }
    if (!confirm) { markInvalid(document.getElementById("regConfirm")); hasError = true; }
    if (hasError) { showError("กรุณากรอกข้อมูลให้ครบถ้วน"); return; }
    if (password.length < 6) { markInvalid(document.getElementById("regPassword")); showError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    if (password !== confirm) { markInvalid(document.getElementById("regConfirm")); showError("รหัสผ่านไม่ตรงกัน"); return; }

    setLoading(btn, true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signUp({ email, password });
      if (error) {
        showError(error.message?.includes("already registered") ? "อีเมลนี้ถูกใช้ไปแล้ว" : error.message);
        setLoading(btn, false);
        return;
      }
      showSuccess("✅ สมัครสำเร็จ! กำลังพาไปหน้า Login...");
      setTimeout(() => location.replace("/login.html"), 1800);
    } catch {
      showError("เกิดข้อผิดพลาด กรุณาลองใหม่");
      setLoading(btn, false);
    }
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  const ok = await initGuard();
  if (!ok) return;

  if (page.isLogin()) await initLoginPage();
  if (page.isRegister()) await initRegisterPage();

  if (page.isDashboard()) {
    document.getElementById("logoutBtn")?.addEventListener("click", logout);
  }
})();
