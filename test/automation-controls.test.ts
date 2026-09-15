import { describe, expect, it, vi } from "vitest";
import { clientScript } from "../src/ui-client";

function setup(enabled = false) {
  const elements: Record<string, { checked: boolean; disabled: boolean; textContent: string; onchange?: () => void; onclick?: () => Promise<void>; querySelector: () => { textContent: string }; replaceChildren: () => void }> = {};
  const $ = (id: string) => elements[id] ??= { checked: false, disabled: true, textContent: "", querySelector: () => ({ textContent: "" }), replaceChildren() {} };
  let saved = enabled;
  const api = vi.fn(async (_url: string, options?: { body: string }) => {
    if (options) saved = JSON.parse(options.body).enabled;
    return { enabled: saved, enabledAt: "2026-09-11", jobs: [] };
  });
  const showError = vi.fn();
  const source = clientScript.slice(clientScript.indexOf("let automationTimer"), clientScript.indexOf('$("process").dataset.label'));
  const controls = new Function("$", "api", "showError", "clearError", "formatDate", "setTimeout", "clearTimeout",
    source + "return { renderAutomation, loadAutomation };")($, api, showError, () => {}, (value: string) => value, () => 0, () => {});
  controls.renderAutomation({ enabled, enabledAt: "2026-09-11", jobs: [] });
  return { $, api, controls, showError };
}

describe("automation Apply button", () => {
  it("keeps checkbox changes local across polling until Apply saves them", async () => {
    const { $, api, controls } = setup();
    $("automation-enabled").checked = true;
    $("automation-enabled").onchange!();
    expect(api).not.toHaveBeenCalled();
    expect($("automation-apply").disabled).toBe(false);
    await controls.loadAutomation();
    expect($("automation-enabled").checked).toBe(true);
    expect($("automation-status").textContent).toContain("Off");
    await $("automation-apply").onclick!();
    expect(api).toHaveBeenCalledWith("/api/automation", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    expect($("automation-status").textContent).toContain("On");
    expect($("automation-apply").disabled).toBe(true);
  });

  it("also requires Apply to disable automation and disables Apply when the draft is reverted", async () => {
    const { $, api } = setup(true);
    $("automation-enabled").checked = false; $("automation-enabled").onchange!();
    expect(api).not.toHaveBeenCalled();
    expect($("automation-status").textContent).toContain("On");
    $("automation-enabled").checked = true; $("automation-enabled").onchange!();
    expect($("automation-apply").disabled).toBe(true);
    $("automation-enabled").checked = false; $("automation-enabled").onchange!();
    await $("automation-apply").onclick!();
    expect(api).toHaveBeenCalledWith("/api/automation", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    expect($("automation-status").textContent).toContain("Off");
  });

  it("preserves an unapplied choice and the saved status when saving fails", async () => {
    const { $, api, showError } = setup();
    $("automation-enabled").checked = true; $("automation-enabled").onchange!();
    api.mockRejectedValueOnce(new Error("Audit validation failed"));
    await $("automation-apply").onclick!();
    expect($("automation-enabled").checked).toBe(true);
    expect($("automation-status").textContent).toContain("Off");
    expect($("automation-apply").disabled).toBe(false);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining("Audit validation failed"));
  });
});
