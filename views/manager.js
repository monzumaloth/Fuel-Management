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
import { fetchPlazaMetrics as _fetchPlazaMetrics } from "./admin.js"; // small helper exists in admin module
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
    const ratio = stats.added > 0 ? (stats.used / stats.added) * 100 : 0;
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

/* small inline gauge builder reused */
function buildFuelGauge(net, added) {
  const percentage =
    added > 0 ? Math.max(0, Math.min(100, (net / added) * 100)) : 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "120");
  svg.setAttribute("viewBox", "0 0 120 120");
  const radius = 44;
  const stroke = 12;
  const circumference = 2 * Math.PI * radius;
  const filled = (percentage / 100) * circumference;
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
