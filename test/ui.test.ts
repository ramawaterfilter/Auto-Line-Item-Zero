import { describe, expect, it } from "vitest";
import { appPage, landingPage } from "../src/ui";

describe("operations UI", () => {
  const page = appPage();

  it("defaults to dark mode and restores only an explicit light preference", () => {
    expect(page).toContain('<html lang="en" data-theme="dark">');
    expect(page).toContain('localStorage.getItem("theme")==="light"?"light":"dark"');
  });

  it("provides the persistent theme toggle on both screens", () => {
    expect(appPage()).toContain("data-theme-toggle");
    expect(landingPage()).toContain("data-theme-toggle");
    expect(page).toContain("data-theme-label");
    expect(page).toContain('localStorage.setItem("theme",theme)');
  });

  it("keeps the destructive audit requirement visible", () => {
    expect(page).toContain("A <strong class=\"danger-text\">BEFORE audit</strong> must succeed first.");
    expect(page).toContain("Validating BEFORE audit...");
  });

  it("shows a job discovery failure in the application alert", () => {
    expect(page).toContain('role="alert"');
    expect(page).toContain('showError(job.errorMessage || "Order discovery failed. Please try again.")');
  });
});
