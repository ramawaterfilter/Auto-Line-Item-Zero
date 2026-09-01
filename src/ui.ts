export function landingPage(): string {
  return document("Install Auto Remove Line Item", `
    <main class="card install">
      <p class="eyebrow">Shopify order operations</p>
      <h1>Auto Remove Line Item</h1>
      <p>Safely zero configured variants in historical orders with BEFORE and AFTER audit records.</p>
      <form action="/auth" method="get">
        <label for="shop">Shop domain</label>
        <div class="row"><input id="shop" name="shop" placeholder="example.myshopify.com" required pattern="[a-zA-Z0-9-]+\.myshopify\.com"><button>Install / open</button></div>
      </form>
    </main>`);
}

export function appPage(): string {
  return document("Auto Remove Line Item", `
    <main class="shell">
      <header><div><p class="eyebrow">Order operations</p><h1>Remove target variants</h1></div><div id="shop" class="pill">Loading…</div></header>
      <section class="card">
        <div class="warning"><strong>Destructive operation</strong><span>Matching line items will be set to quantity 0. A BEFORE audit must succeed first.</span></div>
        <div class="form-grid">
          <label>Start date<input type="date" id="start" required></label>
          <label>End date<input type="date" id="end" required></label>
        </div>
        <p class="muted">Dates are inclusive in <strong id="timezone">the shop timezone</strong>.</p>
        <div><span class="muted">Target variants</span><div id="targets" class="targets"></div></div>
        <button id="process">Preview eligible orders</button>
      </section>
      <section class="card" id="selection-card" hidden>
        <div class="status-row"><div><p class="eyebrow">Eligible orders</p><h2>Choose orders to process</h2></div><strong id="selected-count">0 selected</strong></div>
        <label class="select-all"><input type="checkbox" id="select-all"> Select all eligible orders</label>
        <div id="order-list" class="order-list"></div>
        <div class="actions"><span class="muted">Both target variants will be set to 0 when both exist in a selected order.</span><button id="execute" disabled>Execute selected orders</button></div>
      </section>
      <section class="card" id="progress-card" hidden>
        <div class="status-row"><div><p class="eyebrow">Current job</p><h2 id="status">Pending</h2></div><span id="percent">0%</span></div>
        <div class="bar"><span id="bar"></span></div>
        <div class="metrics">
          <div><strong id="total">0</strong><span>Orders found</span></div><div><strong id="processed">0</strong><span>Processed</span></div>
          <div><strong id="success">0</strong><span>Successful</span></div><div><strong id="skipped">0</strong><span>Skipped</span></div>
          <div><strong id="failed">0</strong><span>Failed</span></div><div><strong id="remaining">0</strong><span>Remaining</span></div>
        </div>
        <div class="details"><span>ETA: <strong id="eta">Calculating…</strong></span><span>Last order: <strong id="last-order">—</strong></span></div>
        <div id="errors" class="errors"></div>
        <div class="actions"><button id="retry" class="secondary" hidden>Retry failed orders</button><button id="cancel" class="danger">Cancel</button></div>
      </section>
    </main>`, `<script type="module">${clientScript()}</script>`);
}

