import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync("tests/e2e/.auth/admin.json", "utf8"));
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: state });
const page = await context.newPage();

const seen: string[] = [];
page.on("pageerror", (e) => seen.push(`PAGEERROR ${e.message}\n${e.stack ?? ""}`));
page.on("console", (m) => {
  const t = m.text();
  if (/hydrat|did not match|server rendered/i.test(t)) seen.push(`CONSOLE ${t}`);
});

await page.goto("http://localhost:3100/dashboard/orgs/acme/front-desk/seaside", {
  waitUntil: "load",
});
await page.waitForTimeout(3000);
console.log(seen.join("\n\n---\n\n").slice(0, 4000) || "no hydration complaints");
await browser.close();
