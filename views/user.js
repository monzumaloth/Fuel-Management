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
