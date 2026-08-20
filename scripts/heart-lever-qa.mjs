#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message || e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 45000 });
for (let i = 0; i < 100; i++) {
  const t = await page.evaluate(() => document.body.innerText || "");
  if (t.includes("Enter the ring")) break;
  await page.waitForTimeout(120);
}

const started = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Enter the ring/i.test(b.textContent || ""),
  );
  if (btn) btn.click();
  for (let i = 0; i < 80; i++) {
    if (typeof window.__gfStart === "function") {
      window.__gfStart();
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return typeof window.__gfStart === "function";
});
await page.waitForTimeout(700);
await page.screenshot({ path: "/workspace/screenshots/walkway-idle.png" });

const one = await page.evaluate(() => {
  window.__gfHands("heart", "punch");
  return window.__gfInspect();
});
await page.waitForTimeout(250);
await page.screenshot({ path: "/workspace/screenshots/half-heart-one.png" });

const both = await page.evaluate(() => {
  window.__gfHands("heart", "heart");
  return window.__gfInspect();
});
await page.waitForTimeout(600);
const bothLater = await page.evaluate(() => window.__gfInspect());
await page.screenshot({ path: "/workspace/screenshots/half-heart-both.png" });

const go = await page.evaluate(() => {
  window.__gfLever(1);
  return window.__gfInspect();
});
await page.waitForTimeout(900);
await page.screenshot({ path: "/workspace/screenshots/walkway-go.png" });

const after = await page.evaluate(() => window.__gfInspect());

await browser.close();
console.log(
  JSON.stringify(
    { started, one, both, bothLater, go, after, errors },
    null,
    2,
  ),
);
if (errors.length) process.exit(2);
if (!one || one.L !== "heart" || one.R !== "punch") process.exit(3);
if (bothLater?.shield) process.exit(4);
if (!(go?.lever > 0.9)) process.exit(5);
process.exit(0);
