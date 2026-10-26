import { createRequire } from "module";
const require = createRequire("/workspace/pitwall-ds/tools/");
const { chromium } = require("playwright-core");
const [,, url, out, waitMs = "60000"] = process.argv;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.stack}`));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
try {
  await page.waitForSelector('.wb[data-status="ready"]', { timeout: Number(waitMs) });
} catch { logs.push("[timeout] not ready"); }
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.waitForTimeout(1500);
const status = await page.evaluate(() => document.querySelector(".wb")?.getAttribute("data-status") + " | " + (document.querySelector(".wb-main")?.innerText.slice(0, 300) ?? "no .wb"));
await page.screenshot({ path: out });
console.log(status);
console.log(logs.slice(0, 30).join("\n"));
await browser.close();
