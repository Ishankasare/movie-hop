import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type Pair = { goal: { title: string; tags?: string[]; genres?: number[] }; minHops: number };
const pairs: Pair[] = JSON.parse(readFileSync(path.join(__dirname, "../data/pairs.json"), "utf8"));

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("https://image.tmdb.org/**", (r) => r.fulfill({ contentType: "image/png", body: ONE_PX_PNG }));
});

const tile = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name},`) });
const playLink = (page: Page) => page.getByRole("link", { name: "Play", exact: true });

test("universe and genre tiles are offered, universes first", async ({ page }) => {
  await page.goto("/solo");
  await expect(page.getByRole("heading", { name: "Universes" })).toBeVisible();
  for (const name of ["Marvel", "DC", "Disney / Pixar", "Sagas"]) await expect(tile(page, name)).toBeVisible();
  for (const name of ["Action", "Comedy", "Horror", "Science Fiction"]) await expect(tile(page, name)).toBeVisible();
  // categories with no pairs (Documentary, TV Movie) are not offered
  await expect(tile(page, "Documentary")).toHaveCount(0);
});

test("choosing a tile and hop band feeds the Play link and persists", async ({ page }) => {
  await page.goto("/solo");
  await tile(page, "Marvel").click();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await expect(playLink(page)).toHaveAttribute("href", "/play?cat=marvel&hops=3");

  await page.reload();
  await expect(tile(page, "Marvel")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "3", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(playLink(page)).toHaveAttribute("href", "/play?cat=marvel&hops=3");

  // tapping the selected tile again clears it ("any")
  await tile(page, "Marvel").click();
  await expect(playLink(page)).toHaveAttribute("href", "/play?hops=3");
});

test("a Marvel round's goal is a Marvel film, and a genre round's goal has that genre", async ({ page }) => {
  const marvelGoals = new Set(pairs.filter((p) => p.goal.tags?.includes("marvel")).map((p) => p.goal.title));
  await page.goto("/play?cat=marvel");
  const goal = await page.getByTestId("goal-title").textContent();
  expect(marvelGoals.has(goal ?? "")).toBe(true);

  const horrorGoals = new Set(pairs.filter((p) => p.goal.genres?.includes(27)).map((p) => p.goal.title));
  await page.goto("/play?cat=g27&hops=3");
  const horror = await page.getByTestId("goal-title").textContent();
  expect(horrorGoals.has(horror ?? "")).toBe(true);
});

test("shows 'no pairs match' when nothing fits", async ({ page }) => {
  await page.goto("/play?cat=g99"); // Documentary: no pairs in the data
  await expect(page.getByRole("heading", { name: "No pairs match" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Play any pair" })).toBeVisible();
});