function clientScript(): string {
  return `
const $ = (id) => document.getElementById(id);
let jobId = localStorage.getItem("currentJobId");
let timer;
let ordersLoaded = false;
const api = async (url, options) => {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
};
const formatEta = (seconds) => seconds == null ? "Calculating…" : seconds < 60 ? seconds + " seconds" : "~" + Math.ceil(seconds / 60) + " minutes";
async function loadSession() {
  const session = await api("/api/session");
  $("shop").textContent = session.shop;
  $("timezone").textContent = session.timezone;
  session.targetVariants.forEach((id) => { const span = document.createElement("span"); span.textContent = id; $("targets").append(span); });
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  $("end").value = today; $("start").value = week;
  if (jobId) poll();
}
$("process").onclick = async () => {
  const startDate = $("start").value, endDate = $("end").value;
  try {
    $("process").disabled = true;
    const job = await api("/api/jobs", { method: "POST", body: JSON.stringify({ startDate, endDate }) });
    jobId = job.jobId; ordersLoaded = false; $("selection-card").hidden = true; localStorage.setItem("currentJobId", jobId); poll();
  } catch (error) { alert(error.message); $("process").disabled = false; }
};
async function poll() {
  clearTimeout(timer); $("progress-card").hidden = false;
  try {
    const job = await api("/api/jobs/" + encodeURIComponent(jobId));
    $("status").textContent = job.status; $("percent").textContent = job.progressPercent.toFixed(1) + "%";
    $("bar").style.width = job.progressPercent + "%";
    for (const [id, key] of [["total","totalOrders"],["processed","processedOrders"],["success","successCount"],["skipped","skippedCount"],["failed","failedCount"],["remaining","remaining"]]) $(id).textContent = job[key].toLocaleString();
    $("eta").textContent = formatEta(job.etaSeconds); $("last-order").textContent = job.lastOrder || "—";
    $("retry").hidden = !job.failedCount; $("cancel").hidden = !["PENDING","DISCOVERING","PROCESSING"].includes(job.status);
    if (job.selectionReady && job.status === "PENDING") { $("status").textContent = "Ready for selection"; if (!ordersLoaded) loadOrders().catch((error) => { ordersLoaded=false; $("errors").textContent=error.message; }); }
    else if (["PENDING","DISCOVERING","PROCESSING","CANCELLING"].includes(job.status)) timer = setTimeout(poll, 2000);
    else $("process").disabled = false;
    if (job.failedCount) loadErrors();
  } catch (error) { $("errors").textContent = error.message; timer = setTimeout(poll, 5000); }
}
async function loadOrders() {
  ordersLoaded = true;
  const data = await api("/api/jobs/" + encodeURIComponent(jobId) + "/orders");
  $("selection-card").hidden = false;
  $("order-list").replaceChildren(...data.orders.map((order) => {
    const label = document.createElement("label"); label.className = "order-choice";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = order.id; checkbox.className = "order-checkbox"; checkbox.onchange = updateSelection;
    const details = document.createElement("span");
    const variants = order.lines.map((line) => line.productTitle + " / " + line.variantTitle + " (qty " + line.quantityBefore + ")").join("; ");
    details.textContent = order.orderName + " · " + (order.createdAt || "") + " · " + variants;
    label.append(checkbox, details); return label;
  }));
  $("select-all").checked = false; updateSelection(); $("process").disabled = false;
}
function updateSelection() {
  const boxes = [...document.querySelectorAll(".order-checkbox")], selected = boxes.filter((box) => box.checked);
  $("selected-count").textContent = selected.length + " selected"; $("execute").disabled = !selected.length;
  $("select-all").checked = boxes.length > 0 && selected.length === boxes.length;
  $("select-all").indeterminate = selected.length > 0 && selected.length < boxes.length;
}
$("select-all").onchange = () => { document.querySelectorAll(".order-checkbox").forEach((box) => box.checked = $("select-all").checked); updateSelection(); };
$("execute").onclick = async () => {
  const orderIds = [...document.querySelectorAll(".order-checkbox:checked")].map((box) => box.value);
  if (!orderIds.length || !confirm("Set matching target variant quantities to 0 in " + orderIds.length + " selected order(s)?")) return;
  try { $("execute").disabled = true; await api("/api/jobs/"+encodeURIComponent(jobId)+"/process", {method:"POST",body:JSON.stringify({orderIds})}); $("selection-card").hidden = true; poll(); }
  catch (error) { alert(error.message); $("execute").disabled = false; }
};
async function loadErrors() {
  const data = await api("/api/jobs/" + encodeURIComponent(jobId) + "/errors");
  $("errors").replaceChildren(...data.errors.map((item) => { const p=document.createElement("p"); p.textContent=item.orderName+": "+item.message; return p; }));
}
$("retry").onclick = async () => { await api("/api/jobs/"+encodeURIComponent(jobId)+"/retry-failed", {method:"POST",body:"{}"}); poll(); };
$("cancel").onclick = async () => { if (confirm("Stop queueing new work? Any Shopify mutation already in progress will finish safely.")) { await api("/api/jobs/"+encodeURIComponent(jobId)+"/cancel", {method:"POST",body:"{}"}); poll(); } };
loadSession().catch((error) => { document.body.textContent = error.message; });`;
}

function document(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17211b;background:#f4f7f5;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{border:0;border-radius:10px;background:#146c43;color:white;font-weight:700;padding:.8rem 1.1rem;cursor:pointer}button:disabled{opacity:.5}.shell{max-width:980px;margin:0 auto;padding:42px 20px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}h1{font-size:clamp(1.8rem,5vw,2.8rem);margin:.15rem 0}h2{margin:.2rem 0}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:800;color:#547062;margin:0}.pill,.targets span{background:#e2eee7;border-radius:999px;padding:.5rem .8rem;font-size:.85rem}.card{background:white;border:1px solid #dce6df;border-radius:18px;padding:24px;box-shadow:0 12px 35px #183d2820;margin-bottom:20px}.install{max-width:680px;margin:12vh auto}.row{display:flex;gap:10px}.row input{flex:1}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:22px 0}label{display:grid;gap:7px;font-size:.85rem;font-weight:700}input{border:1px solid #b9c9bf;border-radius:10px;padding:.8rem;background:#fff}.warning{display:flex;gap:10px;padding:14px;border-radius:10px;background:#fff4d6;color:#6f4e00}.warning span{font-size:.9rem}.muted{color:#63736a}.targets{display:flex;gap:8px;margin:8px 0 24px}.status-row,.details,.actions{display:flex;justify-content:space-between;align-items:center}.status-row>span{font-size:1.6rem;font-weight:800}.bar{height:10px;background:#e6ece8;border-radius:10px;overflow:hidden;margin:20px 0}.bar span{display:block;height:100%;background:#20a464;transition:width .3s}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metrics div{display:grid;background:#f5f8f6;padding:14px;border-radius:10px}.metrics strong{font-size:1.35rem}.metrics span,.details{font-size:.8rem;color:#63736a}.details{margin:20px 0}.errors{color:#9b2c2c;font-size:.85rem}.secondary{background:#e2eee7;color:#146c43}.danger{background:#a93434}.select-all{display:flex;align-items:center;gap:8px;margin:18px 0}.select-all input,.order-choice input{width:18px;height:18px}.order-list{display:grid;gap:8px;max-height:430px;overflow:auto;margin-bottom:18px}.order-choice{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;border:1px solid #dce6df;border-radius:10px;padding:12px;font-weight:500}.order-choice:hover{background:#f5f8f6}@media(max-width:600px){header,.row,.warning,.details,.actions{align-items:stretch;flex-direction:column}.form-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}}
  </style></head><body>${body}${script}</body></html>`;
}
