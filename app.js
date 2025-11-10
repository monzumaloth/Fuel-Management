// app.js (enhanced with idle + tab-close auto logout)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import "./config.js";

const cfg = window.APP_CONFIG || {};
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Please set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, storage: localStorage },
});

export const loginSection = document.getElementById("login-section");
export const dashboardShell = document.getElementById("dashboard-shell");
export const loginBtn = document.getElementById("login-btn");
export const logoutBtn = document.getElementById("logout-btn");
export const loginError = document.getElementById("login-error");
export const appTitle = document.getElementById("app-title");
export const userRoleBadge = document.getElementById("user-role-badge");
export const mainContent = document.getElementById("main-content");
export const backBtn = document.getElementById("back-btn");
export const nav = document.getElementById("nav");

export let currentUser = null;
export let profile = null;

export let plazasCache = [];
export let generatorsCache = [];
export let profilesCache = [];
export let plazasById = {};
export let generatorsById = {};
export let generatorsByPlaza = {};
export let profilesByUserId = {};

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (!c && c !== 0) return;
    if (typeof c === "string" || typeof c === "number")
      e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}
export function fmt(n) {
  return n === null || n === undefined ? "-" : Number(n).toFixed(1);
}
export function toast(msg, type = "info") {
  const t = el(
    "div",
    {
      class: "card",
      style:
        "position:fixed;right:16px;bottom:16px;z-index:9999;min-width:220px;padding:0.75rem",
    },
    `<strong>${type.toUpperCase()}</strong>: ${msg}`
  );
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ----------------------- CACHE HANDLING ----------------------- */
export async function loadCaches() {
  try {
    const [plRes, gRes, pRes] = await Promise.all([
      supabase.from("plazas").select("*").order("name", { ascending: true }),
      supabase
        .from("generators")
        .select("*")
        .order("name", { ascending: true }),
      supabase.from("profiles").select("*"),
    ]);
    if (plRes.error) throw plRes.error;
    if (gRes.error) throw gRes.error;
    if (pRes.error) throw pRes.error;

    plazasCache = plRes.data || [];
    generatorsCache = gRes.data || [];
    profilesCache = pRes.data || [];

    plazasById = {};
    plazasCache.forEach((p) => (plazasById[p.id] = p));

    generatorsById = {};
    generatorsByPlaza = {};
    generatorsCache.forEach((g) => {
      generatorsById[g.id] = g;
      const pid = g.plaza_id || "";
      if (!generatorsByPlaza[pid]) generatorsByPlaza[pid] = [];
      generatorsByPlaza[pid].push(g);
    });

    profilesByUserId = {};
    profilesCache.forEach((pr) => {
      profilesByUserId[pr.user_id] = pr;
    });
  } catch (err) {
    console.error("loadCaches error:", err);
    plazasCache = [];
    generatorsCache = [];
    profilesCache = [];
    plazasById = {};
    generatorsById = {};
    generatorsByPlaza = {};
    profilesByUserId = {};
  }
}

export function ensureCachesLoaded() {
  if (!plazasCache.length || !generatorsCache.length || !profilesCache.length) {
    return loadCaches();
  }
  return Promise.resolve();
}

export function getGeneratorsForPlaza(plazaId) {
  const key = plazaId || "";
  return generatorsByPlaza[key] ? [...generatorsByPlaza[key]] : [];
}

export function buildGeneratorSelect(selectEl, plazaId, selectedId = null) {
  selectEl.innerHTML = "";
  const placeholder = el("option", { value: "" }, "Select generator");
  selectEl.appendChild(placeholder);
  const list = getGeneratorsForPlaza(plazaId);
  list.forEach((g) => {
    const opt = el("option", { value: g.id }, g.name);
    if (selectedId && g.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

/* ----------------------- HELPERS ----------------------- */
export async function fetchProfileForUserId(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ----------------------- EXPORTS ----------------------- */
export function exportToCSV(filename, rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rowsOut = [headers.join(",")].concat(
    rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))
  );
  const blob = new Blob([rowsOut.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToPDF(title, rows, headers) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("l", "mm", "a4");
  doc.setFontSize(12);
  doc.text(title, 10, 12);
  doc.setFontSize(8);
  let y = 20;
  const lineHeight = 7;
  doc.setFont(undefined, "bold");
  headers.forEach((h, i) => doc.text(String(h), 10 + i * 35, y));
  doc.setFont(undefined, "normal");
  y += lineHeight;
  rows.forEach((r) => {
    headers.forEach((h, i) => doc.text(String(r[h] ?? ""), 10 + i * 35, y));
    y += lineHeight;
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
  });
  doc.save(title.replace(/\s+/g, "-").toLowerCase() + ".pdf");
}

export function exportToExcel(filename, sheetName, rows, headers) {
  const aoa = [headers].concat(rows.map((r) => headers.map((h) => r[h] ?? "")));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/* ----------------------- NAVIGATION ----------------------- */
export function renderNavButtons() {
  nav.innerHTML = "";
  const addBtn = (v, l) =>
    nav.appendChild(el("button", { "data-view": v, class: "nav-btn" }, l));
  addBtn("home", "Home");
  addBtn("transactions", "Transactions");
  if (profile.role === "admin") {
    addBtn("plazas", "Plazas");
    addBtn("generators", "Generators");
  }
  if (profile.role === "manager" || profile.role === "admin") {
    addBtn("users", "Users");
    addBtn("multiuserdetail", "User Detailed");
  }
}
nav.addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") renderView(e.target.dataset.view);
});

export function setBackNavigation(enable) {
  backBtn.style.display = enable ? "inline-block" : "none";
  backBtn.onclick = enable ? () => renderView("home") : null;
}

/* ----------------------- VIEW RENDERING ----------------------- */
export async function renderView(view) {
  setBackNavigation(false);
  try {
    const modShared = await import("./views/shared.js");
    const modAdmin = await import("./views/admin.js");

    switch (view) {
      case "home":
        return modShared.renderHome();
      case "transactions":
        return modShared.renderTransactionsPage();
      case "users":
        if (profile.role !== "user") return modShared.renderUsersPage();
        break;
      case "multiuserdetail":
        if (["manager", "admin"].includes(profile.role))
          return modShared.renderMultiUserDetail();
        break;
      case "plazas":
        if (profile.role === "admin") return modAdmin.renderPlazasManagement();
        break;
      case "generators":
        if (profile.role === "admin")
          return modAdmin.renderGeneratorsManagement();
        break;
      default:
        return modShared.renderHome();
    }
  } catch (err) {
    console.error("renderView error", err);
    toast("Failed to render view", "error");
  }
}

/* ----------------------- AUTH LIFECYCLE ----------------------- */
export function resetAppView() {
  if (dashboardShell) dashboardShell.classList.add("hidden");
  if (mainContent) mainContent.innerHTML = "";
  if (document.querySelector("header"))
    document.querySelector("header").style.display = "none";
  if (document.querySelector("nav"))
    document.querySelector("nav").style.display = "none";
  if (loginSection) {
    loginSection.classList.remove("hidden");
    loginSection.style.display = "block";
  }
  if (typeof appTitle !== "undefined") appTitle.textContent = "Fuel Dashboard";
  if (typeof userRoleBadge !== "undefined") userRoleBadge.textContent = "GUEST";
  currentUser = null;
  profile = null;
  console.log("✅ App reset — only login section visible");
}

async function handleLogin() {
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) {
    loginError.textContent = "Email and password required";
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    loginError.textContent = error.message;
    return;
  }

  currentUser = data.user;
  await initAfterAuth();
}

async function handleLogout(manual = true) {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("Logout error", err);
  }

  currentUser = null;
  profile = null;
  resetAppView();

  if (manual) toast("You have been logged out", "info");
}

/* ----------------------- SESSION RESTORE ----------------------- */
async function restoreSessionOnLoad() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error?.message?.includes("Invalid Refresh Token")) {
      console.warn("Invalid session, clearing storage...");
      localStorage.removeItem("supabase.auth.token");
      await supabase.auth.signOut();
      resetAppView();
      return;
    }

    const session = data?.session ?? null;
    if (session?.user) {
      currentUser = session.user;
      await initAfterAuth();
    } else {
      resetAppView();
    }
  } catch (err) {
    console.warn("restoreSessionOnLoad failed", err);
    resetAppView();
  }
}

