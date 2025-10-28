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

function buildFuelGauge(net, added) {
  const percentage =
    added > 0 ? Math.max(0, Math.min(100, (net / added) * 100)) : 0;
  const radius = 44,
    stroke = 12;
  const circumference = 2 * Math.PI * radius;
  const filled = (percentage / 100) * circumference;
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
    const angle = (d.value / total) * 2 * Math.PI;
    const x1 = width / 2 + radius * Math.cos(startAngle),
      y1 = height / 2 + radius * Math.sin(startAngle);
    const x2 = width / 2 + radius * Math.cos(startAngle + angle),
      y2 = height / 2 + radius * Math.sin(startAngle + angle);
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
    .select("*")
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

/*******************************************************
 * USER DETAIL + MULTI-USER DETAIL (Shared Generators)
 * Complete, Ready-to-Use Version — 2025 Update
 *******************************************************/

export async function renderUserDetail(profileRow) {
  mainContent.innerHTML = "";
  setBackNavigation(true);
  const card = el("div", { class: "card" });
  card.append(
    el("h2", {}, `Details: ${profileRow.full_name || profileRow.email}`)
  );

  // 🧩 Fetch all plaza transactions to track shared odometers
  const { data: allPlazaTxs = [] } = await supabase
    .from("fuel_transactions")
    .select("*")
    .eq("plaza_id", profileRow.plaza_id)
    .order("transaction_date", { ascending: true });

  // Fetch user’s own transactions
  const { data: txs = [], error } = await supabase
    .from("fuel_transactions")
    .select("*")
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

  const totalAdded = txs
    .filter((t) => t.fuel_amount > 0)
    .reduce((s, t) => s + Number(t.fuel_amount), 0);
  const totalUsed = Math.abs(
    txs
      .filter((t) => t.fuel_amount < 0)
      .reduce((s, t) => s + Number(t.fuel_amount), 0)
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

  // Tools
  const toolsRow = el("div", { class: "row mt" });
  const pdfBtn = el("button", { class: "primary" }, "Export Detail PDF");
  const excelBtn = el("button", { class: "primary" }, "Export Detail Excel");
  const csvBtn = el("button", { class: "primary" }, "Export CSV");
  toolsRow.append(pdfBtn, excelBtn, csvBtn);
  card.append(toolsRow);

  // 🔹 Process transactions
  const detailRows = processUserTransactions(txs, allPlazaTxs);

  // Render table
  const hoursTable = el("table", { class: "table mt" });
  hoursTable.innerHTML = `<thead><tr>
    <th>Refuel Date</th><th>Record Date</th><th>Type</th><th>Generator</th>
    <th>Fuel Added (L)</th><th>Fuel Used (L)</th><th>Odometer(hrs)</th>
    <th>Odo Diff</th><th>HPL</th></tr></thead><tbody></tbody>`;
  const tbody = hoursTable.querySelector("tbody");

  detailRows.forEach((r) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", {}, r["Refuel Date"]),
        el("td", {}, r["Record Date"]),
        el("td", {}, r["Type"]),
        el("td", {}, r["Generator"]),
        el(
          "td",
          {},
          r["Fuel Added (L)"] === 0 ? "-" : fmt(r["Fuel Added (L)"])
        ),
        el("td", {}, r["Fuel Used (L)"] === 0 ? "-" : fmt(r["Fuel Used (L)"])),
        el("td", {}, r["Odometer(hrs)"] || "-"),
        el("td", {}, r["Diff since prev (hours)"] || "-"),
        el("td", {}, r["HoursPerLiter"] || "-"),
      ])
    );
  });
  hoursTable.appendChild(tbody);
  card.append(hoursTable);
  mainContent.append(card);

  // 🔹 Export buttons
  const hdrs = [
    "Refuel Date",
    "Record Date",
    "Type",
    "Generator",
    "Fuel Added (L)",
    "Fuel Used (L)",
    "Odometer(hrs)",
    "Diff since prev (hours)",
    "HoursPerLiter",
  ];

  pdfBtn.onclick = () =>
    exportToPDF(
      `Details - ${profileRow.full_name || profileRow.email}`,
      detailRows,
      hdrs
    );
  excelBtn.onclick = () =>
    exportToExcel(
      `details-${profileRow.full_name}.xlsx`,
      "Details",
      detailRows,
      hdrs
    );
  csvBtn.onclick = () =>
    exportToCSV(`details-${profileRow.full_name}.csv`, detailRows, hdrs);
}

