import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated accessibility checks (axe, WCAG 2.x A and AA) on every main screen.
// This catches roughly a third of real accessibility problems; it doesn't replace trying it with a screen reader.

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.clear();
  });
  await page.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
});

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, summary.join("\n")).toEqual([]);
}

const PAGES: [string, string, string][] = [
  ["Home", "/", "Play solo"],
  ["Solo", "/solo", "What kind of film is your goal?"],
  ["Race", "/race", "Host a match"],
  ["How to play", "/how-to-play", "Stuck? Use the hint"],
  ["About", "/about", "What we store about you"],
];

for (const [name, url, marker] of PAGES) {
  test(`${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(url);
    await expect(page.getByText(marker).first()).toBeVisible();
    await scan(page);
  });
}

test("a round (cast screen, person screen, hint, result) has no violations", async ({ page }) => {
  await page.goto("/play");
  await expect(page.getByTestId("start-title")).toBeVisible();
  await scan(page); // cast screen

  await page.getByRole("button", { name: /^Choose / }).first().click();
  await scan(page); // person's films

  await page.getByRole("button", { name: "Back to cast" }).click();
  await page.getByRole("button", { name: /^Hint/ }).click();
  await expect(page.getByTestId("hint-text")).toBeVisible();
  await scan(page); // with the hint showing

  await page.getByRole("button", { name: "Give up" }).click();
  await expect(page.getByRole("heading", { name: "You gave up" })).toBeVisible();
  await scan(page); // result
});

test("the 404 page has no violations", async ({ page }) => {
  await page.goto("/definitely-not-a-page");
  await expect(page.getByText("This scene was cut")).toBeVisible();
  await scan(page);
});
