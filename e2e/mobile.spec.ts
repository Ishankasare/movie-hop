import { expect, test, type Page } from "@playwright/test";

// Mobile pass: every main page at four phone widths must not scroll sideways, must not make iPhones zoom in
// on inputs (font size under 16px), and every button / link must be a comfortable tap target.

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const WIDTHS = [320, 360, 390, 430];
const PAGES = ["/", "/solo", "/race", "/how-to-play", "/about", "/play"];
const MIN_TARGET = 36; // px; WCAG 2.2 AA asks for 24, the usual comfort guideline is 44

async function audit(page: Page) {
  return page.evaluate((minTarget) => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) problems.push(`sideways scroll: page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px window`);

    for (const el of document.querySelectorAll<HTMLElement>("input, select, textarea")) {
      if (parseFloat(getComputedStyle(el).fontSize) < 16) problems.push(`input "${el.id || el.tagName}" has text under 16px (iPhones zoom in)`);
    }

    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], summary")) {
      if (el.closest(".sr-only") || el.className.toString().includes("sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      // plain text links inside a sentence are exempt, as are the small footer links
      if (el.tagName === "A" && el.closest("p, footer")) continue;
      if (r.height < minTarget || r.width < minTarget) {
        problems.push(`small tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)}`);
      }
    }
    return problems;
  }, MIN_TARGET);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.clear();
  });
  await page.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
});

for (const width of WIDTHS) {
  for (const url of PAGES) {
    test(`${url} at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      if (url === "/play") await expect(page.getByTestId("start-title")).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }
}

test("a person's films and the result screen also fit at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/play");
  await expect(page.getByTestId("start-title")).toBeVisible();
  await page.getByRole("button", { name: /^Choose / }).first().click();
  expect(await audit(page)).toEqual([]);
  await page.getByRole("button", { name: /^Hint/ }).click();
  expect(await audit(page)).toEqual([]);
  await page.getByRole("button", { name: "Give up" }).click();
  await expect(page.getByRole("heading", { name: "You gave up" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});