/* ----------------------- INITIALIZATION ----------------------- */
export async function initAfterAuth() {
  if (!currentUser) return;

  profile = await fetchProfileForUserId(currentUser.id);
  if (!profile) {
    const { error } = await supabase.from("profiles").insert({
      user_id: currentUser.id,
      email: currentUser.email,
      role: "user",
    });
    if (error) console.warn("create profile error", error);
    profile = await fetchProfileForUserId(currentUser.id);
  }

  await loadCaches();

  if (loginSection) loginSection.classList.add("hidden");
  if (dashboardShell) dashboardShell.classList.remove("hidden");
  if (document.querySelector("header"))
    document.querySelector("header").style.display = "";
  if (document.querySelector("nav"))
    document.querySelector("nav").style.display = "";

  userRoleBadge.textContent = profile.role || "user";
  appTitle.textContent = `${(profile.role || "user").toUpperCase()} Dashboard`;

  renderNavButtons();
  await renderView("home");

  // Start idle + tab close detection
  setupAutoLogout();
}

/* ----------------------- AUTO LOGOUT LOGIC ----------------------- */
let idleTimer = null;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

function setupAutoLogout() {
  resetIdleTimer();

  const activityEvents = [
    "mousemove",
    "keydown",
    "click",
    "scroll",
    "touchstart",
  ];
  activityEvents.forEach((event) =>
    document.addEventListener(event, resetIdleTimer, false)
  );

  window.addEventListener("beforeunload", async () => {
    await handleLogout(false);
  });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    toast("Session expired after 1 hour of inactivity", "warning");
    handleLogout(false);
  }, IDLE_TIMEOUT_MS);
}

/* ----------------------- STARTUP ----------------------- */
loginBtn.addEventListener("click", handleLogin);
logoutBtn.addEventListener("click", () => handleLogout(true));
restoreSessionOnLoad();
