import { clientScript } from "./ui-client";
import { styles } from "./ui-styles";

const icon = (name: string, path: string, className = "icon") =>
  `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-icon="${name}">${path}</svg>`;

const icons = {
  alert: icon(
    "alert",
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4M12 16h.01"/>',
  ),
  bag: icon(
    "bag",
    '<path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  ),
  calendar: icon(
    "calendar",
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  ),
  check: icon("check", '<path d="m5 12 4 4L19 6"/>'),
  clock: icon(
    "clock",
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ),
  close: icon("close", '<path d="m6 6 12 12M18 6 6 18"/>'),
  eye: icon(
    "eye",
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  ),
  globe: icon(
    "globe",
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  ),
  info: icon(
    "info",
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  ),
  logout: icon("logout", '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'),
  moon: icon(
    "moon",
    '<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>',
    "icon theme-moon",
  ),
  orders: icon("orders", '<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"/>'),
  play: icon("play", '<path d="m8 5 11 7-11 7V5Z"/>'),
  sun: icon(
    "sun",
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
    "icon theme-sun",
  ),
};

export function landingPage(): string {
  return document(
    "Install Auto Remove Line Item",
    `
    <button class="icon-button theme-button install-theme" type="button" data-theme-toggle aria-label="Switch theme">${icons.sun}${icons.moon}<span data-theme-label>Light mode</span></button>
    <main class="install-wrap">
      <section class="card install">
        <div class="brand-mark">${icons.bag}</div>
        <p class="eyebrow">Shopify order operations</p>
        <h1>Auto Remove Line Item</h1>
        <p class="lede">Safely zero configured variants in historical orders with BEFORE and AFTER audit records.</p>
        <form action="/auth" method="get">
          <label for="shop">Shop domain</label>
          <div class="field-action"><input id="shop" name="shop" placeholder="example.myshopify.com" required pattern="[a-zA-Z0-9-]+\.myshopify\.com"><button>Continue with Shopify</button></div>
        </form>
      </section>
    </main>`,
  );
}

export function appPage(
  options: { apiKey?: string; embedded?: boolean } = {},
): string {
  const home = options.embedded ? "" : "/app";
  const logout = options.embedded
    ? ""
    : `<form action="/logout" method="post"><button class="button ghost logout" type="submit">${icons.logout}<span>Log out</span></button></form>`;
  return document(
    "Order Operations",
    `
    <nav class="navbar">
      <div class="nav-inner">
        <a class="brand" href="${home}" aria-label="Order Operations home"><span class="brand-mark">${icons.bag}</span><span>Order Operations</span></a>
        <div class="nav-actions">
          <div class="user-meta"><strong id="staff-name"></strong><span id="staff-email"></span></div>
          <span id="shop" class="shop-badge">Loading...</span>
          <button class="icon-button theme-button" type="button" data-theme-toggle aria-label="Switch theme" title="Switch theme">${icons.sun}${icons.moon}<span data-theme-label>Light mode</span></button>
          ${logout}
        </div>
      </div>
    </nav>

    <main class="shell">
      <header class="page-header">
        <p class="eyebrow">Order operations</p>
        <p class="lede">Matching line items will be set to quantity 0. A <strong class="danger-text">BEFORE audit</strong> must succeed first.</p>
      </header>

      <div id="app-message" class="callout error-callout" role="alert" hidden>${icons.alert}<div><strong>Something went wrong</strong><span id="app-message-text"></span></div></div>

      <section class="card step-card" aria-labelledby="automation-title">
        <div class="section-heading"><div><p class="eyebrow">Store settings</p><h2 id="automation-title">Automatic processing</h2></div></div>
        <label class="select-all"><input type="checkbox" id="automation-enabled" role="switch" disabled><span>Automatically process new orders</span></label>
        <p class="helper">When enabled, new orders are processed as soon as Shopify notifies the app, even when it is closed. Matching target variants are set to quantity 0 with BEFORE and AFTER audit records.</p>
        <p class="helper">Only orders created after enabling are included. Turning this off skips waiting work; edits already started finish their audit records. Manual processing remains available below.</p>
        <p id="automation-status" role="status" aria-live="polite">Loading automation settings...</p>
        <details><summary>Recent automatic jobs</summary><div id="automation-jobs" class="order-list"></div></details>
      </section>

      <section class="card step-card" aria-labelledby="configure-title">
        <div class="section-heading"><span class="step-number">1</span><div><p class="eyebrow">Step one</p><h2 id="configure-title">Configure operation</h2></div></div>
        <div class="date-grid">
          <label for="start">Start date<span class="input-wrap">${icons.calendar}<input type="date" id="start" required></span></label>
          <label for="end">End date<span class="input-wrap">${icons.calendar}<input type="date" id="end" required></span></label>
        </div>
        <p class="helper">${icons.globe} Dates are inclusive in <strong id="timezone">the shop timezone</strong>.</p>
        <div class="field-group"><span class="field-label">Target variants</span><div id="targets" class="targets"></div></div>
        <div class="card-actions"><button id="process" class="button primary" type="button">${icons.eye}<span>Preview eligible orders</span></button></div>
      </section>

      <section class="card step-card" id="selection-card" aria-labelledby="selection-title">
        <div class="section-heading split"><div class="heading-group"><span class="step-number">2</span><div><p class="eyebrow">Step two</p><h2 id="selection-title">Choose orders to process</h2></div></div><strong id="selected-count" class="selection-count">0 selected</strong></div>
        <label class="select-all"><input type="checkbox" id="select-all" disabled><span>Select all eligible orders</span></label>
        <div id="order-empty" class="empty-state">${icons.eye}<strong id="order-empty-title">Preview eligible orders to begin</strong><span id="order-empty-text">Your eligible Shopify orders will appear here.</span></div>
        <div id="order-list" class="order-list" aria-live="polite" hidden></div>
        <div class="callout info-callout">${icons.info}<span>Both target variants will be set to 0 when both exist in a selected order.</span></div>
        <div class="card-actions"><button id="execute" class="button primary" type="button" disabled>${icons.play}<span>Execute selected orders</span></button></div>
      </section>

      <section class="card step-card" id="progress-card" aria-labelledby="job-title">
        <div class="section-heading"><span class="step-number">3</span><div><p class="eyebrow">Step three</p><h2 id="job-title">Current job</h2></div></div>
        <div class="progress-heading"><div><span id="status-dot" class="status-dot"></span><strong id="status">Ready for selection</strong></div><strong id="percent">0.0%</strong></div>
        <div class="bar" role="progressbar" aria-label="Job progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="bar"></span></div>
        <div class="metrics">
          ${metric("orders", "total", "Orders found", icons.orders)}
          ${metric("processed", "processed", "Processed", icons.clock)}
          ${metric("success", "success", "Successful", icons.check)}
          ${metric("skipped", "skipped", "Skipped", icons.play)}
          ${metric("failed", "failed", "Failed", icons.alert)}
          ${metric("remaining", "remaining", "Remaining", icons.clock)}
        </div>
        <div class="details"><span>ETA: <strong id="eta">Calculating...</strong></span><span>Last order: <strong id="last-order">—</strong></span></div>
        <div id="errors" class="job-errors" aria-live="polite"></div>
        <div class="job-actions"><button id="cancel" class="button danger" type="button" hidden>${icons.close}<span>Cancel operation</span></button><button id="retry" class="button ghost" type="button" hidden>Retry failed orders</button></div>
      </section>
    </main>
    <template id="order-icon">${icons.bag}</template>`,
    `<script type="module">${clientScript}</script>`,
    options.apiKey,
  );
}

function metric(tone: string, id: string, label: string, svg: string): string {
  return `<div class="metric ${tone}"><span class="metric-icon">${svg}</span><div><strong id="${id}">0</strong><span>${label}</span></div></div>`;
}

function document(
  title: string,
  body: string,
  script = "",
  apiKey?: string,
): string {
  const appBridge = apiKey
    ? `<meta name="shopify-api-key" content="${apiKey}"><script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>`
    : "";
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${appBridge}<script>document.documentElement.dataset.theme=localStorage.getItem("theme")==="light"?"light":"dark"</script><title>${title}</title><style>${styles}</style></head><body>${body}${script}<script>${themeToggleScript}</script></body></html>`;
}

const themeToggleScript = `
const syncThemeButtons=()=>document.querySelectorAll("[data-theme-toggle]").forEach(button=>{const next=document.documentElement.dataset.theme==="dark"?"light":"dark";button.setAttribute("aria-label","Switch to "+next+" mode");button.querySelector("[data-theme-label]").textContent=next[0].toUpperCase()+next.slice(1)+" mode"});
document.querySelectorAll("[data-theme-toggle]").forEach(button=>button.addEventListener("click",()=>{const theme=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme);syncThemeButtons()}));syncThemeButtons();`;
