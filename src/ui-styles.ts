export const styles = `
:root {
  color-scheme: dark;
  --bg: #0b0f0e; --nav: rgba(11,15,14,.84); --surface: #121918; --surface-2: #17201e;
  --surface-3: #0f1513; --border: #26332f; --border-strong: #34463f;
  --text: #f1f5f3; --muted: #93a39d; --subtle: #687972;
  --primary: #34d399; --primary-strong: #10b981; --primary-ink: #06271b;
  --danger: #fb7185; --danger-bg: rgba(244,63,94,.1); --danger-border: rgba(251,113,133,.28);
  --info: #60a5fa; --info-bg: rgba(59,130,246,.08); --info-border: rgba(96,165,250,.2);
  --shadow: 0 18px 50px rgba(0,0,0,.22); --ring: 0 0 0 3px rgba(52,211,153,.2);
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f5f8f6; --nav: rgba(245,248,246,.86); --surface: #fff; --surface-2: #f5faf7;
  --surface-3: #f9fbfa; --border: #dbe6df; --border-strong: #bfcfc5;
  --text: #14201a; --muted: #607068; --subtle: #7b8981;
  --primary: #059669; --primary-strong: #047857; --primary-ink: #fff;
  --danger: #dc3653; --danger-bg: #fff2f4; --danger-border: #f5c5ce;
  --info: #2563eb; --info-bg: #f1f6ff; --info-border: #cfddfa;
  --shadow: 0 16px 42px rgba(35,63,47,.08); --ring: 0 0 0 3px rgba(5,150,105,.17);
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; min-width: 320px; color: var(--text); background: var(--bg); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-synthesis: none; line-height: 1.5; }
button, input { font: inherit; }
button, a, input, label { -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
.icon { width: 1.1rem; height: 1.1rem; flex: 0 0 auto; }

.navbar { position: sticky; z-index: 20; top: 0; border-bottom: 1px solid var(--border); background: var(--nav); backdrop-filter: blur(16px); }
.nav-inner { width: min(1320px, 100%); min-height: 68px; margin: 0 auto; padding: 10px 28px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.brand { color: var(--text); display: flex; align-items: center; gap: 11px; font-size: .95rem; font-weight: 750; text-decoration: none; white-space: nowrap; }
.brand-mark { width: 34px; height: 34px; display: inline-grid; place-items: center; color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--primary) 10%, transparent); }
.nav-actions { display: flex; align-items: center; gap: 12px; min-width: 0; }
.nav-actions form { display: contents; }
.user-meta { display: grid; text-align: right; line-height: 1.25; }
.user-meta strong { font-size: .78rem; }
.user-meta span { max-width: 240px; color: var(--muted); font-size: .72rem; overflow: hidden; text-overflow: ellipsis; }
.shop-badge, .selection-count { padding: 6px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: var(--surface-2); font-size: .75rem; font-weight: 700; white-space: nowrap; }
.icon-button { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; color: var(--muted); border: 1px solid var(--border); border-radius: 10px; background: var(--surface); cursor: pointer; }
.theme-button { width: auto; padding: 0 11px; display: flex; gap: 7px; color: var(--text); font-size: .75rem; font-weight: 700; white-space: nowrap; }
.theme-moon, [data-theme="light"] .theme-sun { display: none; }
[data-theme="light"] .theme-moon { display: block; }

.shell { width: min(1160px, 100%); margin: 0 auto; padding: 62px 28px 90px; }
.page-header { margin-bottom: 34px; }
.eyebrow { margin: 0 0 5px; color: var(--primary); font-size: .68rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 9px; font-size: clamp(2rem, 4vw, 3.35rem); line-height: 1.08; letter-spacing: -.045em; }
h2 { margin: 0; font-size: 1.2rem; line-height: 1.25; letter-spacing: -.018em; }
.title-line { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.lede { max-width: 680px; margin-bottom: 0; color: var(--muted); font-size: .98rem; }
.danger-text { color: var(--danger); }
.card { margin-bottom: 22px; padding: 28px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow); }
.step-card { scroll-margin-top: 90px; }
.section-heading, .heading-group { display: flex; align-items: center; gap: 13px; }
.section-heading { margin-bottom: 25px; }
.section-heading.split { justify-content: space-between; }
.section-heading .eyebrow { margin-bottom: 2px; color: var(--subtle); font-size: .61rem; }
.step-number { width: 34px; height: 34px; display: grid; place-items: center; color: var(--primary-ink); border-radius: 50%; background: var(--primary); font-size: .82rem; font-weight: 850; box-shadow: 0 0 22px color-mix(in srgb, var(--primary) 20%, transparent); }

label, .field-label { color: var(--text); font-size: .78rem; font-weight: 720; }
.date-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.date-grid label { display: grid; gap: 8px; }
.input-wrap { min-height: 46px; padding: 0 13px; display: flex; align-items: center; gap: 9px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-3); transition: border-color .18s, box-shadow .18s; }
.input-wrap:focus-within { border-color: var(--primary); box-shadow: var(--ring); }
.input-wrap .icon { color: var(--muted); }
input[type="date"] { width: 100%; min-width: 0; padding: 12px 0; color: var(--text); border: 0; outline: 0; background: transparent; cursor: pointer; }
input[type="date"]::-webkit-calendar-picker-indicator { opacity: .65; cursor: pointer; }
.helper { margin: 10px 0 25px; display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: .75rem; }
.helper .icon { width: .95rem; }
.field-group { display: grid; gap: 9px; }
.targets { min-height: 33px; display: flex; flex-wrap: wrap; gap: 8px; }
.targets span { padding: 7px 11px; color: var(--text); border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .76rem; }

.button { min-height: 40px; padding: 9px 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; color: var(--text); border: 1px solid transparent; border-radius: 10px; background: transparent; font-size: .78rem; font-weight: 760; cursor: pointer; transition: transform .18s, border-color .18s, background .18s, opacity .18s; }
.button:hover:not(:disabled), .icon-button:hover { border-color: var(--border-strong); background: var(--surface-2); }
.button:active:not(:disabled) { transform: translateY(1px); }
.button:focus-visible, .icon-button:focus-visible, input:focus-visible, .order-choice:has(input:focus-visible) { outline: none; box-shadow: var(--ring); }
.button:disabled { opacity: .42; cursor: not-allowed; }
.button.primary { color: var(--primary-ink); background: var(--primary); }
.button.primary:hover:not(:disabled) { border-color: transparent; background: var(--primary-strong); }
.button.ghost { border-color: var(--border); background: var(--surface-2); }
.button.danger { color: white; border-color: var(--danger-border); background: #be2945; }
.button.loading .icon { animation: pulse 1s ease-in-out infinite; }
.card-actions { margin-top: 25px; display: flex; justify-content: flex-end; }

.select-all { width: fit-content; margin-bottom: 14px; display: flex; align-items: center; gap: 9px; cursor: pointer; }
input[type="checkbox"] { width: 18px; height: 18px; margin: 0; accent-color: var(--primary-strong); cursor: pointer; }
input[type="checkbox"]:disabled { cursor: not-allowed; }
.order-list { max-height: 440px; margin-bottom: 17px; padding-right: 5px; display: grid; gap: 8px; overflow-y: auto; scrollbar-color: var(--border-strong) transparent; scrollbar-width: thin; }
.order-choice { min-width: 0; padding: 13px 14px; display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-3); cursor: pointer; transition: border-color .18s, background .18s; }
.order-choice:hover { background: var(--surface-2); }
.order-choice.selected { border-color: color-mix(in srgb, var(--primary) 62%, var(--border)); background: color-mix(in srgb, var(--primary) 7%, var(--surface)); }
.order-icon { width: 34px; height: 34px; display: grid; place-items: center; color: var(--primary); border-radius: 9px; background: color-mix(in srgb, var(--primary) 9%, transparent); }
.order-content { min-width: 0; display: grid; gap: 4px; }
.order-heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.order-heading strong { font-size: .87rem; }
.order-heading span, .order-lines { color: var(--muted); font-size: .74rem; font-weight: 500; }
.order-lines { white-space: normal; overflow-wrap: anywhere; }
.empty-state { min-height: 154px; margin-bottom: 17px; display: grid; place-items: center; align-content: center; gap: 5px; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 12px; background: var(--surface-3); text-align: center; }
.empty-state .icon { width: 1.35rem; height: 1.35rem; margin-bottom: 3px; color: var(--subtle); }
.empty-state strong { color: var(--text); font-size: .85rem; }
.empty-state span { font-size: .74rem; }
.callout { padding: 12px 13px; display: flex; align-items: flex-start; gap: 9px; border: 1px solid; border-radius: 11px; font-size: .76rem; }
.info-callout { color: var(--muted); border-color: var(--info-border); background: var(--info-bg); }
.info-callout .icon { color: var(--info); }
.error-callout { margin-bottom: 22px; color: var(--danger); border-color: var(--danger-border); background: var(--danger-bg); }
.error-callout div { display: grid; }.error-callout span { color: var(--muted); }

.progress-heading, .progress-heading div, .details, .job-actions { display: flex; align-items: center; }
.progress-heading, .details { justify-content: space-between; }
.progress-heading { margin-bottom: 11px; font-size: .82rem; }
.progress-heading div { gap: 8px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--subtle); }
.status-dot.success { background: var(--primary); }.status-dot.failed { background: var(--danger); }.status-dot.active { background: var(--info); box-shadow: 0 0 0 5px color-mix(in srgb, var(--info) 12%, transparent); }
.bar { height: 6px; margin-bottom: 24px; overflow: hidden; border-radius: 999px; background: var(--surface-2); }
.bar span { width: 0; height: 100%; display: block; border-radius: inherit; background: var(--primary); transition: width .3s ease; }
.bar span.active { box-shadow: 0 0 12px var(--primary); }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.metric { min-width: 0; padding: 15px; display: flex; align-items: center; gap: 11px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-3); }
.metric-icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--surface-2); }
.metric.orders .metric-icon, .metric.success .metric-icon { color: var(--primary); }.metric.processed .metric-icon { color: #60a5fa; }.metric.skipped .metric-icon { color: #fbbf24; }.metric.failed .metric-icon { color: var(--danger); }.metric.remaining .metric-icon { color: #a78bfa; }
.metric div { min-width: 0; display: grid; }
.metric strong { font-size: 1.15rem; line-height: 1.1; }
.metric div span { color: var(--muted); font-size: .7rem; }
.details { margin: 20px 0 0; padding-top: 16px; color: var(--muted); border-top: 1px solid var(--border); font-size: .73rem; }
.details strong { color: var(--text); font-weight: 650; }
.job-actions { margin-top: 18px; justify-content: space-between; gap: 10px; }
.job-errors { display: grid; gap: 7px; }
.job-errors div { padding: 10px 12px; display: grid; color: var(--danger); border: 1px solid var(--danger-border); border-radius: 9px; background: var(--danger-bg); font-size: .73rem; }
.job-errors span { color: var(--muted); }

.install-wrap { min-height: 100vh; padding: 24px; display: grid; place-items: center; }
.install-theme { position: fixed; z-index: 2; top: 20px; right: 20px; }
.install { width: min(620px, 100%); margin: 0; }
.install .brand-mark { margin-bottom: 22px; }
.install form { margin-top: 26px; }
.install label { display: grid; gap: 8px; }
.field-action { display: flex; gap: 9px; }
.field-action input { min-width: 0; flex: 1; padding: 12px 13px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; outline: 0; background: var(--surface-3); }
.field-action button { padding: 10px 15px; color: var(--primary-ink); border: 0; border-radius: 10px; background: var(--primary); font-weight: 750; cursor: pointer; }

@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; } }
@media (max-width: 880px) {
  .user-meta { display: none; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 660px) {
  .nav-inner { min-height: 60px; padding: 9px 16px; gap: 10px; }
  .brand > span:last-child, .shop-badge, .logout span { display: none; }
  .nav-actions { gap: 7px; }.logout { width: 38px; padding: 0; }
  .shell { padding: 38px 16px 64px; }
  .card { padding: 20px; border-radius: 15px; }
  .date-grid { grid-template-columns: 1fr; }
  .section-heading.split { align-items: flex-start; gap: 10px; }
  .heading-group { align-items: flex-start; }
  .card-actions .button { width: 100%; }
  .details { align-items: flex-start; flex-direction: column; gap: 6px; }
  .field-action { flex-direction: column; }
}
@media (max-width: 390px) {
  .metrics { grid-template-columns: 1fr; }
  .order-choice { grid-template-columns: auto minmax(0, 1fr); }
  .order-icon { display: none; }
  .title-line { align-items: flex-start; flex-direction: column; }
}
`;
