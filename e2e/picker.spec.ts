import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

type Pair = { start: { genres?: number[] }; minHops: number };
const pairs: Pair[] = JSON.parse(readFileSync(path.join(__dirname, "../data/pairs.json"), "utf8"));

test("hop band choice persists and feeds the Play link", async ({ page }) => {
  await page.goto("/solo");
  await page.getByRole("button", { name: "3", exact: true }).click();
  await expect(page.getByRole("link", { name: "Play", exact: true })).toHaveAttribute("href", "/play?hops=3");

  await page.reload();
  await expect(page.getByRole("button", { name: "3", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Play", exact: true })).toHaveAttribute("href", "/play?hops=3");
});

test("shows 'no pairs match' for an empty filter", async ({ page }) => {
  // find a genre + hop band combination with no pairs in the data
  const genres = [...new Set(pairs.map((p) => p.start.genres?.[0]).filter((g): g is number => g !== undefined))];
  let combo: { genre: number; hops: number } | undefined;
  for (const genre of genres) {
    for (const hops of [2, 3, 4]) {
      if (!pairs.some((p) => p.start.genres?.[0] === genre && p.minHops === hops)) combo ??= { genre, hops };
    }
  }
  test.skip(!combo, "every genre/hop combination has pairs in this data set");

  await page.goto("/solo");
  await page.getByLabel("Genre of the start film").selectOption(String(combo!.genre));
  await page.getByRole("button", { name: String(combo!.hops), exact: true }).click();
  await expect(page.getByText("No pairs match")).toBeVisible();
  await expect(page.getByRole("link", { name: "Play", exact: true })).toHaveCount(0);
});
