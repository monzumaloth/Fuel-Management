// charts.js - small chart helpers exported
export function buildFuelGauge(net, added) {
  const percentage =
    added > 0 ? Math.max(0, Math.min(100, (net / added) * 100)) : 0;
  const radius = 44;
  const stroke = 12;
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
  text.textContent = `${percentage.toFixed(0)}%`;
  svg.appendChild(text);
  return svg;
}

export function renderMiniPieChart(containerId, data) {
  const svg = document.getElementById(containerId);
  if (!svg) return;
  svg.innerHTML = "";
  const width = svg.clientWidth || 200,
    height = svg.clientHeight || 200;
  const radius = Math.min(width, height) / 2;
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (total === 0) {
    const t = document.createElementNS(svg.namespaceURI, "text");
    t.setAttribute("x", width / 2);
    t.setAttribute("y", height / 2);
    t.setAttribute("text-anchor", "middle");
    t.textContent = "No data";
    svg.appendChild(t);
    return;
  }
  let start = 0;
  const colors = ["#ef4444", "#10b981", "#0ea5e9"];
  data.forEach((d, i) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const x1 = width / 2 + radius * Math.cos(start);
    const y1 = height / 2 + radius * Math.sin(start);
    const x2 = width / 2 + radius * Math.cos(start + angle);
    const y2 = height / 2 + radius * Math.sin(start + angle);
    const large = angle > Math.PI ? 1 : 0;
    const pathData = [
      `M ${width / 2} ${height / 2}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", colors[i] || "#ccc");
    svg.appendChild(path);
    start += angle;
  });
}

export function donutPath(cx, cy, r, start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}
