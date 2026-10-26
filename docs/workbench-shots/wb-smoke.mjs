// Headless smoke test of the workbench UI. Usage: node wb-smoke.mjs [baseUrl]
import { createRequire } from "module";
const require = createRequire("/workspace/pitwall-ds/tools/");
const { chromium } = require("playwright-core");
const base = process.argv[2] ?? "http://localhost:3311";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
const page = await ctx.newPage();
const errs = [];
let fails = 0;
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const ok = (name, cond, extra = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${String(extra).replace(/\s+/g, " ").slice(0, 180)}`);
};
const menuText = () => page.locator(".wb-menu").first().innerText().catch(() => "");
const esc = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
};

await page.goto(base + "/s/demo?theme=light&t=4985", { timeout: 120000 });
await page.waitForSelector('.wb[data-status="ready"]', { timeout: 180000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
const panels = () => page.locator(".wb-panel").count();
const tabs = () => page.locator(".wb-tab").count();

// Top bar: tabs left, controls right, no session data.
ok("default tabs", (await page.locator(".wb-tab").allInnerTexts()).join(",") === "Timing,Telemetry,Strategy,Laps", (await page.locator(".wb-tab").allInnerTexts()).join(","));
const top = await page.locator(".wb-topbar").innerText();
ok("top bar has no session data", !/\d+:\d\d|Singapore|Qualifying|Lap \d/i.test(top), top);
for (const l of ["New tab", "Open recording", "Toggle theme", "Settings"]) ok(`control: ${l}`, await page.locator(`.wb-topbar [aria-label="${l}"]`).isVisible());
const n0 = await panels();
ok("Timing preset panels", n0 === 6, n0);
// Encodings: team-colour driver cells, semantic fills, zebra, race control table, track-status block.
ok("timing driver cells filled with team colour", (await page.locator(".wb-timing td.wb-team-cell").count()) >= 10);
ok("timing best/sector fills", (await page.locator(".wb-timing td.wb-fill--purple").count()) >= 1);
const zebra = await page.evaluate(() => {
  const r = document.querySelectorAll(".wb-timing tbody tr");
  const bg = (i) => getComputedStyle(r[i].querySelector("td:last-child")).backgroundColor;
  return r.length > 3 && bg(0) !== bg(1);
});
ok("tables are zebra striped", zebra);
ok("race control is a table", (await page.locator('.wb-panel[data-type="event-log"] table.wb-rc tbody tr').count()) >= 1);
ok("session info status block", await page.locator(".wb-info__flag").isVisible());
ok("timing rows are not text-selectable", (await page.evaluate(() => getComputedStyle(document.querySelector(".wb-timing tbody")).userSelect)) === "none");

// Picker
await page.locator(".wb-main").click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
await page.keyboard.press("p");
ok("picker opens with P", await page.locator(".wb-picker").isVisible());
await page.keyboard.type("gaps");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
ok("picker adds panel", (await panels()) === n0 + 1, await panels());

// Panel menu: close the added panel through it
ok("added panel is Gaps", (await page.locator('.wb-panel[data-type="gap-chart"]').count()) === 1);
await page.locator('.wb-panel[data-type="gap-chart"] .wb-panel__header').click({ button: "right" });
const pm = await menuText();
ok("panel menu", /Change widget/.test(pm) && /Drivers/.test(pm) && /Close panel/.test(pm), pm);
await page.locator(".wb-menu").getByText("Close panel", { exact: true }).click();
await page.waitForTimeout(300);
ok("close panel from menu", (await panels()) === n0, await panels());

// Timing rows: click focuses, shift-click compares, right-click entity menu
const rows = page.locator(".wb-timing tbody tr");
const selected = () => page.locator(".wb-timing tbody tr.is-selected").count();
await rows.nth(0).click({ button: "right" });
await page.locator(".wb-menu").getByText("Compare only this", { exact: true }).click();
await page.waitForTimeout(200);
ok("compare only this", (await selected()) === 1, await selected());
await rows.nth(1).click({ modifiers: ["Shift"] });
await page.waitForTimeout(200);
ok("shift-click adds to comparison", (await selected()) === 2, await selected());
await rows.nth(2).click({ button: "right" });
const em = await menuText();
ok("timing row entity menu", /Add to comparison/.test(em) && /Set as reference/.test(em) && /Change widget/.test(em), em);
await page.locator(".wb-menu").getByText("Add to comparison", { exact: true }).click();
await page.waitForTimeout(200);
ok("menu adds to comparison", (await selected()) === 3, await selected());

// Column header menu
await page.locator(".wb-timing thead th").nth(3).click({ button: "right" });
const cm = await menuText();
ok("column header menu", /Sort ascending/.test(cm) && /Columns/.test(cm), cm);
await esc();

// Track map right-click on blank space
const map = page.locator('.wb-panel[data-type="track-map"] .wb-fill').first();
if (await map.count()) {
  await map.click({ button: "right", position: { x: 12, y: 40 } });
  const mm = await menuText();
  ok("track map menu", /Labels/.test(mm) && /Follow car/.test(mm), mm);
  await esc();
} else ok("track map present", false);

// Tabs: add, menu, close
const t0 = await tabs();
await page.locator('[aria-label="New tab"]').click();
const nm = await menuText();
await page.locator(".wb-menu").getByText("Blank tab", { exact: true }).click();
await page.waitForTimeout(300);
ok("new tab", (await tabs()) === t0 + 1, nm);
ok("new tab empty state", await page.locator(".wb-tab-empty").isVisible());
await page.locator(".wb-tab").last().click({ button: "right" });
const tm = await menuText();
await page.locator(".wb-menu").getByText("Close tab", { exact: true }).click();
await page.waitForTimeout(300);
ok("tab menu close", (await tabs()) === t0, tm);

// Telemetry and Strategy tabs render their panels
for (const [name, n] of [["Telemetry", 5], ["Strategy", 5], ["Laps", 3]]) {
  await page.locator(".wb-tab", { hasText: name }).click();
  await page.waitForTimeout(1200);
  ok(`${name} preset panels`, (await panels()) === n, await panels());
  if (name === "Telemetry") {
    ok("pedal use renders bars", (await page.locator(".wb-pedal__bar").count()) >= 1, await page.locator('.wb-panel[data-type="pedal"]').innerText().catch(() => ""));
    ok("trace corner markers", /\b1\b.*\b2\b/s.test(await page.locator('.wb-panel[data-type="trace"]').innerText().catch(() => "")) || (await page.locator('.wb-panel[data-type="trace"] canvas').count()) > 0);
  }
  if (name === "Laps") {
    ok("lap history grid has laps", (await page.locator(".wb-grid tbody tr").count()) >= 5, await page.locator(".wb-grid tbody tr").count());
    ok("lap history fills bests", (await page.locator(".wb-grid td.wb-fill--purple").count()) >= 1);
    ok("lap distribution boxes", (await page.locator(".wb-box__iqr").count()) >= 5);
    await page.locator(".wb-grid tbody td.is-num").nth(3).click({ button: "right" });
    const gm = await menuText();
    ok("lap grid cell menu", /Show/.test(gm) && /Newest lap on top/.test(gm), gm);
    await esc();
  }
}
await page.locator(".wb-tab", { hasText: "Timing" }).click();

// Playback in the bottom bar
const clock = () => page.locator(".pw-timeline__time").first().innerText();
const c0 = await clock();
await page.locator("body").press("Space");
await page.waitForTimeout(2000);
await page.locator("body").press("Space");
const c1 = await clock();
ok("Space plays", c0 !== c1, `${c0} -> ${c1}`);
await page.locator("body").press("ArrowRight");
await page.waitForTimeout(150);
ok("ArrowRight seeks", (await clock()) !== c1, await clock());

// Theme, save, URL
const th0 = await page.locator(".wb").getAttribute("data-theme");
await page.locator("body").press("\\");
await page.waitForTimeout(300);
ok("\\ toggles theme", (await page.locator(".wb").getAttribute("data-theme")) !== th0);
await page.locator("body").press("\\");
await page.locator("body").press("Control+s");
await page.waitForTimeout(300);
const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("layouts/v1/")));
ok("Ctrl+S saves layout", saved.length >= 1, saved.join(","));
await page.waitForTimeout(800);
ok("URL reflects time and comparison", /[?&]t=/.test(page.url()) && /[?&]sel=/.test(page.url()), page.url());
ok("no page errors", errs.length === 0, errs.slice(0, 5).join(" || "));
await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
