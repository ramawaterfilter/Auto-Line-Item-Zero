export const clientScript = `
const $ = (id) => document.getElementById(id);
let jobId = localStorage.getItem("currentJobId"), timer, ordersLoaded = false;
const api = async (url, options) => {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
};
const formatEta = (seconds) => seconds == null ? "Calculating..." : seconds < 60 ? seconds + " seconds" : "~" + Math.ceil(seconds / 60) + " minutes";
const showError = (message) => { $("app-message-text").textContent = message; $("app-message").hidden = false; };
const clearError = () => { $("app-message").hidden = true; $("app-message-text").textContent = ""; };
const setButtonLoading = (button, loading, text) => {
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  button.querySelector("span").textContent = loading ? text : button.dataset.label;
};

async function loadSession() {
  const session = await api("/api/session");
  $("shop").textContent = session.shop;
  $("staff-name").textContent = session.staff.name;
  $("staff-email").textContent = session.staff.email;
  $("timezone").textContent = session.timezone;
  $("targets").replaceChildren(...session.targetVariants.map((id) => { const span = document.createElement("span"); span.textContent = id; return span; }));
  const today = new Date().toISOString().slice(0, 10);
  $("end").value = today;
  $("start").value = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  if (jobId) poll();
}

$("process").dataset.label = "Preview eligible orders";
$("execute").dataset.label = "Execute selected orders";
$("process").onclick = async () => {
  clearError();
  try {
    setButtonLoading($("process"), true, "Loading orders...");
    const job = await api("/api/jobs", { method: "POST", body: JSON.stringify({ startDate: $("start").value, endDate: $("end").value }) });
    jobId = job.jobId; ordersLoaded = false; resetSelection();
    localStorage.setItem("currentJobId", jobId);
    poll();
  } catch (error) { showError(error.message); setButtonLoading($("process"), false, ""); }
};

async function poll() {
  clearTimeout(timer);
  try {
    const job = await api("/api/jobs/" + encodeURIComponent(jobId));
    const active = ["PENDING", "DISCOVERING", "PROCESSING", "CANCELLING"].includes(job.status);
    $("status").textContent = job.selectionReady && job.status === "PENDING" ? "Ready for selection" : readableStatus(job.status);
    $("status-dot").className = "status-dot " + statusTone(job.status);
    $("percent").textContent = job.progressPercent.toFixed(1) + "%";
    $("bar").style.width = job.progressPercent + "%";
    $("bar").parentElement.setAttribute("aria-valuenow", String(job.progressPercent));
    $("bar").classList.toggle("active", job.status === "PROCESSING");
    for (const [id, key] of [["total","totalOrders"],["processed","processedOrders"],["success","successCount"],["skipped","skippedCount"],["failed","failedCount"],["remaining","remaining"]]) $(id).textContent = job[key].toLocaleString();
    $("eta").textContent = formatEta(job.etaSeconds); $("last-order").textContent = job.lastOrder || "—";
    $("retry").hidden = !job.failedCount;
    $("cancel").hidden = !["PENDING","DISCOVERING","PROCESSING"].includes(job.status);
    if (job.status === "FAILED") showError(job.errorMessage || "Order discovery failed. Please try again.");
    if (job.selectionReady && job.status === "PENDING") {
      if (!ordersLoaded) loadOrders().catch((error) => { ordersLoaded = false; showError(error.message); });
    } else if (active) timer = setTimeout(poll, 2000);
    else setButtonLoading($("process"), false, "");
    if (job.failedCount) loadErrors(); else $("errors").replaceChildren();
  } catch (error) { showError(error.message); timer = setTimeout(poll, 5000); }
}

const readableStatus = (status) => String(status).toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
function statusTone(status) {
  if (["COMPLETED", "SUCCEEDED"].includes(status)) return "success";
  if (status === "FAILED") return "failed";
  if (["PROCESSING", "DISCOVERING", "CANCELLING"].includes(status)) return "active";
  return "";
}

async function loadOrders() {
  ordersLoaded = true;
  const data = await api("/api/jobs/" + encodeURIComponent(jobId) + "/orders");
  const hasOrders = data.orders.length > 0;
  $("order-empty").hidden = hasOrders; $("order-list").hidden = !hasOrders; $("select-all").disabled = !hasOrders;
  if (!hasOrders) { $("order-empty-title").textContent = "No eligible orders found"; $("order-empty-text").textContent = "Try a different date range and preview again."; }
  $("order-list").replaceChildren(...data.orders.map(createOrderRow));
  $("select-all").checked = false; updateSelection(); setButtonLoading($("process"), false, "");
}

function createOrderRow(order) {
  const label = document.createElement("label"); label.className = "order-choice";
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = order.id; checkbox.className = "order-checkbox";
  checkbox.setAttribute("aria-label", "Select order " + order.orderName); checkbox.onchange = updateSelection;
  const icon = document.createElement("span"); icon.className = "order-icon"; icon.append($("order-icon").content.cloneNode(true));
  const content = document.createElement("span"); content.className = "order-content";
  const heading = document.createElement("span"); heading.className = "order-heading";
  const name = document.createElement("strong"); name.textContent = order.orderName;
  const date = document.createElement("span"); date.textContent = formatDate(order.createdAt); heading.append(name, date);
  const lines = document.createElement("span"); lines.className = "order-lines";
  lines.textContent = order.lines.map((line) => line.productTitle + " / " + line.variantTitle + " (qty " + line.quantityBefore + ")").join(" · ");
  content.append(heading, lines); label.append(checkbox, icon, content); return label;
}
function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function resetSelection() {
  $("order-list").replaceChildren(); $("order-list").hidden = true; $("order-empty").hidden = false;
  $("order-empty-title").textContent = "Preview eligible orders to begin"; $("order-empty-text").textContent = "Your eligible Shopify orders will appear here.";
  $("select-all").checked = false; $("select-all").disabled = true; updateSelection();
}
function updateSelection() {
  const boxes = [...document.querySelectorAll(".order-checkbox")], selected = boxes.filter((box) => box.checked);
  boxes.forEach((box) => box.closest(".order-choice").classList.toggle("selected", box.checked));
  $("selected-count").textContent = selected.length + " selected"; $("execute").disabled = !selected.length;
  $("select-all").checked = boxes.length > 0 && selected.length === boxes.length;
  $("select-all").indeterminate = selected.length > 0 && selected.length < boxes.length;
}
$("select-all").onchange = () => { document.querySelectorAll(".order-checkbox").forEach((box) => { box.checked = $("select-all").checked; }); updateSelection(); };

$("execute").onclick = async () => {
  const orderIds = [...document.querySelectorAll(".order-checkbox:checked")].map((box) => box.value);
  if (!orderIds.length || !confirm("Set matching target variant quantities to 0 in " + orderIds.length + " selected order(s)? A BEFORE audit must succeed first.")) return;
  clearError();
  try {
    setButtonLoading($("execute"), true, "Validating BEFORE audit...");
    await api("/api/jobs/" + encodeURIComponent(jobId) + "/process", { method: "POST", body: JSON.stringify({ orderIds }) });
    setButtonLoading($("execute"), false, ""); resetSelection(); poll();
  } catch (error) { showError(error.message); setButtonLoading($("execute"), false, ""); updateSelection(); }
};

async function loadErrors() {
  const data = await api("/api/jobs/" + encodeURIComponent(jobId) + "/errors");
  $("errors").replaceChildren(...data.errors.map((item) => {
    const row = document.createElement("div"), title = document.createElement("strong"), message = document.createElement("span");
    title.textContent = item.orderName; message.textContent = item.message; row.append(title, message); return row;
  }));
}
$("retry").onclick = async () => { clearError(); try { await api("/api/jobs/" + encodeURIComponent(jobId) + "/retry-failed", { method: "POST", body: "{}" }); poll(); } catch (error) { showError(error.message); } };
$("cancel").onclick = async () => { if (confirm("Stop queueing new work? Any Shopify mutation already in progress will finish safely.")) { clearError(); try { await api("/api/jobs/" + encodeURIComponent(jobId) + "/cancel", { method: "POST", body: "{}" }); poll(); } catch (error) { showError(error.message); } } };
loadSession().catch((error) => showError(error.message));`;
