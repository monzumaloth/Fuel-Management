// app2.js (complete)
// Vanilla JS dashboard connecting to Supabase
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import jsPDF from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";

const cfg = window.APP_CONFIG || {};
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
throw new Error("Please set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
auth: { persistSession: true, storage: localStorage },
});

/_ -------------------------
DOM elements
------------------------- _/
const loginSection = document.getElementById("login-section");
const dashboardShell = document.getElementById("dashboard-shell");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginError = document.getElementById("login-error");
const appTitle = document.getElementById("app-title");
const userRoleBadge = document.getElementById("user-role-badge");
const mainContent = document.getElementById("main-content");
const backBtn = document.getElementById("back-btn");
const nav = document.getElementById("nav");

let currentUser = null;
let profile = null;

// caches & maps
let plazasCache = [];
let generatorsCache = [];
let profilesCache = [];
let plazasById = {};
let generatorsById = {};
let generatorsByPlaza = {};
let profilesByUserId = {};

/_ -------------------------
Helpers
------------------------- _/
function el(tag, attrs = {}, children = []) {
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
function fmt(n) {
return n === null || n === undefined ? "-" : Number(n).toFixed(1);
}
function toast(msg, type = "info") {
// small unobtrusive toast
const t = el(
"div",
{
class: "card",
style:
"position:fixed;right:20px;bottom:20px;z-index:9999;min-width:200px",
},
`<strong>${type.toUpperCase()}</strong>: ${msg}`
);
document.body.appendChild(t);
setTimeout(() => t.remove(), 2500);
}

/\* -------------------------
Load caches (plazas, generators, profiles)

- build lookup maps used everywhere to avoid joins
  ------------------------- _/
  async function loadCaches() {
  try {
  const [plRes, gRes, pRes] = await Promise.all([
  supabase.from("plazas").select("_").order("name", { ascending: true }),
  supabase
  .from("generators")
  .select("_")
  .order("name", { ascending: true }),
  supabase.from("profiles").select("_"),
  ]);
  if (plRes.error) throw plRes.error;
  if (gRes.error) throw gRes.error;
  if (pRes.error) throw pRes.error;

      plazasCache = plRes.data || [];
      generatorsCache = gRes.data || [];
      profilesCache = pRes.data || [];

      // maps
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

function ensureCachesLoaded() {
if (!plazasCache.length || !generatorsCache.length || !profilesCache.length) {
return loadCaches();
}
return Promise.resolve();
}

function getGeneratorsForPlaza(plazaId) {
const key = plazaId || "";
return generatorsByPlaza[key] ? [...generatorsByPlaza[key]] : [];
}

function buildGeneratorSelect(selectEl, plazaId, selectedId = null) {
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

/_ -------------------------
Auth helpers
------------------------- _/
async function fetchProfileForUserId(userId) {
const { data, error } = await supabase
.from("profiles")
.select("\*")
.eq("user_id", userId)
.maybeSingle();
if (error) throw error;
return data;
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
loginSection.classList.remove("hidden");
dashboardShell.classList.add("hidden");
}

async function restoreSessionOnLoad() {
try {
const { data } = await supabase.auth.getSession();
const session = data?.session ?? null;
if (session?.user) {
currentUser = session.user;
await initAfterAuth();
}
} catch (err) {
console.warn("restoreSessionOnLoad failed", err);
}
}

/_ -------------------------
Init after auth
------------------------- _/
async function initAfterAuth() {
if (!currentUser) return;
profile = await fetchProfileForUserId(currentUser.id);
if (!profile) {
// create minimal profile row
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
renderView("home");
}

/_ -------------------------
Navigation
------------------------- _/
function renderNavButtons() {
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
if (e.target.tagName === "BUTTON") {
const view = e.target.dataset.view;
renderView(view);
}
});

/_ -------------------------
Views routing
------------------------- _/
function setBackNavigation(enable) {
backBtn.style.display = enable ? "inline-block" : "none";
backBtn.onclick = enable ? () => renderView("home") : null;
}
function renderView(view) {
setBackNavigation(false);
if (view === "home") return renderHome();
if (view === "transactions") return renderTransactionsPage();
if (view === "users" && profile.role !== "user") return renderUsersPage();
if (view === "plazas" && profile.role === "admin")
return renderPlazasManagement();
if (view === "generators" && profile.role === "admin")
return renderGeneratorsManagement();
return renderHome();
}

/_ -------------------------
Forms: Add Fuel / Use Fuel (user)
------------------------- _/
function addFuelForm() {
const wrapper = el("div");
const amount = el("input", { placeholder: "Amount (L)", type: "number" });
const notes = el("textarea", { placeholder: "Notes (optional)", rows: 2 });
const doc = el("input", { placeholder: "Delivery Document Number" });
const receivedAt = el("input", { type: "datetime-local" });
const odometer = el("input", {
placeholder: "Odometer hours",
type: "number",
});

const genSelect = el("select");
ensureCachesLoaded().then(() =>
buildGeneratorSelect(genSelect, profile.plaza_id, null)
);

const submit = el("button", { class: "primary mt" }, "Add Fuel");
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
      fuel_amount: amt,
      notes: notes.value || null,
      delivery_doc_number: doc.value || null,
      transaction_date: chosenDate, // ✅ actual date chosen by user
      odometer_hours: odometer.value ? parseFloat(odometer.value) : null,
      generator_id: genSelect.value || null,
      plaza_id: profile.plaza_id || null,
      // created_at handled by DB
    };

    const { error } = await supabase.from("fuel_transactions").insert(payload);
    if (error) {
      console.error("Add fuel error", error);
      toast("Failed to add fuel", "error");
      return;
    }
    toast(`Added ${amt} L`);
    // refresh caches & view
    await loadCaches();
    renderView("home");

};

wrapper.append(amount, notes, doc, receivedAt, odometer, genSelect, submit);
return wrapper;
}

function useFuelForm() {
const wrapper = el("div");
const amount = el("input", { placeholder: "Amount (L)", type: "number" });
const notes = el("textarea", { placeholder: "Notes (optional)", rows: 2 });
const genSelect = el("select");
ensureCachesLoaded().then(() =>
buildGeneratorSelect(genSelect, profile.plaza_id, null)
);
const usedAt = el("input", { type: "datetime-local" });
const odometer = el("input", {
placeholder: "Odometer hours",
type: "number",
});

const submit = el("button", { class: "destructive mt" }, "Use Fuel (Deduct)");
submit.onclick = async () => {
const amt = parseFloat(amount.value);
if (!amt || isNaN(amt) || amt <= 0) {
toast("Enter a valid amount", "error");
return;
}
// check balance
const metrics = await fetchUserMetrics(profile.user_id);
if (amt > metrics.balance) {
toast("Insufficient fuel", "error");
return;
}
const chosenDate = usedAt.value
? new Date(usedAt.value).toISOString()
: new Date().toISOString();

    const payload = {
      user_id: profile.user_id,
      fuel_amount: -Math.abs(amt),
      notes: notes.value || `Used ${amt} L`,
      generator_id: genSelect.value || null,
      plaza_id: profile.plaza_id || null,
      transaction_date: chosenDate,
      odometer_hours: odometer.value ? parseFloat(odometer.value) : null,
    };

    const { error } = await supabase.from("fuel_transactions").insert(payload);
    if (error) {
      console.error("Use fuel error", error);
      toast("Failed to record usage", "error");
      return;
    }
    toast(`Used ${amt} L`);
    await loadCaches();
    renderView("home");

};

wrapper.append(amount, notes, genSelect, usedAt, odometer, submit);
return wrapper;
}

/_ -------------------------
Metrics helpers (user / plaza / site)
------------------------- _/
async function fetchUserMetrics(user_id) {
// returns { balance, weeklyUsage, totalAdded, totalUsed, lastActivity, transactions }
try {
const { data: txs = [], error } = await supabase
.from("fuel_transactions")
.select(
"fuel_amount,transaction_date,odometer_hours,notes,generator_id,plaza_id"
)
.eq("user_id", user_id)
.order("transaction_date", { ascending: false });
if (error) throw error;

    const balance = (txs || []).reduce(
      (s, t) => s + Number(t.fuel_amount || 0),
      0
    );
    const oneWeek = new Date();
    oneWeek.setDate(oneWeek.getDate() - 7);
    const weeklyUsage = Math.abs(
      (txs || [])
        .filter(
          (t) =>
            Number(t.fuel_amount) < 0 && new Date(t.transaction_date) >= oneWeek
        )
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );
    const totalAdded = (txs || [])
      .filter((t) => Number(t.fuel_amount) > 0)
      .reduce((s, t) => s + Number(t.fuel_amount || 0), 0);
    const totalUsed = Math.abs(
      (txs || [])
        .filter((t) => Number(t.fuel_amount) < 0)
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );
    const lastActivity = (txs || []).length ? txs[0].transaction_date : null;

    return {
      balance,
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
weeklyUsage: 0,
totalAdded: 0,
totalUsed: 0,
lastActivity: null,
transactions: [],
};
}
}

async function fetchPlazaMetrics(plaza_id) {
try {
let q = supabase
.from("fuel_transactions")
.select("fuel_amount,transaction_date,plaza_id");
if (plaza_id) q = q.eq("plaza_id", plaza_id);
const { data: txs = [], error } = await q;
if (error) throw error;

    let added = 0,
      used = 0;
    txs.forEach((t) => {
      const amt = Number(t.fuel_amount || 0);
      if (amt > 0) added += amt;
      else used += Math.abs(amt);
    });
    const net = added - used;
    const ratio = added > 0 ? (used / added) * 100 : 0;
    return {
      totalFuel: added - used,
      totalAdded: added,
      totalUsed: used,
      net,
      ratio,
      transactions: txs,
    };

} catch (err) {
console.error("fetchPlazaMetrics error:", err);
return {
totalFuel: 0,
totalAdded: 0,
totalUsed: 0,
net: 0,
ratio: 0,
transactions: [],
};
}
}

async function fetchSiteMetrics() {
try {
const { data: txs = [], error } = await supabase
.from("fuel_transactions")
.select("fuel_amount,plaza_id");
if (error) throw error;
let added = 0,
used = 0;
txs.forEach((t) => {
const amt = Number(t.fuel_amount || 0);
if (amt > 0) added += amt;
else used += Math.abs(amt);
});
return {
totalFuel: added - used,
totalAdded: added,
totalUsed: used,
transactions: txs,
};
} catch (err) {
console.error("fetchSiteMetrics error:", err);
return { totalFuel: 0, totalAdded: 0, totalUsed: 0, transactions: [] };
}
}

/\* -------------------------
Home page

- users: metrics & add/use forms
- manager: their plaza metrics (or all if no plaza)
- admin: show per-plaza dashboards
  ------------------------- \*/
  async function renderHome() {
  mainContent.innerHTML = "";
  setBackNavigation(false);

const container = el("div", { class: "card" });
container.append(
el("h2", {}, `Welcome ${profile.full_name || profile.email}`)
);

if (profile.role === "user") {
// user metrics + forms
const metrics = await fetchUserMetrics(profile.user_id);
const statsRow = el("div", { class: "grid-3 mt" }, [
el("div", {
html: `<strong>${fmt(
metrics.balance
)} L</strong><div class="text-muted">Balance</div>`,
}),
el("div", {
html: `<strong>${fmt(
metrics.weeklyUsage
)} L</strong><div class="text-muted">Weekly usage</div>`,
}),
el("div", {
html: `<strong>${fmt(
metrics.totalAdded
)} L</strong><div class="text-muted">Total added</div>`,
}),
]);
container.append(statsRow);

    container.append(el("h3", { class: "mt" }, "Add Fuel"));
    container.append(addFuelForm());
    container.append(el("h3", { class: "mt" }, "Use Fuel"));
    container.append(useFuelForm());

    mainContent.append(container);
    return;

}

// manager/admin metrics
mainContent.append(container);

// decide which plazas to show
// - manager with plaza: only that plaza
// - manager without plaza: all plazas
// - admin: all plazas
const plazaIdsToShow = new Set();
if (profile.role === "manager" && profile.plaza_id) {
plazaIdsToShow.add(profile.plaza_id);
} else {
plazasCache.forEach((p) => plazaIdsToShow.add(p.id));
}

// load all transactions (we will group client-side)
const { data: txns = [], error } = await supabase
.from("fuel_transactions")
.select("fuel_amount,plaza_id,transaction_date")
.order("transaction_date", { ascending: false });
if (error) {
console.error("Home transactions load error:", error);
toast("Failed to load metrics", "error");
return;
}

// group
const byPlaza = {};
(txns || []).forEach((t) => {
const pid = t.plaza_id || null;
// only include plazas we should show (managers restricted)
if (!plazaIdsToShow.has(pid)) return;
if (!byPlaza[pid])
byPlaza[pid] = { added: 0, used: 0, plaza_id: pid, transactions: [] };
const amt = Number(t.fuel_amount || 0);
if (amt > 0) byPlaza[pid].added += amt;
else byPlaza[pid].used += Math.abs(amt);
byPlaza[pid].transactions.push(t);
});

// if no data for some plaza, ensure they still show (esp admin)
plazaIdsToShow.forEach((pid) => {
if (!byPlaza[pid])
byPlaza[pid] = { added: 0, used: 0, plaza_id: pid, transactions: [] };
});

// render each plaza card sorted by plaza name
const plazaList = Array.from(plazaIdsToShow).map((id) => ({
id,
name: plazasById[id]?.name || "Unassigned",
}));
plazaList.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

plazaList.forEach((pmeta) => {
const stats = byPlaza[pmeta.id] || {
added: 0,
used: 0,
plaza_id: pmeta.id,
};
const net = stats.added - stats.used;
const ratio = stats.added > 0 ? (stats.used / stats.added) \* 100 : 0;

    const section = el("div", { class: "card mt" });
    section.append(el("h3", {}, pmeta.name));

    const grid = el("div", { class: "grid-3" });

    // gauge (visual)
    const gaugeContainer = el("div", { class: "gauge-container" });
    gaugeContainer.append(buildFuelGauge(Math.max(0, net), stats.added));
    grid.append(gaugeContainer);

    // metrics
    const metricBlock = el("div", {}, [
      el("p", {}, `Total Added: ${fmt(stats.added)} L`),
      el("p", {}, `Total Used: ${fmt(stats.used)} L`),
      el("p", {}, `Net Remaining: ${fmt(net)}`),
      el("p", {}, `Usage Ratio: ${ratio.toFixed(1)}%`),
    ]);
    grid.append(metricBlock);

    // pie
    const pieContainer = el("div", { style: "height:200px;" });
    pieContainer.innerHTML = `<svg id="home-pie-${pmeta.id}" width="100%" height="100%"></svg>`;
    grid.append(pieContainer);

    section.append(grid);
    mainContent.append(section);

    // render pie
    renderMiniPieChart(`home-pie-${pmeta.id}`, [
      { name: "Used", value: stats.used },
      { name: "Remaining", value: Math.max(0, net) },
    ]);

});
}

/_ -------------------------
Gauge & mini pie renderers
------------------------- _/
function buildFuelGauge(net, added) {
const percentage =
added > 0 ? Math.max(0, Math.min(100, (net / added) _ 100)) : 0;
const radius = 44;
const stroke = 12;
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
const width = svg.clientWidth || 200;
const height = svg.clientHeight || 200;
const radius = Math.min(width, height) / 2;
const total = data.reduce((s, d) => s + (d.value || 0), 0);
if (total === 0) {
// show fallback text
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
const x1 = width / 2 + radius _ Math.cos(startAngle);
const y1 = height / 2 + radius _ Math.sin(startAngle);
const x2 = width / 2 + radius _ Math.cos(startAngle + angle);
const y2 = height / 2 + radius _ Math.sin(startAngle + angle);
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

/\* -------------------------
Transactions page

- NO embed/join; fetch raw txs and map names via caches
  ------------------------- \*/
  async function renderTransactionsPage() {
  mainContent.innerHTML = "";
  setBackNavigation(true);

const card = el("div", { class: "card" });
card.append(el("h2", {}, "Transactions"));

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr>
<th>Transaction Date</th>
<th>Recorded (Created)</th>
<th>User</th>
<th>Amount</th>
<th>Notes</th>
<th>Generator</th>
<th>Plaza</th>

  </tr></thead><tbody></tbody>`;
  card.append(table);
  mainContent.append(card);

// build base query
let q = supabase
.from("fuel_transactions")
.select("\*")
.order("transaction_date", { ascending: false });

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

});
}

/_ -------------------------
Users page (admin/manager)
------------------------- _/
async function renderUsersPage() {
mainContent.innerHTML = "";
setBackNavigation(true);

const card = el("div", { class: "card" });
card.append(
el("h2", {}, profile.role === "admin" ? "User Management" : "Users")
);
mainContent.append(card);

// load profiles fresh (small table)
const { data: profilesList = [], error } = await supabase
.from("profiles")
.select("user_id,full_name,email,role,plaza_id")
.order("created_at", { ascending: false });
if (error) {
console.error("users load error", error);
toast("Failed to load users", "error");
return;
}

// filtering rules for manager
const rows = (profilesList || []).filter((p) => {
if (profile.role === "manager" && p.role === "admin") return false;
if (profile.role === "manager" && p.user_id === profile.user_id)
return false; // hide self
if (profile.role === "manager" && profile.plaza_id) {
// manager bound to a plaza -> only show same plaza
return p.plaza_id === profile.plaza_id;
}
return true;
});

const table = el("table", { class: "table mt" });
table.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Plaza</th><th>Balance</th><th>Actions</th></tr></thead><tbody></tbody>`;
card.append(table);

for (const p of rows) {
const metrics = await fetchUserMetrics(p.user_id);
const balanceLabel = `${Number(metrics.balance).toFixed(1)} L`;
const tr = el("tr", {}, [
el("td", {}, p.full_name || p.email),
el("td", {}, p.email),
el("td", {}, p.role),
el("td", {}, plazasById[p.plaza_id]?.name || "-"),
el("td", {}, balanceLabel),
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
}

/_ -------------------------
User detail (transactions, odometer diffs)
------------------------- _/
async function renderUserDetail(profileRow) {
mainContent.innerHTML = "";
setBackNavigation(true);
const card = el("div", { class: "card" });
card.append(
el("h2", {}, `Details — ${profileRow.full_name || profileRow.email}`)
);

const { data: txs = [], error } = await supabase
.from("fuel_transactions")
.select("\*")
.eq("user_id", profileRow.user_id)
.order("transaction_date", { ascending: false });
if (error) {
console.error("renderUserDetail txs error:", error);
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

// odometer diffs table
const hoursTable = el("table", { class: "table mt" });
hoursTable.innerHTML = `<thead><tr><th>Date</th><th>Type</th><th>Odometer</th><th>Diff since prev (hours)</th></tr></thead><tbody></tbody>`;
let prevOdo = null;
(txs || []).forEach((tx) => {
const currentOdo =
tx.odometer_hours !== null && tx.odometer_hours !== undefined
? Number(tx.odometer_hours)
: null;
const diff =
prevOdo !== null && currentOdo !== null ? currentOdo - prevOdo : null;
const type = Number(tx.fuel_amount) > 0 ? "Added" : "Used";
hoursTable
.querySelector("tbody")
.appendChild(
el("tr", {}, [
el(
"td",
{},
tx.transaction_date
? new Date(tx.transaction_date).toLocaleString()
: "-"
),
el("td", {}, type),
el("td", {}, currentOdo === null ? "-" : currentOdo.toFixed(1)),
el("td", {}, diff === null ? "-" : diff.toFixed(1)),
])
);
if (currentOdo !== null) prevOdo = currentOdo;
});
card.append(hoursTable);
mainContent.append(card);
}

/_ -------------------------
Plazas management (admin)
------------------------- _/
async function renderPlazasManagement() {
mainContent.innerHTML = "";
setBackNavigation(true);

const card = el("div", { class: "card" });
card.append(el("h2", {}, "Plazas"));
mainContent.append(card);

const input = el("input", { placeholder: "New plaza name" });
const btn = el("button", { class: "primary mt" }, "Add Plaza");
btn.onclick = async () => {
const name = input.value.trim();
if (!name) return toast("Provide a name", "error");
const { error } = await supabase.from("plazas").insert({ name });
if (error) {
console.error("Add plaza error", error);
toast("Failed to create plaza", "error");
return;
}
await loadCaches();
renderPlazasManagement();
};
card.append(input, btn);

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
await loadCaches();
renderPlazasManagement();
};
return del;
})()
),
]);
table.querySelector("tbody").appendChild(tr);
});
card.append(table);
}

/_ -------------------------
Generators management (admin)
------------------------- _/
async function renderGeneratorsManagement() {
mainContent.innerHTML = "";
setBackNavigation(true);

const card = el("div", { class: "card" });
card.append(el("h2", {}, "Generators"));
mainContent.append(card);

// create row
const plazaSelect = el("select");
const placeholder = el("option", { value: "" }, "Select plaza");
plazaSelect.appendChild(placeholder);
plazasCache.forEach((p) =>
plazaSelect.appendChild(el("option", { value: p.id }, p.name))
);

const genInput = el("input", { placeholder: "Generator name" });
const addBtn = el("button", { class: "primary mt" }, "Add Generator");
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
await loadCaches();
renderGeneratorsManagement();
};
card.append(el("div", { class: "grid-3" }, [plazaSelect, genInput, addBtn]));

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
await loadCaches();
renderGeneratorsManagement();
};
return del;
})()
),
]);
table.querySelector("tbody").appendChild(tr);
});
card.append(table);
}

/_ -------------------------
Wire up & start
------------------------- _/
loginBtn.addEventListener("click", handleLogin);
logoutBtn.addEventListener("click", handleLogout);
restoreSessionOnLoad();
