import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // posters come from the TMDB CDN; keep the shell tests offline-safe
  await page.route("https://image.tmdb.org/**", (r) => r.abort());
});

test("tab bar links between Home, Solo, Race and How to play", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Solo" }).click();
  await expect(page.getByRole("heading", { name: "Solo" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Solo" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "Race" }).click();
  await expect(page.getByRole("heading", { name: "Race a friend" })).toBeVisible();

  await nav.getByRole("link", { name: "How to play" }).click();
  await expect(page.getByRole("heading", { name: "How to play" })).toBeVisible();
});

test("Home's buttons lead to Solo and Race", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Play solo" })).toHaveAttribute("href", "/solo");
  await expect(page.getByRole("link", { name: "Race a friend" })).toHaveAttribute("href", "/race");
});

test("the tab bar is hidden while playing a round", async ({ page }) => {
  await page.goto("/play");
  await expect(page.getByTestId("start-title")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});
