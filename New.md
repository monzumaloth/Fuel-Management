// app.js (module)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import "./config.js"; // ensure window.APP_CONFIG exists

const cfg = window.APP_CONFIG || {};
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
throw new Error("Please set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
auth: { persistSession: true, storage: localStorage },
});

/_ DOM elements (exported) _/
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

/_ live-bound exports _/
export let currentUser = null;
export let profile = null;

/_ caches & maps _/
export let plazasCache = [];
export let generatorsCache = [];
export let profilesCache = [];
export let plazasById = {};
export let generatorsById = {};
export let generatorsByPlaza = {};
export let profilesByUserId = {};

/_ small helpers (exported) _/
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

/_ caches loader _/
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

/_ auth helpers _/
export async function fetchProfileForUserId(userId) {
const { data, error } = await supabase
.from("profiles")
.select("\*")
.eq("user_id", userId)
.maybeSingle();
if (error) throw error;
return data;
}

/_ exports for CSV/PDF/XLSX _/
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

// header
doc.setFont(undefined, "bold");
headers.forEach((h, i) => doc.text(String(h), 10 + i \* 35, y));
doc.setFont(undefined, "normal");
y += lineHeight;

rows.forEach((r) => {
headers.forEach((h, i) => {
const text = String(r[h] ?? "");
doc.text(text, 10 + i \* 35, y);
});
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

/_ navigation & view rendering _/
export function renderNavButtons() {
nav.innerHTML = "";
const addBtn = (v, l) =>
nav.appendChild(el("button", { "data-view": v, class: "nav-btn" }, l));
addBtn("home", "Home");
addBtn("transactions", "Transactions");
if (profile.role === "manager" || profile.role === "admin")
addBtn("users", "Users");
if (profile.role === "admin") {
addBtn("plazas", "Plazas");
addBtn("generators", "Generators");
}
}
nav.addEventListener("click", (e) => {
if (e.target.tagName === "BUTTON") renderView(e.target.dataset.view);
});

export function setBackNavigation(enable) {
backBtn.style.display = enable ? "inline-block" : "none";
backBtn.onclick = enable ? () => renderView("home") : null;
}

export async function renderView(view) {
setBackNavigation(false);
try {
if (view === "home") {
const mod = await import("./views/shared.js");
await mod.renderHome();
return;
}
if (view === "transactions") {
const mod = await import("./views/shared.js");
await mod.renderTransactionsPage();
return;
}
if (view === "users" && profile.role !== "user") {
const mod = await import("./views/shared.js");
await mod.renderUsersPage();
return;
}
if (view === "plazas" && profile.role === "admin") {
const mod = await import("./views/admin.js");
await mod.renderPlazasManagement();
return;
}
if (view === "generators" && profile.role === "admin") {
const mod = await import("./views/admin.js");
await mod.renderGeneratorsManagement();
return;
}
const mod = await import("./views/shared.js");
await mod.renderHome();
} catch (err) {
console.error("renderView error", err);
toast("Failed to render view", "error");
}
}

/_ auth lifecycle _/
export function resetAppView() {
if (currentUser && profile) {
// User is logged in: show dashboard, hide login
loginSection.classList.add("hidden");
dashboardShell.classList.remove("hidden");
// Re-render the initial view for the logged-in user
userRoleBadge.textContent = profile.role || "user";
appTitle.textContent = `${(
      profile.role || "user"
    ).toUpperCase()} Dashboard`;
renderNavButtons();
renderView("home"); // Use existing view renderer
} else {
// User is logged out: show login, hide dashboard
loginSection.classList.remove("hidden");
dashboardShell.classList.add("hidden");
mainContent.innerHTML = ""; // Clear any lingering dashboard content
}
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
async function handleLogout() {
await supabase.auth.signOut().catch(() => {});
currentUser = null;
profile = null;
resetAppView();
}
async function restoreSessionOnLoad() {
try {
const { data } = await supabase.auth.getSession();
const session = data?.session ?? null;
if (session?.user) {
currentUser = session.user;
await initAfterAuth();
} else {
// Ensure the login section is correctly shown if no session exists
resetAppView();
}
} catch (err) {
console.warn("restoreSessionOnLoad failed", err);
}
}
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
loginSection.classList.add("hidden");
dashboardShell.classList.remove("hidden");
userRoleBadge.textContent = profile.role || "user";
appTitle.textContent = `${(profile.role || "user").toUpperCase()} Dashboard`;
renderNavButtons();
await renderView("home");
resetAppView();
}

loginBtn.addEventListener("click", handleLogin);
logoutBtn.addEventListener("click", handleLogout);
restoreSessionOnLoad();

// views/shared.js
import {
supabase,
profile,
mainContent,
el,
fmt,
toast,
ensureCachesLoaded,
plazasById,
generatorsById,
profilesByUserId,
exportToPDF,
exportToExcel,
exportToCSV,
setBackNavigation,
} from "../app.js";

/_ export helper used by user view or other modules _/
export async function fetchUserMetrics(user_id, plaza_id) {
try {
const { data: txs = [], error: txError } = await supabase
.from("fuel_transactions")
.select(
"fuel_amount, transaction_date, odometer_hours, notes, generator_id, plaza_id"
)
.eq("user_id", user_id)
.order("transaction_date", { ascending: false });

    if (txError) throw txError;

    let tankBalance = 0;
    let tankUpdatedAt = null;

    if (plaza_id) {
      const { data: tank, error: tankError } = await supabase
        .from("plaza_tanks")
        .select("plaza_id,current_balance,updated_at")
        .eq("plaza_id", plaza_id)
        .single();

      if (tankError) {
        // If the error is not "no rows", then throw
        if (tankError.code !== "PGRST116") {
          console.error("fetchUserMetrics plaza_tank error:", tankError);
          throw tankError;
        }
      } else if (tank) {
        tankBalance = Number(tank.current_balance || 0);
        tankUpdatedAt = tank.updated_at;
      }
    }

    const oneWeek = new Date();
    oneWeek.setDate(oneWeek.getDate() - 7);

    const weeklyUsage = Math.abs(
      txs
        .filter(
          (t) =>
            Number(t.fuel_amount) < 0 && new Date(t.transaction_date) >= oneWeek
        )
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );

    const totalAdded = txs
      .filter((t) => Number(t.fuel_amount) > 0)
      .reduce((s, t) => s + Number(t.fuel_amount || 0), 0);

    const totalUsed = Math.abs(
      txs
        .filter((t) => Number(t.fuel_amount) < 0)
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );

    const lastActivity = txs.length ? txs[0].transaction_date : null;

    return {
      balance: tankBalance,
      tankUpdatedAt,
      weeklyUsage,
      totalAdded,
      totalUsed,
      lastActivity,
      transactions: txs,
    };

} catch (err) {
console.error("fetchUserMetrics error:", err);
return {
balance: 0,
tankUpdatedAt: null,
weeklyUsage: 0,
totalAdded: 0,
totalUsed: 0,
lastActivity: null,
transactions: [],
};
}
}

/_ --------------- Home --------------- _/
export async function renderHome() {
mainContent.innerHTML = "";
setBackNavigation(false);

if (profile.role === "user") {
const mod = await import("./user.js");
await mod.renderUserHome();
return;
}

const container = el("div", { class: "card" });
container.append(
el("h2", {}, `Welcome ${profile.full_name || profile.email}`)
);
mainContent.append(container);

// decide plazas to show
const plazaIdsToShow = new Set();
if (profile.role === "manager" && profile.plaza_id)
plazaIdsToShow.add(profile.plaza_id);
else Object.keys(plazasById).forEach((id) => plazaIdsToShow.add(id));

// fetch transaction summary
const { data: txns = [], error } = await supabase
.from("fuel_transactions")
.select("fuel_amount,plaza_id,transaction_date")
.order("transaction_date", { ascending: false });

if (error) {
console.error("home tx load error", error);
toast("Failed to load metrics", "error");
return;
}

const byPlaza = {};
txns.forEach((t) => {
const pid = t.plaza_id || null;
if (!plazaIdsToShow.has(pid)) return;
if (!byPlaza[pid]) byPlaza[pid] = { added: 0, used: 0 };
const amt = Number(t.fuel_amount || 0);
if (amt > 0) byPlaza[pid].added += amt;
else byPlaza[pid].used += Math.abs(amt);
});

plazaIdsToShow.forEach((pid) => {
if (!byPlaza[pid]) byPlaza[pid] = { added: 0, used: 0 };
});

const plazaList = [...plazaIdsToShow].map((id) => ({
id,
name: plazasById[id]?.name || "Unassigned",
}));
plazaList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

plazaList.forEach((p) => {
const stats = byPlaza[p.id] || { added: 0, used: 0 };
const net = stats.added - stats.used;
const section = el("div", { class: "card mt" });
section.append(el("h3", {}, p.name));
const grid = el("div", { class: "grid-3" });

    const gaugeContainer = el("div", { class: "gauge-container" });
    gaugeContainer.append(buildFuelGauge(Math.max(0, net), stats.added));
    grid.append(gaugeContainer);

    const metricBlock = el("div", {}, [
      el("p", {}, `Total Added: ${fmt(stats.added)} L`),
      el("p", {}, `Total Used: ${fmt(stats.used)} L`),
      el("p", {}, `Net Remaining (tank): ${fmt(net)} L`),
    ]);
    grid.append(metricBlock);

    // status indicator & pie
    const status = net <= 30 ? "CRITICAL" : net <= 100 ? "WARNING" : "NORMAL";
    const statusColor =
      status === "CRITICAL"
        ? "#ef4444"
        : status === "WARNING"
        ? "#f59e0b"
        : "#10b981";

    const svgContainer = el("div", { style: "height:160px;" });
    svgContainer.innerHTML = `<svg id="home-pie-${p.id}" width="100%" height="100%"></svg>`;

    const rightCol = el("div", {}, [
      el(
        "p",
        { style: `color: ${statusColor}; font-weight: bold;` },
        `Status: ${status}`
      ),
      svgContainer, // Append the fixed container
    ]);
    grid.append(rightCol);

    section.append(grid);
    mainContent.append(section);

    renderMiniPieChart(`home-pie-${p.id}`, [
      { name: "Used", value: stats.used },
      { name: "Remaining", value: Math.max(0, net) },
    ]);

});
}

/_ ---------------- mini visuals ---------------- _/
function buildFuelGauge(net, added) {
const percentage =
added > 0 ? Math.max(0, Math.min(100, (net / added) _ 100)) : 0;
const radius = 44,
stroke = 12;
const circumference = 2 _ Math.PI _ radius;
const filled = (percentage / 100) _ circumference;
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.setAttribute("width", "120");
svg.setAttribute("height", "120");
svg.setAttribute("viewBox", "0 0 120 120");
const bg = document.createElementNS(svg.namespaceURI, "circle");
bg.setAttribute("cx", "60");
bg.setAttribute("cy", "60");
bg.setAttribute("r", String(radius));
bg.setAttribute("stroke", "#e5e7eb");
bg.setAttribute("stroke-width", String(stroke));
bg.setAttribute("fill", "none");
svg.appendChild(bg);
const fg = document.createElementNS(svg.namespaceURI, "circle");
fg.setAttribute("cx", "60");
fg.setAttribute("cy", "60");
fg.setAttribute("r", String(radius));
fg.setAttribute("stroke", percentage > 50 ? "#10b981" : "#ef4444");
fg.setAttribute("stroke-width", String(stroke));
fg.setAttribute("fill", "none");
fg.setAttribute("stroke-dasharray", `${filled} ${circumference}`);
fg.setAttribute("transform", "rotate(-90 60 60)");
svg.appendChild(fg);
const text = document.createElementNS(svg.namespaceURI, "text");
text.setAttribute("x", "60");
text.setAttribute("y", "65");
text.setAttribute("text-anchor", "middle");
text.setAttribute("font-size", "16");
text.setAttribute("font-weight", "bold");
text.textContent = `${percentage.toFixed(0)}%`;
svg.appendChild(text);
return svg;
}
function renderMiniPieChart(containerId, data) {
const svg = document.getElementById(containerId);
if (!svg) return;
svg.innerHTML = "";
const width = svg.clientWidth || 200,
height = svg.clientHeight || 200,
radius = Math.min(width, height) / 2;
const total = data.reduce((s, d) => s + (d.value || 0), 0);
if (total === 0) {
const txt = document.createElementNS(svg.namespaceURI, "text");
txt.setAttribute("x", width / 2);
txt.setAttribute("y", height / 2);
txt.setAttribute("text-anchor", "middle");
txt.textContent = "No data";
svg.appendChild(txt);
return;
}
let startAngle = 0;
const colors = ["#ef4444", "#10b981"];
data.forEach((d, i) => {
const angle = (d.value / total) _ 2 _ Math.PI;
const x1 = width / 2 + radius _ Math.cos(startAngle),
y1 = height / 2 + radius _ Math.sin(startAngle);
const x2 = width / 2 + radius _ Math.cos(startAngle + angle),
y2 = height / 2 + radius _ Math.sin(startAngle + angle);
const largeArc = angle > Math.PI ? 1 : 0;
const pathData = [
`M ${width / 2} ${height / 2}`,
`L ${x1} ${y1}`,
`A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
"Z",
].join(" ");
const path = document.createElementNS(svg.namespaceURI, "path");
path.setAttribute("d", pathData);
path.setAttribute("fill", colors[i] || "#ccc");
svg.appendChild(path);
startAngle += angle;
});
}

/_ ---------------- Transactions page with exports ---------------- _/
export async function renderTransactionsPage() {
mainContent.innerHTML = "";
setBackNavigation(true);
const card = el("div", { class: "card" });
card.append(el("h2", {}, "Transactions"));
const toolsRow = el("div", { class: "row mt" });
const pdfBtn = el("button", { class: "primary" }, "Export PDF");
const excelBtn = el("button", { class: "primary" }, "Export Excel");
const csvBtn = el("button", { class: "primary" }, "Export CSV");
toolsRow.append(pdfBtn, excelBtn, csvBtn);
card.append(toolsRow);

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr>

<th>Date It Was Used</th><th>Recording Dated</th><th>User</th><th>Amount (L)</th><th>Comment</th><th>Generator</th><th>Plaza</th>
</tr></thead><tbody></tbody>`;
  card.append(table);
  mainContent.append(card);

let q = supabase
.from("fuel_transactions")
.select("\*")
.order("created_at", { ascending: false });
if (profile.role === "user") q = q.eq("user_id", profile.user_id);
if (profile.role === "manager" && profile.plaza_id)
q = q.eq("plaza_id", profile.plaza_id);

const { data: txs = [], error } = await q;
if (error) {
console.error("transactions load error", error);
toast("Failed to load transactions", "error");
return;
}

await ensureCachesLoaded();
const tbody = table.querySelector("tbody");
tbody.innerHTML = "";
const rowsForExport = [];

(txs || []).forEach((r) => {
const userLabel =
profilesByUserId[r.user_id]?.full_name ||
profilesByUserId[r.user_id]?.email ||
r.user_id ||
"-";
const genLabel =
(r.generator_id && generatorsById[r.generator_id]?.name) || "-";
const plazaLabel = (r.plaza_id && plazasById[r.plaza_id]?.name) || "-";
const tr = el("tr", {}, [
el(
"td",
{},
r.transaction_date ? new Date(r.transaction_date).toLocaleString() : "-"
),
el(
"td",
{},
r.created_at ? new Date(r.created_at).toLocaleString() : "-"
),
el("td", {}, userLabel),
el("td", {}, `${Number(r.fuel_amount || 0).toFixed(2)} L`),
el("td", {}, r.notes || ""),
el("td", {}, genLabel),
el("td", {}, plazaLabel),
]);
tbody.appendChild(tr);
rowsForExport.push({
"Date It Was Used": r.transaction_date
? new Date(r.transaction_date).toLocaleString()
: "",
"Recording Dated": r.created_at
? new Date(r.created_at).toLocaleString()
: "",
User: userLabel,
"Amount (L)": Number(r.fuel_amount || 0),
Comment: r.notes || "",
Generator: genLabel,
Plaza: plazaLabel,
});
});

if (profile.role === "user") {
pdfBtn.style.display =
excelBtn.style.display =
csvBtn.style.display =
"none";
} else {
pdfBtn.onclick = () =>
exportToPDF("Transactions Report", rowsForExport, [
"Date It Was Used",
"Recording Dated",
"User",
"Amount (L)",
"Comment",
"Generator",
"Plaza",
]);
excelBtn.onclick = () =>
exportToExcel("transactions.xlsx", "Transactions", rowsForExport, [
"Date It Was Used",
"Recording Dated",
"User",
"Amount (L)",
"Comment",
"Generator",
"Plaza",
]);
csvBtn.onclick = () =>
exportToCSV("transactions.csv", rowsForExport, [
"Date It Was Used",
"Recording Dated",
"User",
"Amount (L)",
"Comment",
"Generator",
"Plaza",
]);
}
}

/_ ---------------- Users list with export ---------------- _/
export async function renderUsersPage() {
mainContent.innerHTML = "";
setBackNavigation(true);
const card = el("div", { class: "card" });
card.append(
el("h2", {}, profile.role === "admin" ? "User Management" : "Users")
);

const toolsRow = el("div", { class: "row mt" });
const pdfBtn = el("button", { class: "primary" }, "Export Users PDF");
const excelBtn = el("button", { class: "primary" }, "Export Users Excel");
const csvBtn = el("button", { class: "primary" }, "Export CSV");
toolsRow.append(pdfBtn, excelBtn, csvBtn);
card.append(toolsRow);
mainContent.append(card);

const { data: profilesList = [], error } = await supabase
.from("profiles")
.select("user_id,full_name,email,role,plaza_id")
.order("created_at", { ascending: false });
if (error) {
console.error("users load error", error);
toast("Failed to load users", "error");
return;
}

const rows = (profilesList || []).filter((p) => {
if (profile.role === "manager" && p.role === "admin") return false;
if (profile.role === "manager" && p.user_id === profile.user_id)
return false;
if (profile.role === "manager" && profile.plaza_id)
return p.plaza_id === profile.plaza_id;
return true;
});

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Plaza</th><th>Actions</th></tr></thead><tbody></tbody>`;
card.append(table);

const rowsForExport = [];
for (const p of rows) {
const { data: userTxs = [] } = await supabase
.from("fuel_transactions")
.select("fuel_amount")
.eq("user_id", p.user_id);
rowsForExport.push({
Name: p.full_name || "",
Email: p.email || "",
Role: p.role || "",
Plaza: plazasById[p.plaza_id]?.name || "",
});

    const tr = el("tr", {}, [
      el("td", {}, p.full_name || p.email),
      el("td", {}, p.email),
      el("td", {}, p.role),
      el("td", {}, plazasById[p.plaza_id]?.name || "-"),
      el(
        "td",
        {},
        (() => {
          const viewBtn = el("button", { class: "ghost" }, "View");
          viewBtn.onclick = () => renderUserDetail(p);
          return viewBtn;
        })()
      ),
    ]);
    table.querySelector("tbody").appendChild(tr);

}

if (profile.role === "user") {
pdfBtn.style.display =
excelBtn.style.display =
csvBtn.style.display =
"none";
} else {
pdfBtn.onclick = () =>
exportToPDF("Users Report", rowsForExport, [
"Name",
"Email",
"Role",
"Plaza",
]);
excelBtn.onclick = () =>
exportToExcel("users.xlsx", "Users", rowsForExport, [
"Name",
"Email",
"Role",
"Plaza",
]);
csvBtn.onclick = () =>
exportToCSV("users.csv", rowsForExport, [
"Name",
"Email",
"Role",
"Plaza",
]);
}
}

/_ ---------------- User Detail (KPL) with export ---------------- _/
export async function renderUserDetail(profileRow) {
mainContent.innerHTML = "";
setBackNavigation(true);
const card = el("div", { class: "card" });
card.append(
el("h2", {}, `Details: ${profileRow.full_name || profileRow.email}`)
);

const { data: txs = [], error } = await supabase
.from("fuel_transactions")
.select("\*")
.eq("user_id", profileRow.user_id)
.order("created_at", { ascending: false });
if (error) {
console.error("renderUserDetail txs error", error);
card.append(
el("p", { class: "error" }, "Failed to load transaction details.")
);
mainContent.append(card);
return;
}
const totalAdded = (txs || [])
.filter((t) => Number(t.fuel_amount) > 0)
.reduce((s, t) => s + Number(t.fuel_amount || 0), 0);
const totalUsed = Math.abs(
(txs || [])
.filter((t) => Number(t.fuel_amount) < 0)
.reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
);
const lastActivity = txs.length ? txs[0].transaction_date : null;
card.append(el("p", {}, `Total added: ${fmt(totalAdded)} L`));
card.append(el("p", {}, `Total used: ${fmt(totalUsed)} L`));
card.append(
el(
"p",
{},
`Last activity: ${
        lastActivity ? new Date(lastActivity).toLocaleString() : "-"
      }`
)
);

const toolsRow = el("div", { class: "row mt" });
const pdfBtn = el("button", { class: "primary" }, "Export Detail PDF");
const excelBtn = el("button", { class: "primary" }, "Export Detail Excel");
const csvBtn = el("button", { class: "primary" }, "Export CSV");
toolsRow.append(pdfBtn, excelBtn, csvBtn);
card.append(toolsRow);

const orderedTxs = (txs || []).slice().reverse();
let prevOdo = null;
const detailRows = [];

orderedTxs.forEach((tx) => {
const currentOdo =
tx.odometer_hours !== null && tx.odometer_hours !== undefined
? Number(tx.odometer_hours)
: null;

    let diff = null;
    let consumptionRate = null;

    if (prevOdo !== null && currentOdo !== null) diff = currentOdo - prevOdo;

    const fuelAmount = Number(tx.fuel_amount || 0);
    const litersAdded = fuelAmount > 0 ? fuelAmount : 0;
    const litersUsed = fuelAmount < 0 ? Math.abs(fuelAmount) : 0;

    const type = fuelAmount > 0 ? "Added to tank" : "Taken to generator";

    if (diff !== null && litersUsed !== null) {
      consumptionRate = Math.abs(diff) / Math.abs(litersUsed);
    }

    detailRows.push({
      tx,
      "Date It Was Used": tx.transaction_date
        ? new Date(tx.transaction_date).toLocaleString()
        : "",
      "Recording Dated": tx.created_at
        ? new Date(tx.created_at).toLocaleString()
        : "",
      Type: type,
      "Fuel Added (L)": litersAdded,
      "Fuel Used (L)": litersUsed,
      "Odometer(hrs)": currentOdo === null ? "" : currentOdo,
      "Diff since prev (hours)": diff === null ? "" : Math.abs(diff),
      KilometersPerLiter:
        consumptionRate === null ? "" : Number(consumptionRate.toFixed(2)),
    });
    if (currentOdo !== null) prevOdo = currentOdo;

});

const hoursTable = el("table", { class: "table mt" });
hoursTable.innerHTML = `<thead><tr>
    <th>Date It Was Used</th><th>Recording Dated</th><th>Type</th><th>Fuel Added (L)</th><th>Fuel Used (L)</th><th>Odometer(hrs)</th><th>Diff since prev (hours)</th><th>KilometersPerLiter</th>
  </tr></thead><tbody></tbody>`;
const tbody = hoursTable.querySelector("tbody");
detailRows
.slice()
.reverse()
.forEach((r) => {
tbody.appendChild(
el("tr", {}, [
el("td", {}, r["Date It Was Used"]),
el("td", {}, r["Recording Dated"]),
el("td", {}, r["Type"]),
el(
"td",
{},
r["Fuel Added (L)"] === 0 ? "-" : fmt(r["Fuel Added (L)"])
),
el(
"td",
{},
r["Fuel Used (L)"] === 0 ? "-" : fmt(r["Fuel Used (L)"])
),
el("td", {}, r["Odometer(hrs)"] === "" ? "-" : r["Odometer(hrs)"]),
el(
"td",
{},
r["Diff since prev (hours)"] === ""
? "-"
: r["Diff since prev (hours)"]
),
el(
"td",
{},
r["KilometersPerLiter"] === "" ? "-" : r["KilometersPerLiter"]
),
])
);
});

card.append(hoursTable);
mainContent.append(card);

if (profile.role === "user") {
pdfBtn.style.display =
excelBtn.style.display =
csvBtn.style.display =
"none";
} else {
const hdrs = [
"Date It Was Used",
"Recording Dated",
"Type",
"Fuel Added (L)",
"Fuel Used (L)",
"Odometer(hrs)",
"Diff since prev (hours)",
"KilometersPerLiter",
];

    const exportRows = detailRows
      .slice()
      .reverse()
      .map((r) => ({
        "Date It Was Used": r["Date It Was Used"],
        "Recording Dated": r["Recording Dated"],
        Type: r["Type"],
        "Fuel Added (L)": r["Fuel Added (L)"],
        "Fuel Used (L)": r["Fuel Used (L)"],
        "Odometer(hrs)": r["Odometer(hrs)"],
        "Diff since prev (hours)": r["Diff since prev (hours)"],
        KilometersPerLiter: r["KilometersPerLiter"],
      }));
    pdfBtn.onclick = () =>
      exportToPDF(
        `Details - ${profileRow.full_name || profileRow.email}`,
        exportRows,
        hdrs
      );
    excelBtn.onclick = () =>
      exportToExcel(
        `details-${profileRow.full_name}.xlsx`,
        "Details",
        exportRows,
        hdrs
      );
    csvBtn.onclick = () =>
      exportToCSV(`details-${profileRow.full_name}.csv`, exportRows, hdrs);

}
}

// views/user.js
import {
supabase,
profile,
mainContent,
el,
fmt,
toast,
ensureCachesLoaded,
buildGeneratorSelect,
renderView,
setBackNavigation,
} from "../app.js";
import { fetchUserMetrics } from "./shared.js";

export function renderAddFuelForm() {
const wrapper = el("div");

const amount = el("input", {
placeholder: "Amount (L)",
type: "number",
step: "0.1",
min: "0",
});
const notes = el("textarea", { placeholder: "Notes (optional)", rows: 2 });
const doc = el("input", { placeholder: "Delivery Document Number" });
const receivedAt = el("input", { type: "datetime-local" });

const submit = el("button", { class: "primary" }, "Add to Tank");
submit.onclick = async () => {
const amt = parseFloat(amount.value);
if (!amt || isNaN(amt) || amt <= 0) {
toast("Enter valid amount", "error");
return;
}

    const chosenDate = receivedAt.value
      ? new Date(receivedAt.value).toISOString()
      : new Date().toISOString();

    const payload = {
      user_id: profile.user_id,
      plaza_id: profile.plaza_id,
      generator_id: null,
      fuel_amount: amt,
      notes: notes.value || null,
      delivery_doc_number: doc.value || null,
      transaction_date: chosenDate,
    };

    const { error } = await supabase.from("fuel_transactions").insert(payload);
    if (error) {
      console.error("Add fuel error", error);
      toast("Failed to add fuel", "error");
      return;
    }

    toast(`Added ${amt} L to plaza tank`);
    renderView("home");

};

wrapper.append(
el("div", { class: "input-group mt" }, [el("label", {}), amount]),
el("div", { class: "input-group mt" }, [el("label", {}), doc]),
el("div", { class: "input-group mt" }, [el("label", {}), receivedAt]),
el("div", { class: "input-group mt" }, [el("label", {}), notes]),
submit
);

return wrapper;
}

export function renderUseFuelForm() {
const wrapper = el("div");

const amount = el("input", {
placeholder: "Amount (L)",
type: "number",
step: "0.1",
min: "0",
});
const notes = el("textarea", { placeholder: "Notes (optional)", rows: 2 });
const genSelect = el("select");
ensureCachesLoaded().then(() =>
buildGeneratorSelect(genSelect, profile.plaza_id, null)
);
const usedAt = el("input", { type: "datetime-local" });
const odometer = el("input", {
placeholder: "Odometer hours",
type: "number",
step: "0.1",
min: "0",
});

const submit = el(
"button",
{ class: "destructive mt" },
"Take from Tank → Generator"
);
submit.onclick = async () => {
const amt = parseFloat(amount.value);
if (!amt || isNaN(amt) || amt <= 0) {
toast("Enter a valid amount", "error");
return;
}

    if (!genSelect.value) {
      toast("Select a generator", "error");
      return;
    }

    const odoVal = parseFloat(odometer.value);
    if (!odoVal || odoVal <= 0) {
      toast("Enter valid odometer hours", "error");
      return;
    }

    // check plaza_tanks balance before deducting
    const { data: tank, error: tankErr } = await supabase
      .from("plaza_tanks")
      .select("current_balance")
      .eq("plaza_id", profile.plaza_id)
      .single();

    if (tankErr) {
      console.error("Tank balance check error", tankErr);
      toast("Failed to check tank balance", "error");
      return;
    }

    const balance = Number(tank?.current_balance || 0);
    if (amt > balance) {
      toast("Insufficient tank balance", "error");
      return;
    }

    const chosenDate = usedAt.value
      ? new Date(usedAt.value).toISOString()
      : new Date().toISOString();

    const payload = {
      user_id: profile.user_id,
      plaza_id: profile.plaza_id,
      generator_id: genSelect.value,
      fuel_amount: -Math.abs(amt), // usage = negative
      notes: notes.value || `Used ${amt} L`,
      transaction_date: chosenDate,
      odometer_hours: odoVal,
    };

    const { error: insErr } = await supabase
      .from("fuel_transactions")
      .insert(payload);
    if (insErr) {
      console.error("Use fuel error", insErr);
      toast("Failed to record usage", "error");
      return;
    }

    toast(`Used ${amt} L from tank`);
    renderView("home");

};

wrapper.append(
el("div", { class: "input-group mt" }, [el("label", {}), genSelect]),
el("div", { class: "input-group mt" }, [el("label", {}), amount]),
el("div", { class: "input-group mt" }, [el("label", {}), odometer]),
el("div", { class: "input-group mt" }, [el("label", {}), usedAt]),
el("div", { class: "input-group mt" }, [el("label", {}), notes]),
submit
);

return wrapper;
}

export async function renderUserHome() {
mainContent.innerHTML = "";
setBackNavigation(false);

const container = el("div", { class: "card" });
container.append(
el("h2", {}, `Welcome ${profile.full_name || profile.email}`)
);

const metrics = await fetchUserMetrics(profile.user_id, profile.plaza_id);

const statsRow = el("div", { class: "grid-4 mt" }, [
el("div", {
html: `<strong>${fmt(
metrics.balance
)} L</strong><div class="text-muted">Tank Balance</div>`,
}),
el("div", {
html: `<strong>${fmt(
metrics.weeklyUsage
)} L</strong><div class="text-muted">Weekly Usage</div>`,
}),
el("div", {
html: `<strong>${fmt(
metrics.totalAdded
)} L</strong><div class="text-muted">Total Added</div>`,
}),
el("div", {
html: `<strong>${fmt(
metrics.totalUsed
)} L</strong><div class="text-muted">Total Used</div>`,
}),
]);
container.append(statsRow);

container.append(el("h3", { class: "mt" }, "Add to Tank"));
container.append(renderAddFuelForm());

container.append(el("h3", { class: "mt" }, "Take from Tank to Generator"));
container.append(renderUseFuelForm());

mainContent.append(container);
}

// views/admin.js
import {
supabase,
el,
toast,
fmt,
ensureCachesLoaded,
plazasById,
generatorsById,
buildGeneratorSelect,
renderView,
setBackNavigation,
} from "../app.js";

export async function renderPlazasManagement() {
setBackNavigation(true);
const container = el("div", { class: "card" });
container.append(el("h2", {}, "Plazas"));
mainContent?.append(container); // mainContent is in app, but admin may not need it here

const input = el("input", { placeholder: "New plaza name" });
const btn = el("button", { class: "primary" }, "Add Plaza");
btn.onclick = async () => {
const name = input.value.trim();
if (!name) return toast("Provide a name", "error");
const { error } = await supabase.from("plazas").insert({ name });
if (error) {
console.error("Add plaza error", error);
toast("Failed to create plaza", "error");
return;
}
await ensureCachesLoaded();
renderPlazasManagement();
};
container.append(input, btn);

const { data: plazas = [], error } = await supabase
.from("plazas")
.select("\*")
.order("name", { ascending: true });
if (error) {
console.error("load plazas error", error);
toast("Failed to load plazas", "error");
return;
}

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody></tbody>`;
plazas.forEach((p) => {
const tr = el("tr", {}, [
el("td", {}, p.name),
el(
"td",
{},
(() => {
const del = el("button", { class: "destructive" }, "Delete");
del.onclick = async () => {
if (
!confirm("Delete plaza? This may orphan generators/transactions.")
)
return;
const { error } = await supabase
.from("plazas")
.delete()
.eq("id", p.id);
if (error) {
console.error("delete plaza error", error);
toast("Delete failed", "error");
return;
}
await ensureCachesLoaded();
renderPlazasManagement();
};
return del;
})()
),
]);
table.querySelector("tbody").appendChild(tr);
});
container.append(table);
}

export async function renderGeneratorsManagement() {
setBackNavigation(true);
const container = el("div", { class: "card" });
container.append(el("h2", {}, "Generators"));
mainContent?.append(container);

await ensureCachesLoaded();
const plazaSelect = el("select");
plazaSelect.appendChild(el("option", { value: "" }, "Select plaza"));
Object.values(plazasById || {}).forEach((p) =>
plazaSelect.appendChild(el("option", { value: p.id }, p.name))
);

const genInput = el("input", { placeholder: "Generator name" });
const addBtn = el("button", { class: "primary" }, "Add Generator");
addBtn.onclick = async () => {
const pid = plazaSelect.value;
const name = genInput.value.trim();
if (!pid || !name)
return toast("Select plaza and enter generator name", "error");
const { error } = await supabase
.from("generators")
.insert({ plaza_id: pid, name });
if (error) {
console.error("add generator error", error);
toast("Failed to add generator", "error");
return;
}
await ensureCachesLoaded();
renderGeneratorsManagement();
};
container.append(
el("div", { class: "grid-3" }, [plazaSelect, genInput, addBtn])
);

const { data: gens = [], error } = await supabase
.from("generators")
.select("\*")
.order("created_at", { ascending: false });
if (error) {
console.error("load generators error", error);
toast("Failed to load generators", "error");
return;
}

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr><th>Name</th><th>Plaza</th><th>Actions</th></tr></thead><tbody></tbody>`;
gens.forEach((g) => {
const tr = el("tr", {}, [
el("td", {}, g.name),
el("td", {}, plazasById[g.plaza_id]?.name || "-"),
el(
"td",
{},
(() => {
const del = el("button", { class: "destructive" }, "Delete");
del.onclick = async () => {
if (!confirm("Delete generator?")) return;
const { error } = await supabase
.from("generators")
.delete()
.eq("id", g.id);
if (error) {
console.error("delete generator error", error);
toast("Delete failed", "error");
return;
}
await ensureCachesLoaded();
renderGeneratorsManagement();
};
return del;
})()
),
]);
table.querySelector("tbody").appendChild(tr);
});
container.append(table);
}

// views/manager.js - manager home & metrics
import {
supabase,
profile,
mainContent,
el,
setBackNavigation,
toast,
ensureCachesLoaded,
fmt,
} from "../app.js";
import { renderHome } from "./shared.js";
import { fetchPlazaMetrics as \_fetchPlazaMetrics } from "./admin.js"; // small helper exists in admin module
// views/manager.js

export async function renderManagerHome() {
mainContent.innerHTML = "";
setBackNavigation(false);

await renderHome();
await ensureCachesLoaded();

const container = el("div", { class: "card" });
container.append(
el("h2", {}, `Manager Dashboard — ${profile.full_name || profile.email}`)
);

const plazaToShow = profile.plaza_id || null;
const plazaIds = plazaToShow
? [plazaToShow]
: (await supabase.from("plazas").select("id")).data.map((p) => p.id);

// load transactions for these plazas
const { data: txns = [], error } = await supabase
.from("fuel_transactions")
.select("fuel_amount,plaza_id,transaction_date")
.order("transaction_date", { ascending: false })
.in("plaza_id", plazaIds);
if (error) {
console.error("Home transactions load error", error);
toast("Failed to load metrics", "error");
return;
}

// group
const byPlaza = {};
(txns || []).forEach((t) => {
const pid = t.plaza_id || null;
if (!byPlaza[pid]) byPlaza[pid] = { added: 0, used: 0, transactions: [] };
const amt = Number(t.fuel_amount || 0);
if (amt > 0) byPlaza[pid].added += amt;
else byPlaza[pid].used += Math.abs(amt);
byPlaza[pid].transactions.push(t);
});

// ensure all plazas show
plazaIds.forEach((pid) => {
if (!byPlaza[pid]) byPlaza[pid] = { added: 0, used: 0, transactions: [] };
});

for (const pid of plazaIds) {
const stats = byPlaza[pid] || { added: 0, used: 0 };
const net = stats.added - stats.used;
const ratio = stats.added > 0 ? (stats.used / stats.added) \* 100 : 0;
const name =
(await supabase.from("plazas").select("name").eq("id", pid).maybeSingle())
.data?.name || "Unassigned";

    const card = el("div", { class: "card mt" });
    card.append(el("h3", {}, name));
    const grid = el("div", { class: "grid-3" });

    // gauge
    const gauge = buildFuelGauge(Math.max(0, net), stats.added);
    const gaugeContainer = el("div", { class: "gauge-container" }, gauge);
    grid.append(gaugeContainer);

    // metrics
    const metricBlock = el("div", {}, [
      el("p", {}, `Total Added: ${fmt(stats.added)} L`),
      el("p", {}, `Total Used: ${fmt(stats.used)} L`),
      el("p", {}, `Net Remaining: ${fmt(net)} L`),
      el("p", {}, `Usage Ratio: ${ratio.toFixed(1)}%`),
    ]);
    grid.append(metricBlock);

    // placeholder for pie
    const pieContainer = el("div", { style: "height:200px;" });
    pieContainer.innerHTML = `<svg width="100%" height="100%"></svg>`;
    grid.append(pieContainer);

    card.append(grid);
    mainContent.append(card);

}
}

/_ small inline gauge builder reused _/
function buildFuelGauge(net, added) {
const percentage =
added > 0 ? Math.max(0, Math.min(100, (net / added) _ 100)) : 0;
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.setAttribute("width", "120");
svg.setAttribute("height", "120");
svg.setAttribute("viewBox", "0 0 120 120");
const radius = 44;
const stroke = 12;
const circumference = 2 _ Math.PI _ radius;
const filled = (percentage / 100) _ circumference;
const bg = document.createElementNS(svg.namespaceURI, "circle");
bg.setAttribute("cx", "60");
bg.setAttribute("cy", "60");
bg.setAttribute("r", String(radius));
bg.setAttribute("stroke", "#e5e7eb");
bg.setAttribute("stroke-width", String(stroke));
bg.setAttribute("fill", "none");
svg.appendChild(bg);
const fg = document.createElementNS(svg.namespaceURI, "circle");
fg.setAttribute("cx", "60");
fg.setAttribute("cy", "60");
fg.setAttribute("r", String(radius));
fg.setAttribute("stroke", percentage > 50 ? "#10b981" : "#ef4444");
fg.setAttribute("stroke-width", String(stroke));
fg.setAttribute("fill", "none");
fg.setAttribute("stroke-dasharray", `${filled} ${circumference}`);
fg.setAttribute("transform", "rotate(-90 60 60)");
svg.appendChild(fg);
const text = document.createElementNS(svg.namespaceURI, "text");
text.setAttribute("x", "60");
text.setAttribute("y", "65");
text.setAttribute("text-anchor", "middle");
text.setAttribute("font-size", "16");
text.setAttribute("font-weight", "bold");
text.textContent = `${percentage.toFixed(0)}%`;
svg.appendChild(text);
return svg;
}
