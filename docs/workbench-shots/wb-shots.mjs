// Screenshots of the workbench for the PR. Usage: node wb-shots.mjs <outDir> [raceMcap]
import { createRequire } from "module";
const require = createRequire("/workspace/pitwall-ds/tools/");
const { chromium } = require("playwright-core");
const out = process.argv[2] ?? "/workspace/workbench-shots/v2";
const race = process.argv[3] ?? "/workspace/f1data-out/2026/17_singapore/race.mcap";
const base = "http://localhost:3311";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errs = [];
const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(opts.wait ?? 700);
  await page.screenshot({ path: `${out}/${name}.png`, ...opts.shot });
  console.log("shot", name);
};
// Close menus and the picker without a spare Escape (Escape on its own clears the comparison).
const esc = async (page) => {
  for (let i = 0; i < 4 && (await page.locator(".wb-menu, .wb-picker").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
};
async function open(theme, src) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  if (src === "demo") {
    await page.goto(`${base}/s/demo?theme=${theme}&t=4985`, { timeout: 120000 });
  } else {
    await page.goto(`${base}/s/local?theme=${theme}`, { timeout: 120000 });
    await page.waitForSelector("input[type=file]", { state: "attached", timeout: 60000 });
    await page.locator("input[type=file]").first().setInputFiles(src);
  }
  await page.waitForSelector('.wb[data-status="ready"]', { timeout: 240000 });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(1200);
  if (src !== "demo") {
    const bb = await page.locator(".pw-timeline__track").boundingBox();
    await page.mouse.click(bb.x + bb.width * 0.62, bb.y + bb.height / 2);
    await page.waitForTimeout(800);
  }
  // Compare the top three of the order.
  const rows = page.locator(".wb-timing tbody tr");
  await rows.nth(0).click({ button: "right" });
  await page.locator(".wb-menu").getByText("Compare only this", { exact: true }).click();
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await page.mouse.move(800, 950);
  return { ctx, page };
}
const tab = async (page, name) => {
  await page.locator(".wb-tab", { hasText: name }).click();
  await page.waitForTimeout(1500);
};

// 1. Presets, light and dark, qualifying (demo) and race (local file).
for (const [src, label] of [["demo", "quali"], [race, "race"]]) {
  for (const theme of ["light", "dark"]) {
    const { ctx, page } = await open(theme, src);
    for (const t of ["Timing", "Telemetry", "Strategy", "Laps"]) {
      await tab(page, t);
      await shot(page, `${label}-${t.toLowerCase()}-${theme}`);
    }
    if (label === "race" && theme === "light") {
      // New widgets, one at a time.
      await tab(page, "Strategy");
      for (const type of ["gap-chart", "stints", "weather", "event-log"]) {
        await page.locator(`.wb-panel[data-type="${type}"]`).first().screenshot({ path: `${out}/widget-${type}.png` });
        console.log("shot widget", type);
      }
      await tab(page, "Timing");
      await page.locator('.wb-panel[data-type="session-info"]').first().screenshot({ path: `${out}/widget-session-info.png` });
      await page.locator('.wb-panel[data-type="timing-table"]').first().screenshot({ path: `${out}/widget-timing-table.png` });
      await tab(page, "Telemetry");
      for (const type of ["sectors", "trace", "pedal"]) await page.locator(`.wb-panel[data-type="${type}"]`).first().screenshot({ path: `${out}/widget-${type}.png` });
      await tab(page, "Laps");
      for (const type of ["lap-grid", "lap-distribution"]) await page.locator(`.wb-panel[data-type="${type}"]`).first().screenshot({ path: `${out}/widget-${type}.png` });
      await page.locator(".wb-grid tbody td.is-num").nth(4).click({ button: "right" });
      await page.locator(".wb-menu").last().getByText("Show", { exact: true }).first().hover();
      await shot(page, "menu-lap-grid");
      await esc(page);
      await tab(page, "Timing");
      await page.locator('.wb-panel[data-type="event-log"] tbody tr').first().click({ button: "right" });
      await page.locator(".wb-menu").last().getByText("Categories", { exact: true }).first().hover();
      await shot(page, "menu-race-control");
      await esc(page);
    }
    await ctx.close();
  }
}

// 2. Menus and the top bar (qualifying, light).
{
  const { ctx, page } = await open("light", "demo");
  const hover = async (text) => {
    await page.locator(".wb-menu").last().getByText(text, { exact: true }).first().hover();
    await page.waitForTimeout(400);
  };
  await shot(page, "topbar-light", { shot: { clip: { x: 0, y: 0, width: 1600, height: 44 } } });
  // Knockout cut line, derived from the data: seek into the break after the first part.
  {
    const bb = await page.locator(".pw-timeline__track").boundingBox();
    await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height / 2);
    await page.mouse.move(800, 950);
    await page.waitForTimeout(900);
    await page.locator('.wb-panel[data-type="timing-table"]').first().screenshot({ path: `${out}/widget-timing-cutline.png` });
    await page.locator('.wb-panel[data-type="session-info"]').first().screenshot({ path: `${out}/widget-session-info-quali.png` });
    await page.mouse.click(bb.x + bb.width * 0.62, bb.y + bb.height / 2);
    await page.mouse.move(800, 950);
  }

  await page.locator('.wb-panel[data-type="timing-table"] tbody tr').nth(4).click({ button: "right" });
  await hover("Lap for telemetry");
  await shot(page, "menu-timing-row");
  await esc(page);

  await page.locator('.wb-panel[data-type="timing-table"] thead th').nth(3).click({ button: "right" });
  await hover("Columns");
  await shot(page, "menu-column-header");
  await esc(page);

  await page.locator('.wb-panel[data-type="lap-chart"] .wb-panel__header').click({ button: "right" });
  await hover("Change widget");
  await shot(page, "menu-panel");
  await esc(page);

  const map = page.locator('.wb-panel[data-type="track-map"] .wb-fill').first();
  await map.click({ button: "right", position: { x: 12, y: 40 } });
  await hover("Follow car");
  await shot(page, "menu-track-map");
  await esc(page);

  await page.locator(".wb-tab").first().click({ button: "right" });
  await hover("New tab from preset");
  await shot(page, "menu-tab");
  await esc(page);

  await page.locator('.wb-topbar button[title="Layouts"]').click();
  await hover("Add tab from preset");
  await shot(page, "menu-layouts");
  await esc(page);

  await page.locator('.wb-topbar [aria-label="Settings"]').click();
  await hover("Keyboard shortcuts");
  await shot(page, "menu-settings");
  await esc(page);

  await page.locator(".wb-main").click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
  await page.keyboard.press("p");
  await page.mouse.move(800, 950);
  await shot(page, "picker");
  await esc(page);

  await tab(page, "Telemetry");
  await page.locator('.wb-panel[data-type="trace"] .wb-panel__header').click({ button: "right" });
  await hover("Channels");
  await shot(page, "menu-telemetry-chart");
  await esc(page);

  await tab(page, "Strategy");
  await page.locator('.wb-panel[data-type="gap-chart"] .wb-panel__header').click({ button: "right" });
  await hover("Show");
  await shot(page, "menu-gaps");
  await esc(page);
  await ctx.close();
}
{
  const { ctx, page } = await open("dark", "demo");
  await shot(page, "topbar-dark", { shot: { clip: { x: 0, y: 0, width: 1600, height: 44 } } });
  await page.locator('.wb-panel[data-type="timing-table"] tbody tr').nth(4).click({ button: "right" });
  await page.locator(".wb-menu").getByText("Jump to", { exact: true }).hover();
  await shot(page, "menu-timing-row-dark");
  await ctx.close();
}
console.log(errs.length ? `page errors:\n${errs.slice(0, 10).join("\n")}` : "no page errors");
await browser.close();
