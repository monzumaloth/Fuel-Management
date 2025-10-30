// views/admin.js
import {
  supabase,
  el,
  toast,
  ensureCachesLoaded,
  plazasById,
  setBackNavigation,
  mainContent, // ✅ import added
} from "../app.js";

export async function renderPlazasManagement() {
  setBackNavigation(true);
  mainContent.innerHTML = ""; // ✅ Clear previous content

  const container = el("div", { class: "card" });
  container.append(el("h2", {}, "Plazas"));
  mainContent.append(container);

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
    .select("*")
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
  mainContent.innerHTML = ""; // ✅ Clear previous content

  const container = el("div", { class: "card" });
  container.append(el("h2", {}, "Generators"));
  mainContent.append(container);

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
    .select("*")
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
