import { chromium } from "playwright";
import { mkdir } from "fs/promises";

await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--ignore-gpu-blocklist"],
});
const errors = [];

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);

// wait for hooks
await page.waitForFunction(() => typeof window.__gfStart === "function", { timeout: 10000 });
await page.evaluate(() => window.__gfStart());
await page.waitForTimeout(900);
// simulate look + attacks
await page.mouse.click(640, 360);
await page.waitForTimeout(120);
await page.mouse.click(640, 360, { button: "right" });
await page.keyboard.press("Digit2");
await page.waitForTimeout(100);
await page.mouse.click(640, 360);
await page.waitForTimeout(1800);
// pause render for stable shot
await page.evaluate(() => window.__gfPauseRender());
await page.waitForTimeout(200);
await page.screenshot({ path: "/workspace/screenshots/wow-combat.png", timeout: 10000 });
console.log("combat ok");
await page.evaluate(() => window.__gfResumeRender());

// mobile
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
mobile.on("pageerror", (e) => errors.push("m:" + e));
mobile.on("console", (m) => { if (m.type() === "error") errors.push("m:" + m.text()); });
await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 30000 });
await mobile.waitForTimeout(1400);
await mobile.waitForFunction(() => typeof window.__gfStart === "function", { timeout: 10000 });
await mobile.evaluate(() => window.__gfPauseRender());
await mobile.waitForTimeout(150);
await mobile.screenshot({ path: "/workspace/screenshots/wow-mobile-menu.png", timeout: 10000 });
await mobile.evaluate(() => window.__gfResumeRender());
await mobile.evaluate(() => window.__gfStart());
await mobile.waitForTimeout(1400);
await mobile.evaluate(() => window.__gfPauseRender());
await mobile.waitForTimeout(150);
await mobile.screenshot({ path: "/workspace/screenshots/wow-mobile-play.png", timeout: 10000 });
console.log("mobile ok");

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