/*******************************************************
 * Shared processing logic for both views
 *******************************************************/
export function processUserTransactions(userTxs, allPlazaTxs = []) {
  if (!userTxs?.length) return [];
  const orderedTxs = userTxs
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const prevOdoByGen = {};
  const rows = [];

  orderedTxs.forEach((tx) => {
    const genId = tx.generator_id || "tank";
    const currentOdo =
      tx.odometer_hours != null ? Number(tx.odometer_hours) : null;
    let prevOdo = prevOdoByGen[genId] ?? null;

    // 🔹 If missing, look back globally (same generator across plaza)
    if (prevOdo === null && currentOdo !== null && tx.generator_id) {
      const prevTx = allPlazaTxs
        .filter(
          (t) =>
            t.generator_id === tx.generator_id &&
            new Date(t.transaction_date) < new Date(tx.transaction_date)
        )
        .sort(
          (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
        )[0];
      if (prevTx?.odometer_hours != null)
        prevOdo = Number(prevTx.odometer_hours);
    }

    const diff =
      prevOdo != null && currentOdo != null ? currentOdo - prevOdo : null;
    const fuel = Number(tx.fuel_amount || 0);
    const litersAdded = fuel > 0 ? fuel : 0;
    const litersUsed = fuel < 0 ? Math.abs(fuel) : 0;

    const type = fuel > 0 ? "Added to tank" : "Taken to generator";
    const rate =
      diff != null && litersUsed > 0 ? Math.abs(diff) / litersUsed : null;
    const genLabel = generatorsById[tx.generator_id]?.name || "-";
    const plazaLabel = plazasById[tx.plaza_id]?.name || "";

    rows.push({
      "Refuel Date": tx.transaction_date
        ? new Date(tx.transaction_date).toLocaleString()
        : "",
      "Record Date": tx.created_at
        ? new Date(tx.created_at).toLocaleString()
        : "",
      Type: type,
      Generator: genLabel,
      Plaza: plazaLabel,
      "Fuel Added (L)": litersAdded,
      "Fuel Used (L)": litersUsed,
      "Odometer(hrs)": currentOdo ?? "",
      "Diff since prev (hours)": diff == null ? "" : Math.abs(diff),
      HoursPerLiter: rate == null ? "" : Number(rate.toFixed(2)),
    });

    if (currentOdo != null) prevOdoByGen[genId] = currentOdo;
  });

  return rows.slice().reverse();
}

/*******************************************************
 * Multi-User Detailed View (Shared Odo + Exports)
 *******************************************************/
export async function renderMultiUserDetail() {
  mainContent.innerHTML = "";
  setBackNavigation(true);

  const card = el("div", { class: "card" });
  card.append(el("h2", {}, "Multi-User Detailed Report (Shared Generators)"));

  // Manager = same plaza, Admin/global = all
  let usersQuery = supabase
    .from("profiles")
    .select("user_id, full_name, email, plaza_id, role")
    .eq("role", "user")
    .order("email", { ascending: true });

  if (profile.role === "manager" && profile.plaza_id)
    usersQuery = usersQuery.eq("plaza_id", profile.plaza_id);

  const { data: users = [], error } = await usersQuery;
  if (error) {
    console.error("User load failed:", error);
    mainContent.append(el("p", { class: "error" }, "Failed to load users."));
    return;
  }
  if (!users.length) {
    mainContent.append(el("p", { class: "error" }, "No users found."));
    return;
  }

  // Selection
  const userList = el("div", { class: "user-checkboxes mt" });
  users.forEach((u) => {
    const plazaName =
      u.plaza_id && plazasById[u.plaza_id]
        ? plazasById[u.plaza_id].name
        : "No Plaza";

    const labelText = `${u.full_name || u.email} (${plazaName})`;
    const checkbox = el("input", {
      type: "checkbox",
      name: "user-select",
      value: u.user_id,
      id: `user-${u.user_id}`,
    });
    const label = el("label", { for: `user-${u.user_id}` }, [
      checkbox,
      ` ${labelText}`,
    ]);
    userList.append(el("div", { class: "checkbox-item" }, [label]));
  });
  const loadBtn = el(
    "button",
    { class: "primary mt" },
    "Load Selected Details"
  );
  card.append(el("label", {}, "Select users:"), userList, loadBtn);
  mainContent.append(card);

  const resultContainer = el("div", { class: "mt" });
  mainContent.append(resultContainer);

  /************* LOAD & RENDER *************/
  loadBtn.onclick = async () => {
    const selected = Array.from(userList.querySelectorAll("input:checked")).map(
      (x) => x.value
    );
    if (!selected.length) {
      toast("Please select at least one user", "error");
      return;
    }
    resultContainer.innerHTML = `<p>Loading data...</p>`;

    // Fetch all TXs for selected users
    const { data: allTxs = [], error: txErr } = await supabase
      .from("fuel_transactions")
      .select("*")
      .in("user_id", selected)
      .order("transaction_date", { ascending: true });

    if (txErr) {
      console.error("Tx load fail:", txErr);
      resultContainer.innerHTML = `<p class="error">Failed to load transactions.</p>`;
      return;
    }

    // Split by user
    const txByUser = {};
    allTxs.forEach((t) => {
      if (!txByUser[t.user_id]) txByUser[t.user_id] = [];
      txByUser[t.user_id].push(t);
    });

    resultContainer.innerHTML = "";
    const allExportRows = [];
    const headers = [
      "User",
      "Refuel Date",
      "Record Date",
      "Type",
      "Generator",
      "Plaza",
      "Fuel Added (L)",
      "Fuel Used (L)",
      "Odometer(hrs)",
      "Diff since prev (hours)",
      "HoursPerLiter",
    ];

    for (const uid of selected) {
      const u = users.find((x) => x.user_id === uid);
      const userTxs = txByUser[uid] || [];
      const name = u?.full_name || u?.email || "Unknown";

      const section = el("div", { class: "card mt" });
      section.append(el("h3", {}, `${name} — ${userTxs.length} transactions`));

      if (!userTxs.length) {
        section.append(el("p", {}, "No transactions."));
        resultContainer.append(section);
        continue;
      }

      const detailRows = processUserTransactions(userTxs, allTxs);
      const tbody = el("tbody");
      detailRows.forEach((r) => {
        tbody.appendChild(
          el("tr", {}, [
            el("td", {}, r["Refuel Date"]),
            el("td", {}, r["Record Date"]),
            el("td", {}, r["Type"]),
            el("td", {}, r["Generator"]),
            el("td", {}, r["Plaza"]),
            el("td", {}, r["Fuel Added (L)"] || "-"),
            el("td", {}, r["Fuel Used (L)"] || "-"),
            el("td", {}, r["Odometer(hrs)"] || "-"),
            el("td", {}, r["Diff since prev (hours)"] || "-"),
            el("td", {}, r["HoursPerLiter"] || "-"),
          ])
        );
      });

      const table = el("table", { class: "table mt" });
      table.innerHTML = `<thead><tr>
        <th>Refuel Date</th><th>Record Date</th><th>Type</th><th>Generator</th><th>Plaza</th>
        <th>Added (L)</th><th>Used (L)</th><th>Odo</th><th>Diff</th><th>HPL</th>
      </tr></thead>`;
      table.append(tbody);
      section.append(table);
      resultContainer.append(section);

      // Push export data
      detailRows.forEach((r) => allExportRows.push({ User: name, ...r }));
    }

    // Combined export tools
    if (allExportRows.length) {
      const tools = el("div", { class: "row mt" });
      const excelBtn = el(
        "button",
        { class: "primary" },
        "Export Combined Excel"
      );
      const csvBtn = el("button", { class: "primary" }, "Export Combined CSV");
      tools.append(excelBtn, csvBtn);
      resultContainer.prepend(tools);

      excelBtn.onclick = () =>
        exportToExcel(
          "multi-user-report.xlsx",
          "Combined",
          allExportRows,
          headers
        );
      csvBtn.onclick = () =>
        exportToCSV("multi-user-report.csv", allExportRows, headers);
    }
  };
}
