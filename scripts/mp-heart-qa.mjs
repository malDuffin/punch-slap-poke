import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
const room = "qa" + Math.random().toString(36).slice(2, 6);

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p1 = await ctx.newPage();
  const p2 = await ctx.newPage();
  for (const p of [p1, p2]) {
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
  }

  await Promise.all([
    p1.goto(`http://127.0.0.1:8080/?room=${room}&name=QA-One`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }),
    p2.goto(`http://127.0.0.1:8080/?room=${room}&name=QA-Two`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }),
  ]);
  await p1.waitForTimeout(2500);

  const t1 = await p1.getByText(/online|offline|With you/i).allInnerTexts();
  const t2 = await p2.getByText(/online|offline|With you/i).allInnerTexts();
  console.log("p1", t1);
  console.log("p2", t2);

  await p1.keyboard.press("h");
  await p1.waitForTimeout(500);
  await p1.screenshot({ path: "/workspace/screenshots/two-clients-p1.png" });
  await p2.screenshot({ path: "/workspace/screenshots/two-clients-p2.png" });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on("pageerror", (e) => errors.push("m " + String(e)));
  await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await mobile.waitForTimeout(900);
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  console.log("mobileOverflow", overflow, "arena", await mobile.getByText("Shared arena").count());
  await mobile.screenshot({ path: "/workspace/screenshots/mobile-menu.png" });
  console.log("ERRORS", JSON.stringify(errors));
} finally {
  await browser.close();
}
