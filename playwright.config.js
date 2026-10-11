// Browser-Tests der Card (Chromium und WebKit), ohne Netz: Karte, Stil und
// Daten liefert tests_browser/harness.js über page.route aus.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests_browser",
  timeout: 120_000,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
