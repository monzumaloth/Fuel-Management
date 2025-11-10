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
    // --- A. Fetch User Transactions ---
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

    // --- B. Fetch Plaza Tank Balance (if applicable) ---
    if (plaza_id) {
      const { data: tank, error: tankError } = await supabase
        .from("plaza_tanks")
        .select("plaza_id,current_balance,updated_at")
        .eq("plaza_id", plaza_id)
        .single();

      if (tankError) {
        // Handle expected "no rows found" error (PGRST116) gracefully
        if (tankError.code !== "PGRST116") {
          console.error("fetchUserMetrics plaza_tank error:", tankError);
          throw tankError; // Throw unexpected errors
        }
      } else if (tank) {
        tankBalance = Number(tank.current_balance || 0);
        tankUpdatedAt = tank.updated_at;
      }
    }

    // --- C. Calculate Derived Metrics ---

    // Define the start date for weekly calculation
    const oneWeek = new Date();
    oneWeek.setDate(oneWeek.getDate() - 7);

    // Filter and sum usage transactions from the last week
    const weeklyUsage = Math.abs(
      txs
        .filter(
          (t) =>
            Number(t.fuel_amount) < 0 && new Date(t.transaction_date) >= oneWeek
        )
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );

    // Total Added (Refuels)
    const totalAdded = txs
      .filter((t) => Number(t.fuel_amount) > 0)
      .reduce((s, t) => s + Number(t.fuel_amount || 0), 0);

    // Total Used (Consumption)
    const totalUsed = Math.abs(
      txs
        .filter((t) => Number(t.fuel_amount) < 0)
        .reduce((s, t) => s + Number(t.fuel_amount || 0), 0)
    );

    // Last Activity Date
    const lastActivity = txs.length ? txs[0].transaction_date : null;

    // --- D. Return Consolidated Metrics ---
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
    // Return safe defaults on any failure
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

  // Handle simple 'user' role redirection first
  if (profile.role === "user") {
    const mod = await import("./user.js");
    await mod.renderUserHome();
    return;
  }

  // --- 1. Dashboard Header (No changes here) ---
  const container = el("div", { class: "card report-card shadow-lg p-5 mb-4" });
  container.append(
    el(
      "h2",
      { class: "report-title mb-2" },
      `👋 Welcome, ${profile.full_name || profile.email}!`
    )
  );
  container.append(
    el(
      "p",
      { class: "text-muted border-bottom pb-4" },
      "Overview of Plaza Fuel Balances and Usage Metrics."
    )
  );
  mainContent.append(container);

  // --- 2. Determine Plazas to Display (No changes here) ---
  const plazaIdsToShow = new Set();
  if (profile.role === "manager" && profile.plaza_id) {
    plazaIdsToShow.add(profile.plaza_id);
  } else {
    Object.keys(plazasById).forEach((id) => plazaIdsToShow.add(id));
  }

  // --- 3. Fetch Transaction Summary (All relevant plazas) ---
  const { data: txns = [], error } = await supabase
    .from("fuel_transactions")
    .select("fuel_amount,plaza_id,transaction_date")
    .order("transaction_date", { ascending: false });

  if (error) {
    console.error("home tx load error", error);
    toast("Failed to load metrics", "error");
    mainContent.append(
      el(
        "p",
        { class: "error text-danger p-4" },
        "Failed to load transaction data."
      )
    );
    return;
  }

  // --- 4. Aggregate Metrics by Plaza (Includes new sorting calculation) ---
  const byPlaza = {};
  txns.forEach((t) => {
    const pid = t.plaza_id || null;
    if (!plazaIdsToShow.has(pid)) return;

    if (!byPlaza[pid]) byPlaza[pid] = { added: 0, used: 0 };
    const amt = Number(t.fuel_amount || 0);

    if (amt > 0) byPlaza[pid].added += amt;
    else byPlaza[pid].used += Math.abs(amt);
  });

  // Prepare and sort the list of plazas
  const plazaList = [...plazaIdsToShow].map((id) => {
    const stats = byPlaza[id] || { added: 0, used: 0 };
    const net = stats.added - stats.used;
    const percentage =
      stats.added > 0
        ? Math.max(0, Math.min(100, (net / stats.added) * 100))
        : 0;

    // Determine the status (NEW LOGIC)
    let status = "NORMAL";
    let statusColor = "#10b981"; // Green

    if (stats.added === 0) {
      status = "EMPTY";
      statusColor = "#6b7280"; // Gray/Muted
    } else if (net <= 30) {
      status = "CRITICAL";
      statusColor = "#ef4444"; // Red
    } else if (net <= 100) {
      status = "WARNING";
      statusColor = "#f59e0b"; // Orange
    }

    return {
      id,
      name: plazasById[id]?.name || "Unassigned",
      stats,
      net,
      percentage,
      status,
      statusColor,
    };
  });

  // SORTING LOGIC: Sort by fullness percentage (highest first)
  plazaList.sort((a, b) => b.percentage - a.percentage);

  // --- 5. Render Plaza Metric Cards ---
  plazaList.forEach((p) => {
    const section = el("div", {
      class: "card plaza-metric-card mt-4 shadow-md",
    });

    // Header with status indicator
    section.append(
      el(
        "h3",
        {
          class:
            "plaza-header pb-3 mb-3 d-flex justify-content-between align-items-center",
        },
        [
          el("span", { class: "text-xl font-bold" }, `📍 ${p.name}`),
          el(
            "span",
            {
              class: "status-indicator",
              style: `color: ${p.statusColor}; border-color: ${p.statusColor};`,
            },
            `Status: ${p.status}`
          ),
        ]
      )
    );

    const grid = el("div", { class: "dashboard-grid" });

    // A. Fuel Gauge (Left Column)
    const gaugeContainer = el("div", { class: "gauge-container" });
    gaugeContainer.append(buildFuelGauge(Math.max(0, p.net), p.stats.added)); // Uses original function

    const gaugeLabel = el("div", { class: "text-center pt-2" }, [
      el("p", { class: "font-weight-bold metric-net" }, `${fmt(p.net)} L`),
      el(
        "small",
        { class: "text-muted" },
        "Net Remaining (relative to total added)"
      ),
    ]);
    gaugeContainer.append(gaugeLabel);
    grid.append(gaugeContainer);

    // B. Key Metrics (Center Column)
    const metricBlock = el("div", { class: "metric-summary" }, [
      el(
        "p",
        { class: "metric-item added" },
        `Total Added: ${fmt(p.stats.added)} L`
      ),
      el(
        "p",
        { class: "metric-item used" },
        `Total Used: ${fmt(p.stats.used)} L`
      ),
      el("p", { class: "metric-item net" }, `Net Difference: ${fmt(p.net)} L`),
    ]);
    grid.append(metricBlock);

    // C. Pie Chart & Status Details (Right Column)
    const svgContainer = el("div", { style: "height:160px;" });
    svgContainer.innerHTML = `<svg id="home-pie-${p.id}" class="mini-pie" width="100%" height="100%"></svg>`;

    const rightCol = el("div", { class: "usage-chart-area" }, [
      el("p", { class: "chart-title" }, "Usage vs. Remaining"),
      svgContainer,
    ]);
    grid.append(rightCol);

    section.append(grid);
    mainContent.append(section);

    // Render the actual pie chart after elements are in the DOM
    renderMiniPieChart(`home-pie-${p.id}`, [
      { name: "Used", value: p.stats.used },
      { name: "Remaining", value: Math.max(0, p.net) },
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

  // Determine color based on health/percentage (UPDATED LOGIC)
  let gaugeColor = "#6b7280"; // Default for EMPTY
  if (added > 0) {
    gaugeColor =
      percentage > 50 ? "#10b981" : percentage > 20 ? "#f59e0b" : "#ef4444";
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "120");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("class", "fuel-gauge-svg");

  // Background Circle
  const bg = document.createElementNS(svg.namespaceURI, "circle");
  bg.setAttribute("cx", "60");
  bg.setAttribute("cy", "60");
  bg.setAttribute("r", String(radius));
  bg.setAttribute("stroke", "#e5e7eb");
  bg.setAttribute("stroke-width", String(stroke));
  bg.setAttribute("fill", "none");
  svg.appendChild(bg);

  // Foreground/Filled Arc
  const fg = document.createElementNS(svg.namespaceURI, "circle");
  fg.setAttribute("cx", "60");
  fg.setAttribute("cy", "60");
  fg.setAttribute("r", String(radius));
  fg.setAttribute("stroke", gaugeColor); // Dynamic color
  fg.setAttribute("stroke-width", String(stroke));
  fg.setAttribute("fill", "none");
  fg.setAttribute("stroke-dasharray", `${filled} ${circumference}`);
  fg.setAttribute("stroke-linecap", "round");
  fg.setAttribute("transform", "rotate(-90 60 60)");
  svg.appendChild(fg);

  // Percentage Text
  const text = document.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("x", "60");
  text.setAttribute("y", "65");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "16");
  text.setAttribute("font-weight", "bold");
  text.setAttribute("fill", "#1f2937");

  // Display "N/A" or "0%" if added is 0, otherwise show percentage
  text.textContent = added === 0 ? "N/A" : `${percentage.toFixed(0)}%`;
  svg.appendChild(text);

  return svg;
}

function renderMiniPieChart(containerId, data) {
  const svg = document.getElementById(containerId);
  if (!svg) return;
  svg.innerHTML = "";

  const width = svg.clientWidth || 200,
    height = svg.clientHeight || 200,
    radius = Math.min(width, height) / 2 - 10; // Minus 10 for padding/margin

  // Center the chart within the container
  const centerX = width / 2;
  const centerY = height / 2;

  const total = data.reduce((s, d) => s + (d.value || 0), 0);

  // Colors for Used (Red) and Remaining (Green)
  const colors = { Used: "#ef4444", Remaining: "#10b981" };

  if (total === 0) {
    const txt = document.createElementNS(svg.namespaceURI, "text");
    txt.setAttribute("x", centerX);
    txt.setAttribute("y", centerY);
    txt.setAttribute("text-anchor", "middle");
    txt.setAttribute("fill", "#6b7280");
    txt.textContent = "No data recorded";
    svg.appendChild(txt);
    return;
  }

  let startAngle = 0;

  // Append a group element to hold the pie slices for easier positioning
  const g = document.createElementNS(svg.namespaceURI, "g");
  g.setAttribute("transform", `translate(${centerX}, ${centerY})`);

  data.forEach((d) => {
    const angle = (d.value / total) * 2 * Math.PI;

    const x1 = radius * Math.cos(startAngle);
    const y1 = radius * Math.sin(startAngle);

    const endAngle = startAngle + angle;
    const x2 = radius * Math.cos(endAngle);
    const y2 = radius * Math.sin(endAngle);

    const largeArc = angle > Math.PI ? 1 : 0;
    const pathData = [
      "M 0 0", // Start at center
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");

    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", colors[d.name] || "#ccc");
    path.setAttribute("class", `pie-slice pie-${d.name.toLowerCase()}`);
    g.appendChild(path);

    startAngle = endAngle;
  });

  svg.appendChild(g);
}

export async function renderTransactionsPage() {
  // Helper Functions for Readability
  const formatDate = (dateStr) =>
    dateStr ? new Date(dateStr).toLocaleString() : "-";
  const getLookupLabel = (id, cache) => (id && cache[id]?.name) || "-";
  const formatAmount = (amount) => `${Number(amount || 0).toFixed(2)} L`;

  // --- 1. UI Initialization & Report Structure ---
  mainContent.innerHTML = "";
  setBackNavigation(true);

  // Use enhanced classes for a 'dashboard card' look
  const card = el("div", { class: "card report-card shadow-lg p-5" });
  card.append(
    el(
      "h2",
      { class: "report-title mb-4 border-bottom pb-2" },
      "⛽ Transactions Log"
    )
  );

  // Export Tools Row (Flex container for alignment)
  const toolsRow = el("div", {
    class: "row mt tools-row d-flex justify-content-end mb-4",
  });

  // Use distinct button styles for report functionality
  const pdfBtn = el(
    "button",
    { class: "primary export-btn btn-pdf mx-2" },
    "⬇️ Export PDF"
  );
  const excelBtn = el(
    "button",
    { class: "primary export-btn btn-excel mx-2" },
    "⬇️ Export Excel"
  );
  const csvBtn = el(
    "button",
    { class: "primary export-btn btn-csv mx-2" },
    "⬇️ Export CSV"
  );

  toolsRow.append(pdfBtn, excelBtn, csvBtn);
  card.append(toolsRow);

  // Table Structure (with enhanced classes for stripe/hover effects)
  const table = el("table", {
    class: "table mt table-striped table-hover report-table",
  });
  table.innerHTML = `
    <thead class="thead-dark">
      <tr>
        <th class="th-sortable">Date It Was Used</th>
        <th class="th-sortable">Recording Dated</th>
        <th>User</th>
        <th class="text-right th-amount">Amount (L)</th>
        <th>Comment</th>
        <th>Generator</th>
        <th>Plaza</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="7" class="text-center py-4">Loading transaction data...</td></tr>
    </tbody>
  `;
  card.append(table);
  mainContent.append(card);

  // --- 2. Data Fetching and Role-Based Filtering ---

  let q = supabase
    .from("fuel_transactions")
    .select("*")
    .order("created_at", { ascending: false });

  // Apply role-based filters
  if (profile.role === "user") q = q.eq("user_id", profile.user_id);
  if (profile.role === "manager" && profile.plaza_id) {
    q = q.eq("plaza_id", profile.plaza_id);
  }

  const { data: txs = [], error } = await q;

  if (error) {
    console.error("transactions load error", error);
    toast("Failed to load transactions", "error");
    table.querySelector(
      "tbody"
    ).innerHTML = `<tr><td colspan="7" class="text-center text-danger">⚠️ Error loading data.</td></tr>`;
    return;
  }

  // Ensure reference caches are ready
  await ensureCachesLoaded();

  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";
  const rowsForExport = [];

  // --- 3. Loop, Render, and Prepare Export Data ---

  (txs || []).forEach((r) => {
    // Generate Display Labels
    const userLabel =
      profilesByUserId[r.user_id]?.full_name ||
      profilesByUserId[r.user_id]?.email ||
      r.user_id ||
      "-";
    const genLabel = getLookupLabel(r.generator_id, generatorsById);
    const plazaLabel = getLookupLabel(r.plaza_id, plazasById);

    // Create Table Row (tr)
    const tr = el("tr", {}, [
      el("td", { class: "td-date" }, formatDate(r.transaction_date)),
      el("td", { class: "td-date" }, formatDate(r.created_at)),
      el("td", {}, userLabel),
      el("td", { class: "text-right td-amount" }, formatAmount(r.fuel_amount)),
      el("td", {}, r.notes || ""),
      el("td", {}, genLabel),
      el("td", {}, plazaLabel),
    ]);
    tbody.appendChild(tr);

    // Populate Export Data Array
    rowsForExport.push({
      "Date It Was Used": formatDate(r.transaction_date),
      "Recording Dated": formatDate(r.created_at),
      User: userLabel,
      "Amount (L)": Number(r.fuel_amount || 0),
      Comment: r.notes || "",
      Generator: genLabel,
      Plaza: plazaLabel,
    });
  });

  // --- 4. Export Button Configuration ---

  const exportHeaders = [
    "Date It Was Used",
    "Recording Dated",
    "User",
    "Amount (L)",
    "Comment",
    "Generator",
    "Plaza",
  ];

  if (profile.role === "user") {
    // Hide export buttons for standard users
    pdfBtn.style.display =
      excelBtn.style.display =
      csvBtn.style.display =
        "none";
  } else {
    // Attach export handlers for Manager/Admin roles
    pdfBtn.onclick = () =>
      exportToPDF("Transactions Report", rowsForExport, exportHeaders);
    excelBtn.onclick = () =>
      exportToExcel(
        "transactions.xlsx",
        "Transactions",
        rowsForExport,
        exportHeaders
      );
    csvBtn.onclick = () =>
      exportToCSV("transactions.csv", rowsForExport, exportHeaders);
  }
}

export async function renderUsersPage() {
  // --- 1. UI Initialization & Report Structure ---
  mainContent.innerHTML = "";
  setBackNavigation(true);

  // Main Card Container (Consistent with Transaction Page)
  const card = el("div", { class: "card report-card shadow-lg p-5" });

  // Dynamic Title based on role
  const pageTitle =
    profile.role === "admin" ? "👤 User Management Dashboard" : "👥 Users List";
  card.append(
    el("h2", { class: "report-title mb-4 border-bottom pb-2" }, pageTitle)
  );

  // Export Tools Row (Consistent with Transaction Page)
  const toolsRow = el("div", {
    class: "row mt tools-row d-flex justify-content-end mb-4",
  });

  // Use distinct button styles for report functionality
  const pdfBtn = el(
    "button",
    { class: "primary export-btn btn-pdf mx-2" },
    "⬇️ Export Users PDF"
  );
  const excelBtn = el(
    "button",
    { class: "primary export-btn btn-excel mx-2" },
    "⬇️ Export Users Excel"
  );
  const csvBtn = el(
    "button",
    { class: "primary export-btn btn-csv mx-2" },
    "⬇️ Export CSV"
  );

  toolsRow.append(pdfBtn, excelBtn, csvBtn);
  card.append(toolsRow);
  mainContent.append(card); // Append the card early to show structure while loading

  // --- 2. Data Fetching ---

  const { data: profilesList = [], error } = await supabase
    .from("profiles")
    .select("user_id,full_name,email,role,plaza_id")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("users load error", error);
    toast("Failed to load users", "error");
    return;
  }

  // --- 3. Role-Based Filtering Logic ---

  const rows = (profilesList || []).filter((p) => {
    // Managers cannot see Admins
    if (profile.role === "manager" && p.role === "admin") return false;
    // Managers should not see themselves (original logic constraint)
    if (profile.role === "manager" && p.user_id === profile.user_id)
      return false;
    // Managers only see users from their plaza
    if (profile.role === "manager" && profile.plaza_id) {
      return p.plaza_id === profile.plaza_id;
    }
    // Admins and others see everyone (or based on initial query)
    return true;
  });

  // --- 4. Table Structure and Rendering Setup ---

  const table = el("table", {
    class: "table mt table-striped table-hover report-table",
  });
  table.innerHTML = `
    <thead class="thead-dark">
      <tr>
        <th class="th-sortable">Name</th>
        <th class="th-sortable">Email</th>
        <th>Role</th>
        <th>Plaza</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="5" class="text-center py-4">Processing user data...</td></tr>
    </tbody>
  `;
  card.append(table);
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  await ensureCachesLoaded(); // Ensure plaza names are available
  const rowsForExport = [];

  // --- 5. Loop and Populate Table/Export Array ---

  for (const p of rows) {
    // NOTE: The original code queried fuel_transactions for *every user*
    // but discarded the data (userTxs). This is kept for 100% functionality match.
    const { data: userTxs = [] } = await supabase
      .from("fuel_transactions")
      .select("fuel_amount")
      .eq("user_id", p.user_id);

    const plazaName = plazasById[p.plaza_id]?.name || "-";

    // Prepare Data for Export
    rowsForExport.push({
      Name: p.full_name || "",
      Email: p.email || "",
      Role: p.role || "",
      Plaza: plazaName,
    });

    // Create Action Button (View)
    const actionCellContent = (() => {
      const viewBtn = el(
        "button",
        { class: "ghost action-btn btn-view" },
        "View Details"
      );
      viewBtn.onclick = () => renderUserDetail(p);
      return viewBtn;
    })();

    // Create Table Row (tr)
    const tr = el("tr", {}, [
      el("td", { class: "td-name" }, p.full_name || p.email),
      el("td", {}, p.email),
      el("td", { class: `td-role role-${p.role}` }, p.role), // Role-specific styling
      el("td", {}, plazaName),
      el("td", { class: "td-actions" }, actionCellContent),
    ]);
    tbody.appendChild(tr);
  }

  // --- 6. Export Button Configuration ---

  const exportHeaders = ["Name", "Email", "Role", "Plaza"];

  if (profile.role === "user") {
    // Hide export buttons for the standard user role
    pdfBtn.style.display =
      excelBtn.style.display =
      csvBtn.style.display =
        "none";
  } else {
    // Attach export handlers
    pdfBtn.onclick = () =>
      exportToPDF("Users Report", rowsForExport, exportHeaders);
    excelBtn.onclick = () =>
      exportToExcel("users.xlsx", "Users", rowsForExport, exportHeaders);
    csvBtn.onclick = () =>
      exportToCSV("users.csv", rowsForExport, exportHeaders);
  }
}

export async function renderUserDetail(profileRow) {
  // --- 1. UI Initialization & Structure Setup ---
  mainContent.innerHTML = "";
  setBackNavigation(true);

  // Consistent Report Card Container
  const card = el("div", { class: "card report-card shadow-lg p-5" });

  const title = `Details: ${profileRow.full_name || profileRow.email}`;
  card.append(
    el("h2", { class: "report-title mb-4 border-bottom pb-2" }, `🧑‍💻 ${title}`)
  );

  // --- 2. Data Fetching ---

  // Fetch all plaza transactions (for processUserTransactions logic)
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
      el(
        "p",
        { class: "error text-danger font-weight-bold mt-4" },
        "⚠️ Failed to load transaction details."
      )
    );
    mainContent.append(card);
    return;
  }

  // --- 3. Summary Metrics Calculation ---

  const totalAdded = txs
    .filter((t) => t.fuel_amount > 0)
    .reduce((s, t) => s + Number(t.fuel_amount), 0);

  const totalUsed = Math.abs(
    txs
      .filter((t) => t.fuel_amount < 0)
      .reduce((s, t) => s + Number(t.fuel_amount), 0)
  );

  const lastActivity = txs.length ? txs[0].transaction_date : null;

  // Format Helpers (assuming `fmt` exists and formats numbers)
  const formatAmount = (amount) => fmt(amount) + " L";
  const formatDate = (date) => (date ? new Date(date).toLocaleString() : "-");

  // Summary Metrics Display Block
  const summaryBlock = el("div", {
    class: "summary-block mb-5 p-3 rounded-lg border",
  });

  summaryBlock.append(
    el(
      "p",
      { class: "summary-item" },
      `➕ Total Fuel Added: ${formatAmount(totalAdded)}`
    )
  );
  summaryBlock.append(
    el(
      "p",
      { class: "summary-item" },
      `➖ Total Fuel Used: ${formatAmount(totalUsed)}`
    )
  );
  summaryBlock.append(
    el(
      "p",
      { class: "summary-item" },
      `🗓️ Last Activity: ${formatDate(lastActivity)}`
    )
  );

  card.append(summaryBlock);

  // --- 4. Export Tools ---

  const toolsRow = el("div", {
    class: "row mt tools-row d-flex justify-content-end mb-4",
  });
  const pdfBtn = el(
    "button",
    { class: "primary export-btn btn-pdf mx-2" },
    "⬇️ Export Detail PDF"
  );
  const excelBtn = el(
    "button",
    { class: "primary export-btn btn-excel mx-2" },
    "⬇️ Export Detail Excel"
  );
  const csvBtn = el(
    "button",
    { class: "primary export-btn btn-csv mx-2" },
    "⬇️ Export CSV"
  );

  toolsRow.append(pdfBtn, excelBtn, csvBtn);
  card.append(toolsRow);

  // --- 5. Transaction Data Processing & Table Setup ---

  // Process transactions (Functionality preserved)
  const detailRows = processUserTransactions(txs, allPlazaTxs);

  // Render table with enhanced headers
  const hoursTable = el("table", {
    class: "table mt table-striped table-hover report-table",
  });
  hoursTable.innerHTML = `
    <thead class="thead-dark">
      <tr>
        <th class="th-sortable">Refuel Date</th>
        <th class="th-sortable">Record Date</th>
        <th>Type</th>
        <th>Generator</th>
        <th class="text-right th-amount">Fuel Added (L)</th>
        <th class="text-right th-amount">Fuel Used (L)</th>
        <th class="text-right">Odometer (hrs)</th>
        <th class="text-right">Odo Diff (hrs)</th>
        <th class="text-right">HPL</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="9" class="text-center py-4">Generating details table...</td></tr>
    </tbody>
  `;
  const tbody = hoursTable.querySelector("tbody");
  tbody.innerHTML = ""; // Clear loading message

  // --- 6. Table Population ---

  detailRows.forEach((r) => {
    const isFuelOut = r["Fuel Used (L)"] > 0;

    tbody.appendChild(
      el("tr", { class: isFuelOut ? "fuel-use-row" : "fuel-add-row" }, [
        el("td", {}, r["Refuel Date"]),
        el("td", {}, r["Record Date"]),
        el("td", {}, r["Type"]),
        el("td", {}, r["Generator"]),
        el(
          "td",
          { class: "text-right td-added" },
          r["Fuel Added (L)"] === 0 ? "-" : fmt(r["Fuel Added (L)"])
        ),
        el(
          "td",
          { class: "text-right td-used" },
          r["Fuel Used (L)"] === 0 ? "-" : fmt(r["Fuel Used (L)"])
        ),
        el("td", { class: "text-right" }, r["Odometer(hrs)"] || "-"),
        el("td", { class: "text-right" }, r["Diff since prev (hours)"] || "-"),
        el("td", { class: "text-right td-hpl" }, r["HoursPerLiter"] || "-"),
      ])
    );
  });

  // Original logic appended tbody to hoursTable, though not strictly necessary
  hoursTable.appendChild(tbody);
  card.append(hoursTable);
  mainContent.append(card);

  // --- 7. Export Button Configuration ---

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

export async function renderMultiUserDetail() {
  // --- 1. UI Initialization & User Fetching ---
  mainContent.innerHTML = "";
  setBackNavigation(true);

  // Consistent Report Card Container for Selection
  const card = el("div", { class: "card report-card shadow-lg p-5 mb-4" });
  card.append(
    el(
      "h2",
      { class: "report-title mb-4 border-bottom pb-2" },
      "👥 Multi-User Detail Report (Shared Assets)"
    )
  );

  // Fetch users based on role
  let usersQuery = supabase
    .from("profiles")
    .select("user_id, full_name, email, plaza_id, role")
    .eq("role", "user")
    .order("email", { ascending: true });

  if (profile.role === "manager" && profile.plaza_id) {
    usersQuery = usersQuery.eq("plaza_id", profile.plaza_id);
  }

  const { data: users = [], error } = await usersQuery;
  if (error) {
    console.error("User load failed:", error);
    mainContent.append(
      el(
        "p",
        { class: "error text-danger font-weight-bold" },
        "⚠️ Failed to load users for selection."
      )
    );
    return;
  }

  // --- 2. User Selection UI ---

  if (!users.length) {
    card.append(
      el(
        "p",
        { class: "text-muted p-3" },
        "No fuel users found in the system or your assigned plaza."
      )
    );
    mainContent.append(card);
    return;
  }

  const userList = el("div", { class: "user-checkboxes mt-3 checkbox-grid" });

  await ensureCachesLoaded(); // Ensure plaza names are available

  users.forEach((u) => {
    const plazaName =
      u.plaza_id && plazasById[u.plaza_id]
        ? plazasById[u.plaza_id].name
        : "No Plaza";

    const labelText = `${u.full_name || u.email} (${plazaName})`;

    // Checkbox element
    const checkbox = el("input", {
      type: "checkbox",
      name: "user-select",
      value: u.user_id,
      id: `user-${u.user_id}`,
      class: "form-check-input",
    });

    // Label element
    const label = el(
      "label",
      { for: `user-${u.user_id}`, class: "form-check-label user-label" },
      [checkbox, ` ${labelText}`]
    );

    userList.append(el("div", { class: "checkbox-item form-check" }, [label]));
  });

  const loadBtn = el(
    "button",
    { class: "primary mt-4 btn-load-report" },
    "📈 Load Selected Details"
  );

  // Wrap selection components for structural clarity
  const selectionBlock = el(
    "div",
    { class: "selection-block p-4 border rounded" },
    [
      el(
        "label",
        { class: "font-weight-bold mb-3 d-block" },
        "Select users to include in the combined report:"
      ),
      userList,
      loadBtn,
    ]
  );

  card.append(selectionBlock);
  mainContent.append(card);

  // Container for results, placed outside the selection card
  const resultContainer = el("div", { class: "mt-4 result-container" });
  mainContent.append(resultContainer);

  /************* LOAD & RENDER LOGIC *************/
  loadBtn.onclick = async () => {
    const selected = Array.from(userList.querySelectorAll("input:checked")).map(
      (x) => x.value
    );
    if (!selected.length) {
      toast("Please select at least one user", "error");
      return;
    }

    resultContainer.innerHTML = `<p class="loading-message text-center py-5">
      <span class="spinner-border spinner-border-sm mr-2"></span> Loading transactions for ${selected.length} users...
    </p>`;

    // --- Fetch all TXs for selected users ---
    const { data: allTxs = [], error: txErr } = await supabase
      .from("fuel_transactions")
      .select("*")
      .in("user_id", selected)
      .order("transaction_date", { ascending: true });

    if (txErr) {
      console.error("Tx load fail:", txErr);
      resultContainer.innerHTML = `<p class="error text-danger text-center py-5">⚠️ Failed to load transactions.</p>`;
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

    // --- Render individual user reports ---
    for (const uid of selected) {
      const u = users.find((x) => x.user_id === uid);
      const userTxs = txByUser[uid] || [];
      const name = u?.full_name || u?.email || "Unknown User";

      const section = el("div", {
        class: "card report-section mt-5 p-4 shadow-sm",
      });
      section.append(
        el(
          "h3",
          { class: "section-header border-bottom pb-2 mb-3" },
          `${name}: ${userTxs.length} Transactions`
        )
      );

      if (!userTxs.length) {
        section.append(
          el(
            "p",
            { class: "text-muted" },
            "No transactions recorded for this user."
          )
        );
        resultContainer.append(section);
        continue;
      }

      // 🔹 Process transactions (using ALL fetched TXs for shared generator context)
      const detailRows = processUserTransactions(userTxs, allTxs);
      const tbody = el("tbody");

      detailRows.forEach((r) => {
        const isFuelOut = r["Fuel Used (L)"] > 0;
        tbody.appendChild(
          el("tr", { class: isFuelOut ? "fuel-use-row" : "fuel-add-row" }, [
            // Reusing classes
            el("td", {}, r["Refuel Date"]),
            el("td", {}, r["Record Date"]),
            el("td", {}, r["Type"]),
            el("td", {}, r["Generator"]),
            el("td", {}, r["Plaza"]),
            el(
              "td",
              { class: "text-right td-added" },
              r["Fuel Added (L)"] || "-"
            ),
            el(
              "td",
              { class: "text-right td-used" },
              r["Fuel Used (L)"] || "-"
            ),
            el("td", { class: "text-right" }, r["Odometer(hrs)"] || "-"),
            el(
              "td",
              { class: "text-right" },
              r["Diff since prev (hours)"] || "-"
            ),
            el("td", { class: "text-right td-hpl" }, r["HoursPerLiter"] || "-"),
          ])
        );
      });

      const table = el("table", {
        class: "table mt-3 table-striped table-hover report-table",
      });
      table.innerHTML = `
        <thead class="thead-dark">
          <tr>
            <th>Refuel Date</th><th>Record Date</th><th>Type</th><th>Generator</th><th>Plaza</th>
            <th class="text-right th-amount">Added (L)</th><th class="text-right th-amount">Used (L)</th>
            <th class="text-right">Odo (hrs)</th><th class="text-right">Diff (hrs)</th><th class="text-right">HPL</th>
          </tr>
        </thead>
      `;
      table.append(tbody);
      section.append(table);
      resultContainer.append(section);

      // Push export data
      detailRows.forEach((r) => allExportRows.push({ User: name, ...r }));
    }

    // --- Combined Export Tools ---
    if (allExportRows.length) {
      const tools = el("div", {
        class:
          "row mt-5 p-3 d-flex justify-content-center border-top report-summary-tools",
      });

      const excelBtn = el(
        "button",
        { class: "primary export-btn btn-excel mx-2" },
        "⬇️ Export Combined Excel"
      );
      const csvBtn = el(
        "button",
        { class: "primary export-btn btn-csv mx-2" },
        "⬇️ Export Combined CSV"
      );

      tools.append(excelBtn, csvBtn);
      // Prepend to resultContainer for visibility
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
